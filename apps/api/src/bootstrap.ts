import { CosmosClient, type Container } from '@azure/cosmos';
import { TableClient } from '@azure/data-tables';
import {
  DEFAULT_MEETING_SECTIONS,
  partitionFor,
  weekStartDateFor,
  type EnvironmentId,
  type IssueAgeSettingsRecord,
  type MeetingRecord,
  type TeamMembership,
  type TeamRecord,
  type UserProfile,
  type WorkspaceRecord,
} from './domain.js';
import { AzureTableControlPlaneRepository } from './data/environment.js';
import { MemoryWorkspaceRepository } from './data/repository.js';
import { normalizeObjectId } from './auth.js';

const ORG_ID = process.env.BREMMAR_ORG_ID ?? 'bremmar';
const CONTROL_PARTITION = 'org';
const nowIso = () => new Date().toISOString();

function recordBase(id: string, kind: WorkspaceRecord['kind'], teamId?: string, environmentId: EnvironmentId = 'live'): WorkspaceRecord {
  const timestamp = nowIso();
  return { id, kind, pk: teamId ? partitionFor('team', teamId) : CONTROL_PARTITION, orgId: ORG_ID, teamId, createdAt: timestamp, updatedAt: timestamp, updatedBy: 'bootstrap', version: 1, environmentId };
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'admin';
}

function stableIdentityId(value: string) {
  const trimmed = value.trim();
  return normalizeObjectId(trimmed) ?? trimmed;
}

