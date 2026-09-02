import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import {
  DEFAULT_MEETING_SECTIONS,
  partitionFor,
  type EnvironmentId,
  type IssueAgeSettingsRecord,
  type TeamMembership,
  type TeamRecord,
  type UserProfile,
  type WorkspaceRecord,
} from './domain.js';
import { MemoryWorkspaceRepository } from './data/repository.js';

const ORG_ID = process.env.BREMMAR_ORG_ID ?? 'bremmar';
const CONTROL_PARTITION = 'org';
const nowIso = () => new Date().toISOString();

interface EnvironmentDefinition {
  id: string;
  kind: 'environmentDefinition';
  pk: string;
  orgId: string;
  environmentId: EnvironmentId;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface EnvironmentAccessGrant {
  id: string;
  kind: 'environmentAccessGrant';
  pk: string;
  orgId: string;
  userId: string;
  environmentId: 'test';
  allowed: true;
  grantedAt: string;
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

interface EnvironmentAccessAudit {
  id: string;
  kind: 'environmentAccessAudit';
  pk: string;
  orgId: string;
  environmentId: 'control';
  actorId: string;
  targetUserId: string;
  action: 'granted' | 'revoked';
  createdAt: string;
}

function recordBase(id: string, kind: WorkspaceRecord['kind'], teamId?: string, environmentId: EnvironmentId = 'live'): WorkspaceRecord {
  const timestamp = nowIso();
  return { id, kind, pk: teamId ? partitionFor('team', teamId) : CONTROL_PARTITION, orgId: ORG_ID, teamId, createdAt: timestamp, updatedAt: timestamp, updatedBy: 'bootstrap', version: 1, environmentId };
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'admin';
}

function adminUser(userId: string, name: string, email: string, environmentId: EnvironmentId = 'live'): UserProfile {
  return { ...recordBase(userId, 'user', undefined, environmentId), kind: 'user', name, email, initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AD', accent: '#007e32', active: true, platformCapabilities: ['PlatformAdmin'] };
}

function bootstrapTeam(): TeamRecord {
  return { ...recordBase('leadership', 'team'), kind: 'team', teamId: 'leadership', name: 'Leadership Team', shortName: 'Leadership', description: 'Company-level direction and visibility.', parentTeamId: null, nodeType: 'operational', active: true, meetingDay: 'Monday', meetingTime: '9:00 AM', accent: '#182b4b', initials: 'LT', meetingSections: structuredClone(DEFAULT_MEETING_SECTIONS), escalationUserIds: [] };
}

function bootstrapMembership(userId: string, environmentId: EnvironmentId = 'live'): TeamMembership {
  return { ...recordBase(`membership-${safeId(userId)}-leadership`, 'teamMembership', undefined, environmentId), kind: 'teamMembership', teamId: 'leadership', userId, role: 'OrgAdmin', active: true };
}

function bootstrapSettings(): IssueAgeSettingsRecord {
  return { ...recordBase('issue-age-settings', 'issueAgeSettings'), kind: 'issueAgeSettings', agingDays: 7, staleDays: 14, criticalDays: 30 };
}

function liveBootstrapRecords(userId: string, name: string, email: string): WorkspaceRecord[] {
  return [adminUser(userId, name, email), bootstrapTeam(), bootstrapMembership(userId), bootstrapSettings()];
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

function requiredSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for environment bootstrap.`);
  return value;
}

export async function bootstrapEnvironments(options: { orgAdminObjectId: string; adminName: string; adminEmail: string; initialTestAccessObjectIds: readonly string[] }) {
  const endpoint = requiredSetting('COSMOS_ENDPOINT');
  const controlDatabase = requiredSetting('COSMOS_CONTROL_DATABASE');
  const liveDatabase = requiredSetting('COSMOS_LIVE_DATABASE');
  const testDatabase = requiredSetting('COSMOS_TEST_DATABASE');
  const controlContainerName = process.env.COSMOS_CONTROL_CONTAINER ?? 'environment-access';
  const liveContainerName = process.env.COSMOS_LIVE_CONTAINER ?? 'workspace';
  const testContainerName = process.env.COSMOS_TEST_CONTAINER ?? 'workspace';
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  const control = client.database(controlDatabase).container(controlContainerName);
  const live = client.database(liveDatabase).container(liveContainerName);
  const test = client.database(testDatabase).container(testContainerName);
  const timestamp = nowIso();
  const initialTestAccessObjectIds = [...new Set(options.initialTestAccessObjectIds.map((userId) => userId.trim()).filter(Boolean))];

  const definitions: EnvironmentDefinition[] = [
    { id: 'environment-live', kind: 'environmentDefinition', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'live', label: 'Live', active: true, createdAt: timestamp, updatedAt: timestamp },
    { id: 'environment-test', kind: 'environmentDefinition', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'test', label: 'Test', active: true, createdAt: timestamp, updatedAt: timestamp },
  ];
  const existingDefinitions = await control.items.query<EnvironmentDefinition>({ query: 'SELECT * FROM c WHERE c.pk = @pk AND c.kind = "environmentDefinition"', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
  const existingDefinitionIds = new Set(existingDefinitions.resources.map((definition) => definition.id));
  for (const definition of definitions) if (!existingDefinitionIds.has(definition.id)) await control.items.create(definition);

  if (!await hasAnyWorkspaceRecords(live)) {
    await writeRecords(live, liveBootstrapRecords(options.orgAdminObjectId, options.adminName, options.adminEmail));
  } else {
    const existing = await live.items.query<WorkspaceRecord>({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    const records = existing.resources;
    addBootstrapAdmin(records, options.orgAdminObjectId, options.adminName, options.adminEmail, 'live');
    await writeRecords(live, records.filter((record) => record.kind === 'user' || record.kind === 'teamMembership'));
  }

  if (!await hasAnyWorkspaceRecords(test)) {
    const fixture = new MemoryWorkspaceRepository('test').exportWorkspaceRecords();
    addBootstrapAdmin(fixture, options.orgAdminObjectId, options.adminName, options.adminEmail, 'test');
    for (const userId of initialTestAccessObjectIds) addBootstrapAdmin(fixture, userId, options.adminName, options.adminEmail, 'test');
    await writeRecords(test, fixture);
  } else {
    const existing = await test.items.query<WorkspaceRecord>({ query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    const records = existing.resources;
    addBootstrapAdmin(records, options.orgAdminObjectId, options.adminName, options.adminEmail, 'test');
    for (const userId of initialTestAccessObjectIds) addBootstrapAdmin(records, userId, options.adminName, options.adminEmail, 'test');
    await writeRecords(test, records.filter((record) => record.kind === 'user' || record.kind === 'teamMembership'));
  }

  if (initialTestAccessObjectIds.length) {
    const existingGrants = await control.items.query<EnvironmentAccessGrant>({ query: 'SELECT * FROM c WHERE c.pk = @pk AND c.kind = "environmentAccessGrant"', parameters: [{ name: '@pk', value: CONTROL_PARTITION }] }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    const existingGrantIds = new Set(existingGrants.resources.map((grant) => grant.id));
    for (const userId of initialTestAccessObjectIds) {
      if (existingGrantIds.has(`environment-access-test-${userId}`)) continue;
      const grant: EnvironmentAccessGrant = { id: `environment-access-test-${userId}`, kind: 'environmentAccessGrant', pk: CONTROL_PARTITION, orgId: ORG_ID, userId, environmentId: 'test', allowed: true, grantedAt: timestamp, grantedBy: options.orgAdminObjectId, createdAt: timestamp, updatedAt: timestamp, updatedBy: options.orgAdminObjectId, version: 1 };
      const audit: EnvironmentAccessAudit = { id: `environment-audit-bootstrap-${safeId(userId)}`, kind: 'environmentAccessAudit', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'control', actorId: options.orgAdminObjectId, targetUserId: userId, action: 'granted', createdAt: timestamp };
      const operations = [
        { operationType: 'Create', resourceBody: grant as unknown as Record<string, unknown> },
        { operationType: 'Create', resourceBody: audit as unknown as Record<string, unknown> },
      ] as unknown as import('@azure/cosmos').OperationInput[];
      const response = await control.items.batch(operations, CONTROL_PARTITION);
      const failed = response.result?.find((item) => item.statusCode >= 400);
      if (failed) throw new Error(`Unable to create initial Test access for ${userId} (Cosmos status ${failed.statusCode}).`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orgAdminFlagIndex = process.argv.indexOf('--org-admin-object-id');
  const orgAdminObjectId = process.env.INITIAL_ORG_ADMIN_OBJECT_ID ?? (orgAdminFlagIndex >= 0 ? process.argv[orgAdminFlagIndex + 1] : undefined);
  if (!orgAdminObjectId) throw new Error('Pass INITIAL_ORG_ADMIN_OBJECT_ID or --org-admin-object-id.');
  const initialTestAccessObjectIds = (process.env.INITIAL_TEST_ACCESS_OBJECT_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  await bootstrapEnvironments({ orgAdminObjectId, adminName: process.env.INITIAL_ORG_ADMIN_NAME ?? 'Initial Org Admin', adminEmail: process.env.INITIAL_ORG_ADMIN_EMAIL ?? 'admin@invalid.local', initialTestAccessObjectIds });
  console.log('Environment bootstrap completed. Existing workspace records were preserved.');
}