function adminUser(userId: string, name: string, email: string, environmentId: EnvironmentId = 'live'): UserProfile {
  return { ...recordBase(userId, 'user', undefined, environmentId), kind: 'user', name, email, initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AD', accent: '#007e32', active: true, platformCapabilities: ['PlatformAdmin'] };
}

function bootstrapTeam(): TeamRecord {
  return { ...recordBase('leadership', 'team'), kind: 'team', teamId: 'leadership', name: 'Leadership Team', shortName: 'Leadership', description: 'Company-level direction and visibility.', parentTeamId: null, nodeType: 'operational', active: true, meetingCadence: 'weekly', meetingDay: 'Monday', meetingTime: '9:00 AM', accent: '#182b4b', initials: 'LT', meetingSections: structuredClone(DEFAULT_MEETING_SECTIONS), escalationUserIds: [] };
}

function bootstrapMembership(userId: string, environmentId: EnvironmentId = 'live'): TeamMembership {
  return { ...recordBase(`membership-${safeId(userId)}-leadership`, 'teamMembership', undefined, environmentId), kind: 'teamMembership', teamId: 'leadership', userId, role: 'OrgAdmin', active: true };
}

function bootstrapSettings(): IssueAgeSettingsRecord {
  return { ...recordBase('issue-age-settings', 'issueAgeSettings'), kind: 'issueAgeSettings', agingDays: 7, staleDays: 14, criticalDays: 30 };
}

function bootstrapMeeting(team: TeamRecord, attendeeId: string, environmentId: EnvironmentId): MeetingRecord {
  const sections = (team.meetingSections?.length ? team.meetingSections : DEFAULT_MEETING_SECTIONS).filter((section) => section.enabled);
  const scheduledDate = weekStartDateFor(new Date());
  return {
    ...recordBase(`meeting-${team.teamId}-current`, 'meeting', team.teamId, environmentId),
    kind: 'meeting', teamId: team.teamId, label: `${team.shortName} L10`, dateLabel: new Date(`${scheduledDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(', ', ' · '), scheduledDate, scheduledTime: team.meetingTime,
    weekStartDate: scheduledDate, status: 'upcoming', facilitatorId: attendeeId, attendeeIds: [attendeeId],
    lastRating: 0, agendaProgress: 0, agendaTotal: sections.length, idsSolved: 0, idsTotal: 0, recap: '',
    sectionNotes: {}, idsIssueIds: [], createdTodoIds: [], idsNotes: [],
  };
}

function liveBootstrapRecords(userId: string, name: string, email: string): WorkspaceRecord[] {
  const team = bootstrapTeam();
  return [adminUser(userId, name, email), team, bootstrapMembership(userId), bootstrapSettings(), bootstrapMeeting(team, userId, 'live')];
}

function addBootstrapAdmin(records: WorkspaceRecord[], userId: string, name: string, email: string, environmentId: EnvironmentId = 'live') {
  const user = records.find((record) => record.kind === 'user' && record.id === userId) as UserProfile | undefined;
  if (!user) records.push(adminUser(userId, name, email, environmentId));
  else if (!user.platformCapabilities.includes('PlatformAdmin') || user.environmentId !== environmentId) {
    Object.assign(user, { platformCapabilities: ['PlatformAdmin'], environmentId, updatedAt: nowIso(), updatedBy: 'bootstrap', version: user.version + 1 });
  }

  const membership = records.find((record) => record.kind === 'teamMembership' && (record as TeamMembership).userId === userId && record.teamId === 'leadership') as TeamMembership | undefined;
  if (!membership) records.push(bootstrapMembership(userId, environmentId));
  else if (membership.role !== 'OrgAdmin' || !membership.active || membership.environmentId !== environmentId) {
    Object.assign(membership, { role: 'OrgAdmin', active: true, environmentId, updatedAt: nowIso(), updatedBy: 'bootstrap', version: membership.version + 1 });
  }
}

async function hasAnyWorkspaceRecords(container: Container) {
  const result = await container.items.query<{ id: string }>({ query: 'SELECT TOP 1 c.id FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
  return result.resources.length > 0;
}

async function writeRecords(container: Container, records: readonly WorkspaceRecord[]) {
  for (const record of records) {
    const payload = { ...record } as WorkspaceRecord & { _etag?: string };
    delete payload.cosmosEtag;
    delete payload._etag;
    await container.items.upsert(payload);
  }
}

async function ensureBootstrapMeetings(container: Container, records: readonly WorkspaceRecord[], attendeeId: string, environmentId: EnvironmentId) {
  const teams = (records.filter((record) => record.kind === 'team') as TeamRecord[]).filter((team) => team.active && team.nodeType === 'operational');
  for (const team of teams) {
    const result = await container.items.query<{ id: string }>({
      query: 'SELECT TOP 1 c.id FROM c WHERE c.pk = @pk AND c.kind = "meeting" AND c.teamId = @teamId AND c.status != "closed"',
      parameters: [{ name: '@pk', value: partitionFor('team', team.teamId) }, { name: '@teamId', value: team.teamId }],
    }, { partitionKey: partitionFor('team', team.teamId) }).fetchAll();
    if (!result.resources.length) await writeRecords(container, [bootstrapMeeting(team, attendeeId, environmentId)]);
  }
}

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for environment bootstrap.`);
  return value;
}

export async function bootstrapEnvironments(options: { orgAdminObjectId: string; adminName: string; adminEmail: string; initialTestAccessObjectIds: readonly string[] }) {
  const cosmosConnectionString = requiredSetting('COSMOS_CONNECTION_STRING');
  const storageConnectionString = requiredSetting('AZURE_STORAGE_CONNECTION_STRING');
  const liveDatabase = requiredSetting('COSMOS_LIVE_DATABASE');
  const testDatabase = requiredSetting('COSMOS_TEST_DATABASE');
  const liveContainerName = process.env.COSMOS_LIVE_CONTAINER ?? 'workspace';
  const testContainerName = process.env.COSMOS_TEST_CONTAINER ?? 'workspace';
  const controlTableName = process.env.AZURE_STORAGE_TABLE_NAME ?? 'EnvironmentAccess';
  const controlTable = TableClient.fromConnectionString(storageConnectionString, controlTableName);
  await controlTable.createTable();
  const control = new AzureTableControlPlaneRepository(controlTable, async () => true);
  await control.ensureEnvironmentMetadata();
  const client = new CosmosClient(cosmosConnectionString);
  const live = client.database(liveDatabase).container(liveContainerName);
  const test = client.database(testDatabase).container(testContainerName);
  const orgAdminObjectId = stableIdentityId(options.orgAdminObjectId);
  const initialTestAccessObjectIds = [...new Set(options.initialTestAccessObjectIds.map(stableIdentityId).filter(Boolean))];

  if (!await hasAnyWorkspaceRecords(live)) {
    const records = liveBootstrapRecords(orgAdminObjectId, options.adminName, options.adminEmail);
    await writeRecords(live, records);
    await ensureBootstrapMeetings(live, records, orgAdminObjectId, 'live');
  } else {
    const existing = await live.items.query<WorkspaceRecord>({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    const records = existing.resources;
    addBootstrapAdmin(records, orgAdminObjectId, options.adminName, options.adminEmail, 'live');
    await writeRecords(live, records.filter((record) => record.kind === 'user' || record.kind === 'teamMembership'));
    await ensureBootstrapMeetings(live, records, orgAdminObjectId, 'live');
  }

  if (!await hasAnyWorkspaceRecords(test)) {
    const fixture = new MemoryWorkspaceRepository('test').exportWorkspaceRecords();
    addBootstrapAdmin(fixture, orgAdminObjectId, options.adminName, options.adminEmail, 'test');
    for (const userId of initialTestAccessObjectIds) addBootstrapAdmin(fixture, userId, options.adminName, options.adminEmail, 'test');
    await writeRecords(test, fixture);
    await ensureBootstrapMeetings(test, fixture, orgAdminObjectId, 'test');
  } else {
    const existing = await test.items.query<WorkspaceRecord>({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    const records = existing.resources;
    addBootstrapAdmin(records, orgAdminObjectId, options.adminName, options.adminEmail, 'test');
    for (const userId of initialTestAccessObjectIds) addBootstrapAdmin(records, userId, options.adminName, options.adminEmail, 'test');
    await writeRecords(test, records.filter((record) => record.kind === 'user' || record.kind === 'teamMembership'));
    await ensureBootstrapMeetings(test, records, orgAdminObjectId, 'test');
  }

  if (initialTestAccessObjectIds.length) await control.seedTestAccess(initialTestAccessObjectIds, orgAdminObjectId);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orgAdminFlagIndex = process.argv.indexOf('--org-admin-object-id');
  const orgAdminObjectId = process.env.INITIAL_ORG_ADMIN_OBJECT_ID ?? (orgAdminFlagIndex >= 0 ? process.argv[orgAdminFlagIndex + 1] : undefined);
  if (!orgAdminObjectId) throw new Error('Pass INITIAL_ORG_ADMIN_OBJECT_ID or --org-admin-object-id.');
  const initialTestAccessObjectIds = (process.env.INITIAL_TEST_ACCESS_OBJECT_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  await bootstrapEnvironments({ orgAdminObjectId, adminName: process.env.INITIAL_ORG_ADMIN_NAME ?? 'Initial Org Admin', adminEmail: process.env.INITIAL_ORG_ADMIN_EMAIL ?? 'admin@invalid.local', initialTestAccessObjectIds });
  console.log('Environment bootstrap completed. Existing workspace records were preserved.');
}
