import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { ClientPrincipal } from '../auth.js';
import {
  canAcceptTransfer,
  canAdministerPlatform,
  canWriteTeam,
  DEFAULT_ISSUE_AGE_SETTINGS,
  DEFAULT_MEETING_SECTIONS,
  issueAgeBand,
  meetingSectionsFor,
  partitionFor,
  type AuditEventRecord,
  type CompanyOverview,
  type DashboardSummary,
  type EnvironmentId,
  type IssueAgeSettings,
  type IssueAgeSettingsRecord,
  type IssueRecord,
  type IssueTransferRecord,
  type MeetingIssueNoteRecord,
  type MeetingRecord,
  type TeamMessageRecord,
  type NotificationRecord,
  type RockRecord,
  type RockTaskRecord,
  type SessionContext,
  type TeamMembership,
  type TeamRecord,
  type TeamWorkspace,
  type WorkspaceSnapshot,
  type TodoRecord,
  type UserProfile,
  type WorkspaceRecord,
} from '../domain.js';

export type RepositoryErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE';

export class RepositoryError extends Error {
  constructor(public readonly code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export interface AdminSnapshot {
  teams: TeamRecord[];
  users: UserProfile[];
  memberships: TeamMembership[];
  settings: IssueAgeSettings;
  audit: AuditEventRecord[];
  etag: string;
}

export interface WorkspaceRepository {
  readonly environmentId: EnvironmentId;
  getTeamMembership(teamId: string, userId: string): Promise<TeamMembership | null>;
  getLeadershipMembership(userId: string): Promise<TeamMembership | null>;
  getUser(userId: string): Promise<UserProfile | null>;
  getTeams(): Promise<TeamRecord[]>;
  getSessionContext(userId: string): Promise<SessionContext | null>;
  getTeamDashboard(teamId: string, userId?: string): Promise<DashboardSummary>;
  getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace>;
  getWorkspaceSnapshot(userId: string): Promise<WorkspaceSnapshot>;
  getCompanyOverview(userId: string): Promise<CompanyOverview>;
  getNotifications(userId: string): Promise<NotificationRecord[]>;
  markNotificationRead(notificationId: string, userId: string, expectedVersion?: number): Promise<NotificationRecord>;
  getIssue(issueId: string, userId: string): Promise<IssueRecord>;
  updateRockStatus(rockId: string, status: RockRecord['status'], actorId: string, expectedVersion?: number): Promise<RockRecord>;
  updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number): Promise<RockRecord>;
  updateTodoStatus(todoId: string, status: TodoRecord['status'], actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  updateTodo(todoId: string, input: Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  moveTodoForward(todoId: string, dueDate: string, actorId: string, expectedVersion?: number): Promise<{ todo: TodoRecord; issue?: IssueRecord }>;
  createIssue(input: { teamId: string; title: string; detail?: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; raisedById: string; ownerId?: string; linkedRockId?: string; idsNote?: string }, actorId: string): Promise<IssueRecord>;
  updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number): Promise<{ issue: IssueRecord; meeting: MeetingRecord }>;
  startIssue(issueId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  solveIssue(issueId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  createRock(input: { teamId: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string): Promise<RockRecord>;
  createTodo(input: { teamId: string; title: string; notes?: string; ownerId: string; dueDate: string; linkedRockTaskId?: string }, actorId: string): Promise<TodoRecord>;
  createRockTask(input: { rockId: string; title: string; notes?: string; assigneeId: string; assignedAt: string; startDate: string; dueDate: string }, actorId: string): Promise<RockTaskRecord>;
  updateRockTask(taskId: string, input: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number): Promise<RockTaskRecord>;
  convertRockTaskToTodo(taskId: string, actorId: string): Promise<{ task: RockTaskRecord; todo: TodoRecord }>;
  getIssueTransfer(transferId: string): Promise<IssueTransferRecord>;
  requestIssueTransfer(input: { issueId: string; destinationTeamId: string; requestedById: string; note?: string; idempotencyKey?: string }): Promise<IssueTransferRecord>;
  acceptIssueTransfer(transferId: string, decidedById: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  rejectIssueTransfer(transferId: string, decidedById: string, message: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  cancelIssueTransfer(transferId: string, cancelledById: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  sendTeamMessage(input: { fromTeamId: string; toTeamId: string; subject: string; body: string; senderId: string }): Promise<TeamMessageRecord>;
  markMessageRead(messageId: string, userId: string, expectedVersion?: number): Promise<TeamMessageRecord>;
  createIssueFromMessage(input: { messageId: string; title: string; detail: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string): Promise<IssueRecord>;
  closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  getAdminSnapshot(actorId: string): Promise<AdminSnapshot>;
  createTeam(input: Omit<TeamRecord, keyof WorkspaceRecord | 'teamId' | 'active' | 'memberCount'> & { teamId?: string }, actorId: string): Promise<TeamRecord>;
  updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number): Promise<TeamRecord>;
  createUser(input: { name: string; email: string; accent: string; platformAdmin?: boolean }, actorId: string): Promise<UserProfile>;
  upsertMembership(input: { userId: string; teamId: string; role: TeamMembership['role'] }, actorId: string): Promise<TeamMembership>;
  updateAgeSettings(settings: IssueAgeSettings, actorId: string, expectedVersion?: number): Promise<IssueAgeSettings>;
  updateUserProfile(input: { name?: string; email?: string; avatarDataUrl?: string | null }, actorId: string, expectedVersion?: number): Promise<UserProfile>;
}

const DAY = 24 * 60 * 60 * 1000;
const ORG_ID = process.env.BREMMAR_ORG_ID ?? 'bremmar';
const nowIso = () => new Date().toISOString();
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const clone = <T,>(value: T): T => structuredClone(value);
const idFor = (prefix: string, value: string) => `${prefix}-${value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || Date.now()}`;
const generatedId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function baseRecord(id: string, kind: WorkspaceRecord['kind'], teamId?: string, version = 1): WorkspaceRecord {
  const timestamp = nowIso();
  return { id, kind, pk: teamId ? partitionFor('team', teamId) : partitionFor('org', ORG_ID), orgId: ORG_ID, teamId, createdAt: timestamp, updatedAt: timestamp, updatedBy: 'system', version };
}

function issueAge(issue: IssueRecord, settings: IssueAgeSettings, at = Date.now()): IssueRecord {
  const end = issue.solvedAt ? new Date(issue.solvedAt).getTime() : at;
  const created = new Date(issue.createdAt).getTime();
  const ageInDays = Number.isFinite(created) ? Math.max(0, Math.floor((end - created) / DAY)) : 0;
  return { ...issue, ageInDays, ageBand: issueAgeBand(ageInDays, settings) };
}

function emptyDashboard(teamId: string): DashboardSummary {
  return {
    teamId,
    rocks: { total: 0, onTrack: 0, offTrack: 0, complete: 0 },
    todos: { total: 0, done: 0, open: 0, notDone: 0 },
    issues: { total: 0, open: 0, inIds: 0, solved: 0, aging: 0, stale: 0, critical: 0 },
    metrics: { total: 0, onTrack: 0, offTrack: 0 },
  };
}

function dashboardFor(teamId: string, rocks: RockRecord[], todos: TodoRecord[], issues: IssueRecord[]): DashboardSummary {
  const dashboard = emptyDashboard(teamId);
  for (const rock of rocks) {
    dashboard.rocks.total += 1;
    if (rock.status === 'on-track') dashboard.rocks.onTrack += 1;
    if (rock.status === 'off-track') dashboard.rocks.offTrack += 1;
    if (rock.status === 'complete') dashboard.rocks.complete += 1;
  }
  for (const todo of todos) {
    dashboard.todos.total += 1;
    if (todo.status === 'done') dashboard.todos.done += 1;
    if (todo.status === 'open') dashboard.todos.open += 1;
    if (todo.status === 'not-done') dashboard.todos.notDone += 1;
  }
  for (const issue of issues.filter((item) => item.assignmentState !== 'redirected')) {
    dashboard.issues.total += 1;
    if (issue.status === 'open') dashboard.issues.open += 1;
    if (issue.status === 'in-ids') dashboard.issues.inIds += 1;
    if (issue.status === 'solved') dashboard.issues.solved += 1;
    if (issue.ageBand === 'aging') dashboard.issues.aging += 1;
    if (issue.ageBand === 'stale') dashboard.issues.stale += 1;
    if (issue.ageBand === 'critical') dashboard.issues.critical += 1;
  }
  return dashboard;
}

function etagFor(records: readonly WorkspaceRecord[]) {
  const version = records.reduce((highest, record) => Math.max(highest, record.version), 0);
  return `W/\"${version}\"`;
}

function assertExpectedVersion(actual: number, expectedVersion?: number) {
  if (expectedVersion !== undefined && actual !== expectedVersion) throw new RepositoryError('CONFLICT', 'The record changed elsewhere. Refresh and try again.');
}

function assertText(value: string, field: string) {
  if (!value.trim()) throw new RepositoryError('VALIDATION', `${field} is required.`);
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) throw new RepositoryError('VALIDATION', `${field} must be a valid date.`);
}

function appendMeetingNote(current: string | undefined, label: string, note: string) {
  const entry = `[${label}] ${note.trim()}`;
  return current?.trim() ? `${current.trim()}\n\n${entry}` : entry;
}

function meetingRecap(team: TeamRecord, meeting: MeetingRecord, rocks: RockRecord[], todos: TodoRecord[], issues: IssueRecord[], manualNotes: string) {
  const ids = meeting.idsIssueIds.map((id) => issues.find((issue) => issue.id === id)).filter((issue): issue is IssueRecord => Boolean(issue));
  const lines = [`${team.name} L10 recap · ${meeting.dateLabel}`, ''];
  for (const [section, note] of Object.entries(meeting.sectionNotes)) {
    if (note?.trim()) lines.push(`${section}: ${note.trim()}`);
  }
  lines.push(`Rock Review: ${rocks.length ? rocks.map((rock) => `${rock.title} (${rock.progress}% · ${rock.status})`).join('; ') : 'no Rocks recorded.'}`);
  lines.push(`To-Do Review: ${todos.length ? todos.map((todo) => `${todo.title} — ${todo.status} · due ${todo.dueDate}`).join('; ') : 'no To-Dos recorded.'}`);
  lines.push(`IDS: ${ids.length ? ids.map((issue) => `${issue.title} — ${issue.status}${issue.idsNote ? ` · ${issue.idsNote.split('\n').at(-1)}` : ''}`).join('; ') : 'no Issues entered into IDS.'}`);
  if (meeting.createdTodoIds.length) lines.push(`Created To-Dos: ${meeting.createdTodoIds.map((id) => todos.find((todo) => todo.id === id)?.title ?? id).join('; ')}`);
  if (meeting.idsNotes.length) lines.push(`Meeting IDS notes: ${meeting.idsNotes.map((note) => note.note).join(' | ')}`);
  if (manualNotes.trim()) lines.push(`Facilitator notes: ${manualNotes.trim()}`);
  return lines.join('\n');
}

function makeTeam(input: Partial<TeamRecord> & { teamId: string; name: string; shortName: string; parentTeamId: string | null; nodeType: TeamRecord['nodeType'] }): TeamRecord {
  const record = baseRecord(input.teamId, 'team');
  return {
    ...record,
    kind: 'team',
    teamId: input.teamId,
    name: input.name,
    shortName: input.shortName,
    description: input.description ?? '',
    parentTeamId: input.parentTeamId,
    nodeType: input.nodeType,
    active: input.active ?? true,
    meetingDay: input.meetingDay ?? 'Monday',
    meetingTime: input.meetingTime ?? '9:00 AM',
    accent: input.accent ?? '#4c8f86',
    initials: input.initials ?? input.shortName.slice(0, 2).toUpperCase(),
    meetingSections: clone(input.meetingSections ?? DEFAULT_MEETING_SECTIONS),
    escalationUserIds: [...(input.escalationUserIds ?? [])],
  };
}

function makeUser(input: { id: string; name: string; email: string; accent: string; platformAdmin?: boolean }): UserProfile {
  const record = baseRecord(input.id, 'user');
  return {
    ...record,
    kind: 'user',
    name: input.name,
    email: input.email,
    initials: input.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    accent: input.accent,
    active: true,
    platformCapabilities: input.platformAdmin ? ['PlatformAdmin'] : [],
  };
}

function makeMembership(id: string, teamId: string, userId: string, role: TeamMembership['role']): TeamMembership {
  return { ...baseRecord(id, 'teamMembership'), kind: 'teamMembership', teamId, userId, role, active: true };
}

function makeRock(input: { id: string; teamId: string; title: string; ownerId: string; status?: RockRecord['status']; progress?: number; dueDate?: string; priority?: RockRecord['priority'] }): RockRecord {
  return { ...baseRecord(input.id, 'rock', input.teamId), kind: 'rock', teamId: input.teamId, quarterId: '2026-q3', title: input.title, description: '', notes: '', ownerId: input.ownerId, status: input.status ?? 'on-track', progress: input.progress ?? 0, dueDate: input.dueDate ?? '2026-09-30', priority: input.priority ?? 'medium' };
}

function makeTodo(input: { id: string; teamId: string; title: string; ownerId: string; status?: TodoRecord['status']; dueDate?: string; linkedRockTaskId?: string }): TodoRecord {
  return { ...baseRecord(input.id, 'todo', input.teamId), kind: 'todo', teamId: input.teamId, title: input.title, notes: '', ownerId: input.ownerId, dueDate: input.dueDate ?? '2026-09-05', status: input.status ?? 'open', origin: 'Team workspace', linkedRockTaskId: input.linkedRockTaskId, carryForwardCount: 0, flagged: false };
}

function makeIssue(input: { id: string; teamId: string; title: string; raisedById: string; ageInDays: number; horizon?: IssueRecord['horizon']; assignmentState?: IssueRecord['assignmentState']; currentTeamId?: string | null; status?: IssueRecord['status']; ownerId?: string }): IssueRecord {
  const record = baseRecord(input.id, 'issue', input.teamId);
  const createdAt = daysAgo(input.ageInDays);
  return { ...record, kind: 'issue', teamId: input.teamId, sourceTeamId: input.teamId, currentTeamId: input.currentTeamId === undefined ? input.teamId : input.currentTeamId, title: input.title, detail: '', category: 'General', priority: 1, status: input.status ?? 'open', horizon: input.horizon ?? 'short-term', assignmentState: input.assignmentState ?? 'assigned', raisedById: input.raisedById, ownerId: input.ownerId ?? input.raisedById, ageInDays: input.ageInDays, ageBand: issueAgeBand(input.ageInDays), meetingsPassed: 0, escalationState: 'not-scheduled', escalationLevel: 0, createdAt, updatedAt: createdAt, updatedBy: input.raisedById, version: 1 };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly environmentId: EnvironmentId;
  protected teams: TeamRecord[];
  protected users: UserProfile[];
  protected memberships: TeamMembership[];
  protected rocks: RockRecord[];
  protected tasks: RockTaskRecord[];
  protected todos: TodoRecord[];
  protected issues: IssueRecord[];
  protected transfers: IssueTransferRecord[];
  protected notifications: NotificationRecord[];
  protected messages: TeamMessageRecord[];
  protected meetings: MeetingRecord[];
  protected audit: AuditEventRecord[];
  protected settings: IssueAgeSettings;
  protected settingsVersion = 1;

  constructor(environmentId: EnvironmentId = 'live') {
    this.environmentId = environmentId;
    this.teams = [
      makeTeam({ teamId: 'leadership', name: 'Leadership Team', shortName: 'Leadership', description: 'Company-level direction and visibility.', parentTeamId: null, nodeType: 'operational', meetingDay: 'Monday', meetingTime: '9:00 AM', accent: '#182b4b', initials: 'LT', escalationUserIds: ['ava-khan'] }),
      makeTeam({ teamId: 'professional-services', name: 'Professional Services', shortName: 'Prof Services', description: 'Professional Services business unit.', parentTeamId: 'leadership', nodeType: 'operational', accent: '#746cb5', initials: 'PS', escalationUserIds: ['ava-khan', 'marcus-lee'] }),
      makeTeam({ teamId: 'projects', name: 'Projects', shortName: 'Projects', description: 'Project delivery team.', parentTeamId: 'professional-services', nodeType: 'operational', accent: '#007e32', initials: 'PR', escalationUserIds: ['marcus-lee', 'ava-khan'] }),
      makeTeam({ teamId: 'cybersecurity', name: 'Cybersecurity', shortName: 'Cyber', description: 'Security advisory and evidence.', parentTeamId: 'professional-services', nodeType: 'operational', accent: '#df6654', initials: 'CY', meetingSections: DEFAULT_MEETING_SECTIONS.map((section) => section.id === 'scorecard' ? { ...section, enabled: false } : section), escalationUserIds: ['priya-shah', 'ava-khan'] }),
      makeTeam({ teamId: 'managed-services', name: 'Managed Services', shortName: 'Managed', description: 'Managed Services business unit.', parentTeamId: 'leadership', nodeType: 'operational', accent: '#4c8f86', initials: 'MS', escalationUserIds: ['ava-khan'] }),
      makeTeam({ teamId: 'service-development', name: 'Service Development', shortName: 'Service Dev', description: 'Managed service development.', parentTeamId: 'managed-services', nodeType: 'operational', accent: '#6787b7', initials: 'SD', escalationUserIds: ['maria-ortiz', 'ava-khan'] }),
      makeTeam({ teamId: 'service-delivery', name: 'Service Delivery', shortName: 'Delivery', description: 'Managed service delivery.', parentTeamId: 'managed-services', nodeType: 'operational', accent: '#b78433', initials: 'DV', escalationUserIds: ['jon-bell', 'ava-khan'] }),
    ];
    this.users = [
      makeUser({ id: 'ava-khan', name: 'Ava Khan', email: 'ava@bremmar.com', accent: '#007e32', platformAdmin: true }),
      makeUser({ id: 'marcus-lee', name: 'Marcus Lee', email: 'marcus@bremmar.com', accent: '#6787b7' }),
      makeUser({ id: 'priya-shah', name: 'Priya Shah', email: 'priya@bremmar.com', accent: '#df6654' }),
      makeUser({ id: 'maria-ortiz', name: 'Maria Ortiz', email: 'maria@bremmar.com', accent: '#746cb5' }),
      makeUser({ id: 'jon-bell', name: 'Jon Bell', email: 'jon@bremmar.com', accent: '#4c8f86' }),
      makeUser({ id: 'maya-green', name: 'Maya Green', email: 'maya@bremmar.com', accent: '#c17872' }),
    ];
    this.memberships = [
      makeMembership('membership-ava-leadership', 'leadership', 'ava-khan', 'TeamLead'),
      makeMembership('membership-marcus-projects', 'projects', 'marcus-lee', 'TeamLead'),
      makeMembership('membership-maya-projects', 'projects', 'maya-green', 'Member'),
      makeMembership('membership-priya-cybersecurity', 'cybersecurity', 'priya-shah', 'TeamLead'),
      makeMembership('membership-maya-cybersecurity', 'cybersecurity', 'maya-green', 'Member'),
      makeMembership('membership-maria-service-development', 'service-development', 'maria-ortiz', 'TeamLead'),
      makeMembership('membership-jon-service-delivery', 'service-delivery', 'jon-bell', 'TeamLead'),
      makeMembership('membership-ava-professional-services', 'professional-services', 'ava-khan', 'Viewer'),
      makeMembership('membership-ava-managed-services', 'managed-services', 'ava-khan', 'Viewer'),
    ];
    this.rocks = [
      makeRock({ id: 'rock-project-kickoff', teamId: 'projects', title: 'Standardise the implementation kickoff', ownerId: 'marcus-lee', progress: 58, priority: 'high' }),
      makeRock({ id: 'rock-cyber-readiness', teamId: 'cybersecurity', title: 'Close the security evidence gaps', ownerId: 'priya-shah', status: 'off-track', progress: 41, priority: 'high' }),
      makeRock({ id: 'rock-service-health', teamId: 'service-development', title: 'Release the service health playbook', ownerId: 'maria-ortiz', progress: 54, priority: 'medium' }),
    ];
    this.tasks = [];
    this.todos = [
      makeTodo({ id: 'todo-project-kickoff', teamId: 'projects', title: 'Pilot the new implementation kickoff checklist', ownerId: 'marcus-lee' }),
      makeTodo({ id: 'todo-evidence', teamId: 'cybersecurity', title: 'Confirm the evidence owner matrix', ownerId: 'priya-shah', status: 'not-done' }),
      makeTodo({ id: 'todo-health', teamId: 'service-development', title: 'Draft the service health review template', ownerId: 'maria-ortiz' }),
    ];
    this.issues = [
      makeIssue({ id: 'issue-project-scope', teamId: 'projects', title: 'Implementation scope changes are not visible early enough', raisedById: 'marcus-lee', ageInDays: 8, ownerId: 'marcus-lee' }),
      makeIssue({ id: 'issue-cyber-owners', teamId: 'cybersecurity', title: 'Evidence ownership is unclear across service teams', raisedById: 'priya-shah', ageInDays: 18, assignmentState: 'unassigned', currentTeamId: null, ownerId: undefined }),
      makeIssue({ id: 'issue-transfer-pending', teamId: 'projects', title: 'The customer kickoff needs a cybersecurity review', raisedById: 'marcus-lee', ageInDays: 22, assignmentState: 'pending-transfer', currentTeamId: 'projects', ownerId: 'marcus-lee' }),
    ];
    this.transfers = [{
      ...baseRecord('transfer-projects-leadership', 'issueTransfer'), kind: 'issueTransfer', issueId: 'issue-transfer-pending', sourceTeamId: 'projects', destinationTeamId: 'leadership', requestedById: 'marcus-lee', requestedAt: daysAgo(2), status: 'pending', note: 'Confirm the right receiving team.', sourceIssueVersion: 1, version: 1,
    }];
    this.notifications = [{
      ...baseRecord('notification-ava-transfer', 'notification'), kind: 'notification', recipientUserId: 'ava-khan', type: 'issue-transfer-requested', title: 'Issue transferred to Leadership', message: 'Projects sent an Issue to Leadership. Accept or reject the handoff before the next L10.', issueId: 'issue-transfer-pending', transferId: 'transfer-projects-leadership', teamId: 'leadership',
    }];
    this.messages = [{
      ...baseRecord('message-projects-kickoff', 'message'), kind: 'message', fromTeamId: 'projects', toTeamId: 'leadership', senderId: 'marcus-lee', subject: 'Security review needed for the next kickoff', body: 'Projects has a proposed kickoff change that needs a security owner before the customer session.', status: 'unread', updatedBy: 'marcus-lee',
    }];
    this.meetings = this.teams.filter((team) => team.nodeType === 'operational').map((team) => {
      const issueIds = this.issues.filter((issue) => issue.teamId === team.teamId && issue.horizon === 'short-term' && issue.assignmentState !== 'redirected').map((issue) => issue.id);
      const sections = meetingSectionsFor(team);
      return { ...baseRecord(`meeting-${team.teamId}-current`, 'meeting', team.teamId), kind: 'meeting', teamId: team.teamId, label: `${team.shortName} L10`, dateLabel: `This week · ${team.meetingDay}`, status: 'upcoming', facilitatorId: team.escalationUserIds[0] ?? 'ava-khan', attendeeIds: this.memberships.filter((membership) => membership.teamId === team.teamId && membership.active).map((membership) => membership.userId), lastRating: 8, agendaProgress: 0, agendaTotal: sections.length, idsSolved: 0, idsTotal: issueIds.length, recap: '', sectionNotes: {}, idsIssueIds: [], createdTodoIds: [], idsNotes: [] } satisfies MeetingRecord;
    });
    this.settings = clone(DEFAULT_ISSUE_AGE_SETTINGS);
    this.audit = [{
      ...baseRecord('audit-seed', 'auditEvent'), kind: 'auditEvent', actorId: 'ava-khan', action: 'Created workspace hierarchy', target: ORG_ID, detail: 'Seeded the Leadership, Professional Services, and Managed Services structure.', eventType: 'team',
    }];
    this.refreshDerivedState();
  }

  protected refreshDerivedState() {
    this.teams = this.teams.map((team) => ({ ...team, meetingSections: team.meetingSections?.length ? team.meetingSections : clone(DEFAULT_MEETING_SECTIONS), escalationUserIds: team.escalationUserIds ?? [] }));
    this.todos = this.todos.map((todo) => ({ ...todo, carryForwardCount: todo.carryForwardCount ?? 0, flagged: todo.flagged ?? false }));
    this.issues = this.issues.map((issue) => ({ ...issue, meetingsPassed: issue.meetingsPassed ?? 0, escalationState: issue.escalationState ?? 'not-scheduled', escalationLevel: issue.escalationLevel ?? 0 }));
    this.meetings = this.meetings.map((meeting) => ({ ...meeting, sectionNotes: meeting.sectionNotes ?? {}, idsIssueIds: meeting.idsIssueIds ?? [], createdTodoIds: meeting.createdTodoIds ?? [], idsNotes: meeting.idsNotes ?? [], agendaTotal: meetingSectionsFor(this.team(meeting.teamId) ?? { meetingSections: DEFAULT_MEETING_SECTIONS }).length }));
    this.issues = this.issues.map((issue) => issueAge(issue, this.settings));
  }

  protected user(userId: string) {
    return this.users.find((user) => user.id === userId && user.active) ?? null;
  }

  protected team(teamId: string) {
    return this.teams.find((team) => team.teamId === teamId && team.active) ?? null;
  }

  protected membership(teamId: string, userId: string) {
    return this.memberships.find((membership) => membership.teamId === teamId && membership.userId === userId && membership.active) ?? null;
  }

  protected leadershipMember(userId: string) {
    return this.membership('leadership', userId);
  }

  protected requireUser(userId: string) {
    const user = this.user(userId);
    if (!user) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    return user;
  }

  protected requireAdmin(actorId: string) {
    const user = this.requireUser(actorId);
    if (!canAdministerPlatform(user.platformCapabilities) && !this.memberships.some((membership) => membership.userId === actorId && membership.teamId === 'leadership' && membership.role === 'OrgAdmin' && membership.active)) throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required.');
    return user;
  }

  protected canReadTeam(teamId: string, userId: string) {
    return Boolean(this.membership(teamId, userId) || this.leadershipMember(userId));
  }

  protected requireRead(teamId: string, userId: string) {
    if (!this.team(teamId) || !this.canReadTeam(teamId, userId)) throw new RepositoryError('FORBIDDEN', 'You do not have access to this team.');
  }

  protected requireWrite(teamId: string, userId: string) {
    const membership = this.membership(teamId, userId);
    if (!membership || !canWriteTeam(membership.role)) throw new RepositoryError('FORBIDDEN', 'You need team editing access for this action.');
    return membership;
  }

  protected recordAudit(actorId: string, action: string, target: string, detail: string, eventType: AuditEventRecord['eventType']) {
    const record = baseRecord(generatedId('audit'), 'auditEvent');
    this.audit.unshift({ ...record, kind: 'auditEvent', actorId, action, target, detail, eventType, updatedBy: actorId, environmentId: this.environmentId });
  }

  protected notify(recipientUserId: string, input: Omit<NotificationRecord, keyof WorkspaceRecord | 'recipientUserId' | 'kind'> & { teamId?: string }) {
    const record = baseRecord(generatedId('notification'), 'notification');
    this.notifications.unshift({ ...record, ...input, kind: 'notification', recipientUserId, updatedBy: 'system', environmentId: this.environmentId });
  }

  protected activeIssue(issueId: string) {
    return [...this.issues].reverse().find((issue) => issue.id === issueId && issue.assignmentState !== 'redirected') ?? null;
  }

  protected getDescendantIds(teamId: string): string[] {
    const children = this.teams.filter((team) => team.parentTeamId === teamId && team.active).map((team) => team.teamId);
    return children.flatMap((child) => [child, ...this.getDescendantIds(child)]);
  }

  /** Export a sanitized fixture for the one-way Test bootstrap operation. */
  exportWorkspaceRecords(): WorkspaceRecord[] {
    const settings: IssueAgeSettingsRecord = {
      ...baseRecord('issue-age-settings', 'issueAgeSettings'),
      kind: 'issueAgeSettings',
      agingDays: this.settings.agingDays,
      staleDays: this.settings.staleDays,
      criticalDays: this.settings.criticalDays,
      version: this.settings.version ?? this.settingsVersion,
    };
    return clone([...this.teams, ...this.users, ...this.memberships, ...this.rocks, ...this.tasks, ...this.todos, ...this.issues, ...this.transfers, ...this.notifications, ...this.messages, ...this.meetings, ...this.audit, settings].map((record) => ({ ...record, environmentId: this.environmentId })));
  }

  async getTeamMembership(teamId: string, userId: string) {
    return clone(this.membership(teamId, userId));
  }

  async getLeadershipMembership(userId: string) {
    return clone(this.leadershipMember(userId));
  }

  async getUser(userId: string) {
    return clone(this.user(userId));
  }

  async getTeams() {
    return clone(this.teams.filter((team) => team.active));
  }

  async getSessionContext(userId: string): Promise<SessionContext | null> {
    const user = this.user(userId);
    if (!user) return null;
    const memberships = this.memberships.filter((membership) => membership.userId === userId && membership.active);
    const leadershipVisible = memberships.some((membership) => membership.teamId === 'leadership');
    const teamIds = leadershipVisible ? this.teams.filter((team) => team.active).map((team) => team.teamId) : memberships.map((membership) => membership.teamId);
    return {
      user: clone(user),
      memberships: clone(memberships.map(({ teamId, role, active }) => ({ teamId, role, active }))),
      leadershipVisible,
      platformAdmin: canAdministerPlatform(user.platformCapabilities) || memberships.some((membership) => membership.teamId === 'leadership' && membership.role === 'OrgAdmin'),
      teams: clone(this.teams.filter((team) => teamIds.includes(team.teamId) && team.active).map(({ teamId, name, shortName, parentTeamId, nodeType, active }) => ({ teamId, name, shortName, parentTeamId, nodeType, active }))),
      currentEnvironment: this.environmentId,
    };
  }

  async getTeamDashboard(teamId: string, userId?: string) {
    if (!this.team(teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (userId) this.requireRead(teamId, userId);
    this.refreshDerivedState();
    return dashboardFor(teamId, this.rocks.filter((rock) => rock.teamId === teamId), this.todos.filter((todo) => todo.teamId === teamId), this.issues.filter((issue) => issue.teamId === teamId));
  }

  async getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace> {
    this.requireUser(userId);
    this.requireRead(teamId, userId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    this.refreshDerivedState();
    const rocks = this.rocks.filter((rock) => rock.teamId === teamId);
    const tasks = this.tasks.filter((task) => task.teamId === teamId);
    const todos = this.todos.filter((todo) => todo.teamId === teamId);
    const issues = this.issues.filter((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected');
    const transfers = this.transfers.filter((transfer) => transfer.sourceTeamId === teamId || transfer.destinationTeamId === teamId);
    const notifications = this.notifications.filter((notification) => notification.recipientUserId === userId && (!notification.teamId || notification.teamId === teamId));
    const messages = this.messages.filter((message) => message.fromTeamId === teamId || message.toTeamId === teamId);
    const meetings = this.meetings.filter((meeting) => meeting.teamId === teamId);
    return { environmentId: this.environmentId, team: clone(team), membership: clone(this.membership(teamId, userId) ? { teamId, role: this.membership(teamId, userId)!.role, active: true } : null), dashboard: dashboardFor(teamId, rocks, todos, issues), rocks: clone(rocks), tasks: clone(tasks), todos: clone(todos), issues: clone(issues), transfers: clone(transfers), notifications: clone(notifications), messages: clone(messages), meetings: clone(meetings), etag: etagFor([...rocks, ...tasks, ...todos, ...issues, ...transfers, ...messages, ...meetings]) };
  }

  async getWorkspaceSnapshot(userId: string): Promise<WorkspaceSnapshot> {
    const session = await this.getSessionContext(userId);
    if (!session) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    this.refreshDerivedState();
    const teamIds = new Set(session.teams.map((team) => team.teamId));
    const teams = this.teams.filter((team) => team.active && teamIds.has(team.teamId));
    const memberships = this.memberships.filter((membership) => membership.active && teamIds.has(membership.teamId));
    const rocks = this.rocks.filter((rock) => teamIds.has(rock.teamId));
    const tasks = this.tasks.filter((task) => teamIds.has(task.teamId));
    const todos = this.todos.filter((todo) => teamIds.has(todo.teamId));
    const issues = this.issues.filter((issue) => teamIds.has(issue.teamId) && issue.assignmentState !== 'redirected');
    const transfers = this.transfers.filter((transfer) => teamIds.has(transfer.sourceTeamId) || teamIds.has(transfer.destinationTeamId));
    const messages = this.messages.filter((message) => teamIds.has(message.fromTeamId) || teamIds.has(message.toTeamId));
    const meetings = this.meetings.filter((meeting) => teamIds.has(meeting.teamId));
    const notifications = this.notifications.filter((notification) => notification.recipientUserId === userId);
    const quarterEnd = new Date('2026-09-30T23:59:59Z').getTime();
    const daysRemaining = Math.max(0, Math.ceil((quarterEnd - Date.now()) / DAY));
    return {
      environmentId: this.environmentId,
      user: clone(this.user(userId)!),
      teams: clone(teams),
      users: clone(this.users.filter((user) => user.active)),
      memberships: clone(memberships),
      settings: clone(this.settings),
      rocks: clone(rocks),
      tasks: clone(tasks),
      todos: clone(todos),
      issues: clone(issues),
      transfers: clone(transfers),
      notifications: clone(notifications),
      messages: clone(messages),
      meetings: clone(meetings),
      metrics: [],
      headlines: [],
      audit: clone(this.audit),
      quarter: { id: '2026-q3', label: 'Q3 2026', theme: 'Make Q3 feel lighter.', startDate: '2026-07-01', endDate: '2026-09-30', daysRemaining },
      etag: etagFor([...teams, ...memberships, ...rocks, ...tasks, ...todos, ...issues, ...transfers, ...messages, ...meetings, ...notifications, ...this.audit]),
    };
  }

  async getCompanyOverview(userId: string): Promise<CompanyOverview> {
    this.requireUser(userId);
    if (!this.leadershipMember(userId)) throw new RepositoryError('FORBIDDEN', 'Leadership membership is required for company visibility.');
    this.refreshDerivedState();
    const issues = this.issues.filter((issue) => issue.assignmentState !== 'redirected');
    const teams = this.teams.filter((team) => team.active).map((team) => {
      const descendantIds = this.getDescendantIds(team.teamId);
      const directRocks = this.rocks.filter((rock) => rock.teamId === team.teamId);
      const directTodos = this.todos.filter((todo) => todo.teamId === team.teamId);
      const directIssues = issues.filter((issue) => issue.teamId === team.teamId);
      return {
        teamId: team.teamId,
        direct: {
          rocks: { total: directRocks.length, onTrack: directRocks.filter((rock) => rock.status === 'on-track').length, offTrack: directRocks.filter((rock) => rock.status === 'off-track').length, complete: directRocks.filter((rock) => rock.status === 'complete').length },
          todos: { total: directTodos.length, open: directTodos.filter((todo) => todo.status === 'open').length, done: directTodos.filter((todo) => todo.status === 'done').length, notDone: directTodos.filter((todo) => todo.status === 'not-done').length },
          issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, aging: directIssues.filter((issue) => issue.ageBand === 'aging').length, stale: directIssues.filter((issue) => issue.ageBand === 'stale').length, critical: directIssues.filter((issue) => issue.ageBand === 'critical').length },
        },
        descendants: { rocks: this.rocks.filter((rock) => descendantIds.includes(rock.teamId)).length, todos: this.todos.filter((todo) => descendantIds.includes(todo.teamId)).length, issues: issues.filter((issue) => descendantIds.includes(issue.teamId)).length },
      };
    });
    return { teams, issues: clone(issues), rocks: clone(this.rocks), todos: clone(this.todos), etag: etagFor([...this.teams, ...this.rocks, ...this.todos, ...issues]) };
  }

  async getNotifications(userId: string) {
    this.requireUser(userId);
    return clone(this.notifications.filter((notification) => notification.recipientUserId === userId));
  }

  async markNotificationRead(notificationId: string, userId: string, expectedVersion?: number) {
    this.requireUser(userId);
    const notification = this.notifications.find((item) => item.id === notificationId && item.recipientUserId === userId);
    if (!notification) throw new RepositoryError('NOT_FOUND', 'Notification not found.');
    assertExpectedVersion(notification.version, expectedVersion);
    notification.readAt = notification.readAt ?? nowIso();
    notification.updatedAt = nowIso();
    notification.updatedBy = userId;
    notification.version += 1;
    return clone(notification);
  }

  async getIssue(issueId: string, userId: string) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireRead(issue.teamId, userId);
    return clone(issueAge(issue, this.settings));
  }

  async updateRockStatus(rockId: string, status: RockRecord['status'], actorId: string, expectedVersion?: number) {
    const rock = this.rocks.find((item) => item.id === rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertExpectedVersion(rock.version, expectedVersion);
    if (!['on-track', 'off-track', 'complete'].includes(status)) throw new RepositoryError('VALIDATION', 'Invalid Rock status.');
    rock.status = status;
    if (status === 'complete') rock.progress = 100;
    rock.updatedAt = nowIso();
    rock.updatedBy = actorId;
    rock.version += 1;
    this.recordAudit(actorId, 'Updated Rock status', rock.id, `${rock.title} marked ${status}.`, 'rock');
    return clone(rock);
  }

  async updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number) {
    const rock = this.rocks.find((item) => item.id === rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertExpectedVersion(rock.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'Rock title');
    if (input.ownerId !== undefined && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Rock owner not found.');
    if (input.progress !== undefined && (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100)) throw new RepositoryError('VALIDATION', 'Rock progress must be between 0 and 100.');
    if (input.priority !== undefined && !['high', 'medium', 'low'].includes(input.priority)) throw new RepositoryError('VALIDATION', 'Invalid Rock priority.');
    Object.assign(rock, input, { updatedAt: nowIso(), updatedBy: actorId, version: rock.version + 1 });
    this.recordAudit(actorId, 'Updated Rock', rock.id, `Updated ${rock.title}.`, 'rock');
    return clone(rock);
  }

  async updateTodoStatus(todoId: string, status: TodoRecord['status'], actorId: string, expectedVersion?: number) {
    return this.updateTodo(todoId, { status }, actorId, expectedVersion);
  }

  async updateTodo(todoId: string, input: Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) {
    const todo = this.todos.find((item) => item.id === todoId);
    if (!todo) throw new RepositoryError('NOT_FOUND', 'To-Do not found.');
    this.requireWrite(todo.teamId, actorId);
    assertExpectedVersion(todo.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'To-Do title');
    if (input.ownerId !== undefined && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'To-Do owner not found.');
    if (input.status !== undefined && !['open', 'done', 'not-done'].includes(input.status)) throw new RepositoryError('VALIDATION', 'Invalid To-Do status.');
    const timestamp = nowIso();
    Object.assign(todo, input, { updatedAt: timestamp, updatedBy: actorId, version: todo.version + 1 });
    if (todo.linkedRockTaskId) {
      const task = this.tasks.find((item) => item.id === todo.linkedRockTaskId);
      if (task) {
        if (task.teamId !== todo.teamId) throw new RepositoryError('VALIDATION', 'Linked Rock Task must belong to the same team.');
        if (input.status !== undefined) task.status = input.status === 'done' ? 'done' : 'open';
        if (input.ownerId !== undefined) task.assigneeId = input.ownerId;
        if (input.dueDate !== undefined) task.dueDate = input.dueDate;
        task.updatedAt = timestamp;
        task.updatedBy = actorId;
        task.version += 1;
      }
    }
    this.recordAudit(actorId, 'Updated To-Do', todo.id, `Updated ${todo.title}.`, 'todo');
    return clone(todo);
  }

  async moveTodoForward(todoId: string, dueDate: string, actorId: string, expectedVersion?: number) {
    const todo = this.todos.find((item) => item.id === todoId);
    if (!todo) throw new RepositoryError('NOT_FOUND', 'To-Do not found.');
    this.requireWrite(todo.teamId, actorId);
    assertExpectedVersion(todo.version, expectedVersion);
    if (todo.status === 'done') throw new RepositoryError('VALIDATION', 'Completed To-Dos do not need to be moved forward.');
    assertDate(dueDate, 'Due date');
    const timestamp = nowIso();
    todo.dueDate = dueDate;
    todo.status = 'open';
    todo.carryForwardCount += 1;
    todo.flagged = todo.carryForwardCount > 3;
    todo.updatedAt = timestamp;
    todo.updatedBy = actorId;
    todo.version += 1;
    if (todo.linkedRockTaskId) {
      const task = this.tasks.find((item) => item.id === todo.linkedRockTaskId);
      if (task) {
        if (task.teamId !== todo.teamId) throw new RepositoryError('VALIDATION', 'Linked Rock Task must belong to the same team.');
        task.dueDate = dueDate;
        task.status = 'open';
        task.updatedAt = timestamp;
        task.updatedBy = actorId;
        task.version += 1;
      }
    }
    let issue: IssueRecord | undefined;
    if (todo.flagged && !todo.convertedIssueId) {
      issue = makeIssue({ id: `issue-todo-rollover-${todo.id}`, teamId: todo.teamId, title: `Repeated To-Do: ${todo.title}`, raisedById: actorId, ageInDays: 0, ownerId: todo.ownerId });
      issue.detail = `This To-Do was moved forward ${todo.carryForwardCount} times. Review the commitment in IDS and decide what must change.`;
      issue.category = 'To-Do rollover';
      issue.priority = 2;
      issue.sourceTodoId = todo.id;
      issue.updatedBy = actorId;
      this.issues.unshift(issue);
      todo.convertedIssueId = issue.id;
      this.recordAudit(actorId, 'Converted repeated To-Do to Issue', issue.id, `${todo.title} moved forward ${todo.carryForwardCount} times.`, 'issue');
    } else {
      this.recordAudit(actorId, 'Moved To-Do forward', todo.id, `${todo.title} moved to ${todo.dueDate} (${todo.carryForwardCount} times).`, 'todo');
    }
    return { todo: clone(todo), issue: issue ? clone(issue) : undefined };
  }

  async createIssue(input: { teamId: string; title: string; detail?: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; raisedById: string; ownerId?: string; linkedRockId?: string; idsNote?: string }, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own Issues.');
    assertText(input.title, 'Issue title');
    if (!this.user(input.raisedById)) throw new RepositoryError('FORBIDDEN', 'Issue creator is not an active organization user.');
    if (input.ownerId && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Issue owner not found.');
    const priority = input.priority ?? 1;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new RepositoryError('VALIDATION', 'Issue priority must be between 1 and 5.');
    const issue = makeIssue({ id: generatedId('issue'), teamId: input.teamId, title: input.title.trim(), raisedById: input.raisedById, ageInDays: 0, horizon: input.horizon, ownerId: input.ownerId ?? actorId });
    issue.detail = input.detail?.trim() ?? '';
    issue.category = input.category?.trim() || 'General';
    issue.priority = priority;
    issue.linkedRockId = input.linkedRockId;
    issue.idsNote = input.idsNote?.trim() || undefined;
    issue.updatedBy = actorId;
    this.issues.push(issue);
    this.recordAudit(actorId, 'Created Issue', issue.id, issue.title, 'issue');
    return clone(issue);
  }

  async updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'Issue title');
    if (input.ownerId !== undefined && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Issue owner not found.');
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5)) throw new RepositoryError('VALIDATION', 'Issue priority must be between 1 and 5.');
    if (input.horizon !== undefined && !['short-term', 'long-term'].includes(input.horizon)) throw new RepositoryError('VALIDATION', 'Invalid Issue horizon.');
    Object.assign(issue, input, { updatedAt: nowIso(), updatedBy: actorId, version: issue.version + 1 });
    this.recordAudit(actorId, 'Updated Issue', issue.id, `Updated ${issue.title}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number) {
    assertText(note, 'IDS note');
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    if (meeting.teamId !== issue.teamId) throw new RepositoryError('FORBIDDEN', 'The Issue and meeting must belong to the same team.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'Closed meetings cannot receive new IDS notes.');
    const timestamp = nowIso();
    const entry: MeetingIssueNoteRecord = { id: generatedId('meeting-note'), meetingId, issueId, authorId: actorId, note: note.trim(), createdAt: timestamp };
    meeting.idsNotes.push(entry);
    if (!meeting.idsIssueIds.includes(issueId)) meeting.idsIssueIds.push(issueId);
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    issue.idsNote = appendMeetingNote(issue.idsNote, meeting.dateLabel, note);
    if (issue.status === 'open') issue.status = 'in-ids';
    issue.updatedAt = timestamp;
    issue.updatedBy = actorId;
    issue.version += 1;
    this.recordAudit(actorId, 'Added meeting IDS note', issue.id, `Added an IDS note from ${meeting.label}.`, 'meeting');
    return { issue: clone(issueAge(issue, this.settings)), meeting: clone(meeting) };
  }

  async startIssue(issueId: string, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (issue.horizon !== 'short-term') throw new RepositoryError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    if (issue.assignmentState === 'pending-transfer') throw new RepositoryError('CONFLICT', 'A pending transfer must be decided before IDS starts.');
    issue.status = 'in-ids';
    issue.updatedAt = nowIso();
    issue.updatedBy = actorId;
    issue.version += 1;
    const meeting = this.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed');
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = issue.updatedAt;
      meeting.updatedBy = actorId;
      meeting.version += 1;
    }
    this.recordAudit(actorId, 'Started IDS', issue.id, `Started IDS for ${issue.title}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async solveIssue(issueId: string, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (issue.assignmentState === 'pending-transfer') throw new RepositoryError('CONFLICT', 'A pending transfer must be decided before the Issue is solved.');
    issue.status = 'solved';
    issue.solvedAt = nowIso();
    issue.updatedAt = issue.solvedAt;
    issue.updatedBy = actorId;
    issue.version += 1;
    const followUpId = `todo-follow-up-${issue.id}`;
    if (!this.todos.some((todo) => todo.id === followUpId)) {
      const followUp = makeTodo({ id: followUpId, teamId: issue.teamId, title: `Follow up on the solution: ${issue.title}`, ownerId: actorId, dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) });
      followUp.origin = `IDS · ${issue.title}`;
      followUp.updatedBy = actorId;
      this.todos.push(followUp);
      const meeting = this.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed');
      if (meeting) {
        meeting.createdTodoIds.push(followUp.id);
        meeting.updatedAt = followUp.updatedAt;
        meeting.updatedBy = actorId;
        meeting.version += 1;
      }
    }
    this.recordAudit(actorId, 'Solved Issue', issue.id, `Solved ${issue.title}; created follow-up To-Do ${followUpId}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async createRock(input: { teamId: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own Rocks.');
    assertText(input.title, 'Rock title');
    if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Rock owner not found.');
    const rock = makeRock({ id: generatedId('rock'), teamId: input.teamId, title: input.title.trim(), ownerId: input.ownerId, priority: input.priority, dueDate: input.dueDate });
    rock.description = input.description?.trim() ?? '';
    rock.notes = input.notes?.trim() ?? '';
    rock.updatedBy = actorId;
    this.rocks.push(rock);
    this.recordAudit(actorId, 'Created Rock', rock.id, rock.title, 'rock');
    return clone(rock);
  }

  async createTodo(input: { teamId: string; title: string; notes?: string; ownerId: string; dueDate: string; linkedRockTaskId?: string }, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own To-Dos.');
    assertText(input.title, 'To-Do title');
    if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'To-Do owner not found.');
    if (input.linkedRockTaskId) {
      const linkedTask = this.tasks.find((task) => task.id === input.linkedRockTaskId);
      if (!linkedTask) throw new RepositoryError('NOT_FOUND', 'Linked Rock Task not found.');
      if (linkedTask.teamId !== input.teamId) throw new RepositoryError('VALIDATION', 'Linked Rock Task must belong to the same team.');
      if (linkedTask.linkedTodoId) throw new RepositoryError('CONFLICT', 'This Rock Task already has a linked To-Do.');
    }
    const todo = makeTodo({ id: generatedId('todo'), teamId: input.teamId, title: input.title.trim(), ownerId: input.ownerId, dueDate: input.dueDate, linkedRockTaskId: input.linkedRockTaskId });
    todo.notes = input.notes?.trim() ?? '';
    todo.updatedBy = actorId;
    this.todos.push(todo);
    this.recordAudit(actorId, 'Created To-Do', todo.id, todo.title, 'todo');
    return clone(todo);
  }

  async createRockTask(input: { rockId: string; title: string; notes?: string; assigneeId: string; assignedAt: string; startDate: string; dueDate: string }, actorId: string) {
    const rock = this.rocks.find((item) => item.id === input.rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertText(input.title, 'Task title');
    if (!this.user(input.assigneeId)) throw new RepositoryError('VALIDATION', 'Task assignee not found.');
    const task: RockTaskRecord = { ...baseRecord(generatedId('task'), 'rockTask', rock.teamId), kind: 'rockTask', teamId: rock.teamId, rockId: rock.id, title: input.title.trim(), notes: input.notes?.trim() ?? '', assigneeId: input.assigneeId, assignedAt: input.assignedAt, startDate: input.startDate, dueDate: input.dueDate, status: 'open', updatedBy: actorId };
    this.tasks.push(task);
    this.recordAudit(actorId, 'Created Rock Task', task.id, task.title, 'rock');
    return clone(task);
  }

  private taskFor(taskId: string, actorId: string) {
    const task = this.tasks.find((item) => item.id === taskId);
    if (!task) throw new RepositoryError('NOT_FOUND', 'Rock Task not found.');
    this.requireWrite(task.teamId, actorId);
    return task;
  }

  private syncTaskTodo(task: RockTaskRecord, actorId: string) {
    if (!task.linkedTodoId) return;
    const todo = this.todos.find((item) => item.id === task.linkedTodoId);
    if (!todo) return;
    todo.ownerId = task.assigneeId;
    todo.dueDate = task.dueDate;
    todo.status = task.status === 'done' ? 'done' : 'open';
    todo.updatedAt = nowIso();
    todo.updatedBy = actorId;
    todo.version += 1;
  }

  async updateRockTask(taskId: string, input: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) {
    const task = this.taskFor(taskId, actorId);
    assertExpectedVersion(task.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'Task title');
    if (input.assigneeId !== undefined && !this.user(input.assigneeId)) throw new RepositoryError('VALIDATION', 'Task assignee not found.');
    if (input.status !== undefined && !['open', 'in-progress', 'done'].includes(input.status)) throw new RepositoryError('VALIDATION', 'Invalid Rock Task status.');
    Object.assign(task, input, { updatedAt: nowIso(), updatedBy: actorId, version: task.version + 1 });
    this.syncTaskTodo(task, actorId);
    this.recordAudit(actorId, 'Updated Rock Task', task.id, task.title, 'rock');
    return clone(task);
  }

  async convertRockTaskToTodo(taskId: string, actorId: string) {
    const task = this.taskFor(taskId, actorId);
    if (task.linkedTodoId) {
      const existing = this.todos.find((todo) => todo.id === task.linkedTodoId);
      if (existing) return { task: clone(task), todo: clone(existing) };
    }
    const todo = await this.createTodo({ teamId: task.teamId, title: task.title, notes: task.notes, ownerId: task.assigneeId, dueDate: task.dueDate }, actorId);
    const storedTodo = this.todos.find((item) => item.id === todo.id);
    if (!storedTodo) throw new RepositoryError('CONFLICT', 'The linked To-Do could not be created.');
    storedTodo.origin = `Rock Task · ${task.rockId}`;
    storedTodo.linkedRockTaskId = task.id;
    task.linkedTodoId = todo.id;
    task.updatedAt = nowIso();
    task.updatedBy = actorId;
    task.version += 1;
    this.recordAudit(actorId, 'Converted Rock Task to To-Do', task.id, `Linked ${task.title} to ${todo.id}.`, 'rock');
    return { task: clone(task), todo: clone(storedTodo) };
  }

  async getIssueTransfer(transferId: string) {
    const transfer = this.transfers.find((item) => item.id === transferId);
    if (!transfer) throw new RepositoryError('NOT_FOUND', 'Issue transfer not found.');
    return clone(transfer);
  }

  async requestIssueTransfer(input: { issueId: string; destinationTeamId: string; requestedById: string; note?: string; idempotencyKey?: string }) {
    const issue = this.activeIssue(input.issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, input.requestedById);
    const destination = this.team(input.destinationTeamId);
    if (!destination) throw new RepositoryError('NOT_FOUND', 'Destination team not found.');
    if (destination.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Issues can only be transferred to operational teams.');
    if (destination.teamId === issue.teamId) throw new RepositoryError('VALIDATION', 'Choose a different destination team.');
    if (issue.assignmentState === 'pending-transfer') {
      const existing = this.transfers.find((transfer) => transfer.issueId === issue.id && transfer.status === 'pending');
      if (existing && input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey) return clone(existing);
      throw new RepositoryError('CONFLICT', 'This Issue already has a pending transfer.');
    }
    if (input.idempotencyKey) {
      const existing = this.transfers.find((transfer) => transfer.idempotencyKey === input.idempotencyKey);
      if (existing) return clone(existing);
    }
    const timestamp = nowIso();
    const transfer: IssueTransferRecord = {
      ...baseRecord(generatedId('transfer'), 'issueTransfer'), kind: 'issueTransfer', issueId: issue.id, sourceTeamId: issue.teamId, destinationTeamId: destination.teamId, requestedById: input.requestedById, requestedAt: timestamp, status: 'pending', note: input.note?.trim() || undefined, sourceIssueVersion: issue.version, idempotencyKey: input.idempotencyKey, updatedBy: input.requestedById,
    };
    issue.assignmentState = 'pending-transfer';
    issue.currentTeamId = issue.teamId;
    issue.updatedAt = timestamp;
    issue.updatedBy = input.requestedById;
    issue.version += 1;
    transfer.sourceIssueVersion = issue.version;
    this.transfers.unshift(transfer);
    for (const membership of this.memberships.filter((item) => item.teamId === destination.teamId && item.active && item.role !== 'Viewer')) {
      this.notify(membership.userId, { type: 'issue-transfer-requested', title: 'Issue transfer needs a decision', message: `${issue.title} was sent from ${this.team(issue.teamId)?.name ?? issue.teamId}. Accept or reject it before the next L10.`, issueId: issue.id, transferId: transfer.id, teamId: destination.teamId });
    }
    this.recordAudit(input.requestedById, 'Requested Issue transfer', issue.id, `Sent the Issue from ${issue.teamId} to ${destination.teamId}.`, 'transfer');
    return clone(transfer);
  }

  private transferIssue(transferId: string) {
    const transfer = this.transfers.find((item) => item.id === transferId);
    if (!transfer) throw new RepositoryError('NOT_FOUND', 'Issue transfer not found.');
    const source = this.issues.find((issue) => issue.id === transfer.issueId && issue.teamId === transfer.sourceTeamId && issue.assignmentState !== 'redirected');
    if (!source) throw new RepositoryError('CONFLICT', 'The source Issue copy is no longer available.');
    return { transfer, source };
  }

  async acceptIssueTransfer(transferId: string, decidedById: string, expectedVersion?: number) {
    const { transfer, source } = this.transferIssue(transferId);
    assertExpectedVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new RepositoryError('CONFLICT', 'This transfer has already been decided.');
    const membership = this.membership(transfer.destinationTeamId, decidedById);
    if (!membership || !canAcceptTransfer(membership.role)) throw new RepositoryError('FORBIDDEN', 'Only a destination TeamLead or Member can accept this transfer.');
    assertExpectedVersion(source.version, transfer.sourceIssueVersion);
    const timestamp = nowIso();
    source.assignmentState = 'redirected';
    source.currentTeamId = transfer.destinationTeamId;
    source.updatedAt = timestamp;
    source.updatedBy = decidedById;
    source.version += 1;
    this.issues.push({ ...source, pk: partitionFor('team', transfer.destinationTeamId), teamId: transfer.destinationTeamId, currentTeamId: transfer.destinationTeamId, assignmentState: 'assigned', updatedAt: timestamp, updatedBy: decidedById, version: source.version });
    transfer.status = 'accepted';
    transfer.decidedById = decidedById;
    transfer.decidedAt = timestamp;
    transfer.updatedAt = timestamp;
    transfer.updatedBy = decidedById;
    transfer.version += 1;
    for (const membership of this.memberships.filter((item) => item.teamId === transfer.sourceTeamId && item.active)) {
      this.notify(membership.userId, { type: 'issue-transfer-decided', title: 'Issue transfer accepted', message: `${source.title} was accepted by ${this.team(transfer.destinationTeamId)?.name ?? transfer.destinationTeamId}.`, issueId: source.id, transferId: transfer.id, teamId: transfer.sourceTeamId });
    }
    this.recordAudit(decidedById, 'Accepted Issue transfer', source.id, `Accepted by ${transfer.destinationTeamId}; original copy redirected from ${transfer.sourceTeamId}.`, 'transfer');
    return clone(transfer);
  }

  async rejectIssueTransfer(transferId: string, decidedById: string, message: string, expectedVersion?: number) {
    assertText(message, 'Rejection message');
    const { transfer, source } = this.transferIssue(transferId);
    assertExpectedVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new RepositoryError('CONFLICT', 'This transfer has already been decided.');
    const membership = this.membership(transfer.destinationTeamId, decidedById);
    if (!membership || !canAcceptTransfer(membership.role)) throw new RepositoryError('FORBIDDEN', 'Only a destination TeamLead or Member can reject this transfer.');
    assertExpectedVersion(source.version, transfer.sourceIssueVersion);
    const timestamp = nowIso();
    source.assignmentState = 'unassigned';
    source.currentTeamId = null;
    source.ownerId = undefined;
    source.updatedAt = timestamp;
    source.updatedBy = decidedById;
    source.version += 1;
    transfer.status = 'rejected';
    transfer.decidedById = decidedById;
    transfer.decidedAt = timestamp;
    transfer.rejectionMessage = message.trim();
    transfer.updatedAt = timestamp;
    transfer.updatedBy = decidedById;
    transfer.version += 1;
    for (const membership of this.memberships.filter((item) => item.teamId === transfer.sourceTeamId && item.active)) {
      this.notify(membership.userId, { type: 'issue-transfer-decided', title: 'Issue returned unassigned', message: `${source.title} was rejected by ${this.team(transfer.destinationTeamId)?.name ?? transfer.destinationTeamId}. ${message.trim()}`, issueId: source.id, transferId: transfer.id, teamId: transfer.sourceTeamId });
    }
    this.recordAudit(decidedById, 'Rejected Issue transfer', source.id, `Returned the Issue to ${transfer.sourceTeamId} unassigned.`, 'transfer');
    return clone(transfer);
  }

  async cancelIssueTransfer(transferId: string, cancelledById: string, expectedVersion?: number) {
    const { transfer, source } = this.transferIssue(transferId);
    assertExpectedVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new RepositoryError('CONFLICT', 'This transfer has already been decided.');
    this.requireWrite(transfer.sourceTeamId, cancelledById);
    const timestamp = nowIso();
    source.assignmentState = 'assigned';
    source.currentTeamId = source.teamId;
    source.updatedAt = timestamp;
    source.updatedBy = cancelledById;
    source.version += 1;
    transfer.status = 'cancelled';
    transfer.decidedById = cancelledById;
    transfer.decidedAt = timestamp;
    transfer.updatedAt = timestamp;
    transfer.updatedBy = cancelledById;
    transfer.version += 1;
    for (const membership of this.memberships.filter((item) => item.teamId === transfer.destinationTeamId && item.active)) {
      this.notify(membership.userId, { type: 'issue-transfer-decided', title: 'Issue transfer cancelled', message: `${source.title} is staying with ${this.team(transfer.sourceTeamId)?.name ?? transfer.sourceTeamId}.`, issueId: source.id, transferId: transfer.id, teamId: transfer.destinationTeamId });
    }
    this.recordAudit(cancelledById, 'Cancelled Issue transfer', source.id, `Cancelled the pending transfer to ${transfer.destinationTeamId}.`, 'transfer');
    return clone(transfer);
  }

  async sendTeamMessage(input: { fromTeamId: string; toTeamId: string; subject: string; body: string; senderId: string }) {
    this.requireUser(input.senderId);
    this.requireWrite(input.fromTeamId, input.senderId);
    const destination = this.team(input.toTeamId);
    if (!destination) throw new RepositoryError('NOT_FOUND', 'Destination team not found.');
    if (destination.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Messages can only be sent to operational teams.');
    if (input.fromTeamId === input.toTeamId) throw new RepositoryError('VALIDATION', 'Choose a different destination team.');
    assertText(input.subject, 'Message subject');
    assertText(input.body, 'Message body');
    const timestamp = nowIso();
    const message: TeamMessageRecord = { ...baseRecord(generatedId('message'), 'message'), kind: 'message', fromTeamId: input.fromTeamId, toTeamId: input.toTeamId, senderId: input.senderId, subject: input.subject.trim(), body: input.body.trim(), status: 'unread', updatedBy: input.senderId };
    this.messages.unshift(message);
    for (const membership of this.memberships.filter((item) => item.teamId === input.toTeamId && item.active && item.role !== 'Viewer')) {
      this.notify(membership.userId, { type: 'team-message', title: `New message from ${this.team(input.fromTeamId)?.name ?? input.fromTeamId}`, message: message.subject, teamId: input.toTeamId });
    }
    this.recordAudit(input.senderId, 'Sent team message', message.id, `${input.fromTeamId} → ${input.toTeamId}: ${message.subject}`, 'admin');
    return clone(message);
  }

  async markMessageRead(messageId: string, userId: string, expectedVersion?: number) {
    this.requireUser(userId);
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) throw new RepositoryError('NOT_FOUND', 'Message not found.');
    this.requireRead(message.toTeamId, userId);
    assertExpectedVersion(message.version, expectedVersion);
    if (message.status === 'unread') message.status = 'read';
    message.readAt = message.readAt ?? nowIso();
    message.updatedAt = nowIso();
    message.updatedBy = userId;
    message.version += 1;
    return clone(message);
  }

  async createIssueFromMessage(input: { messageId: string; title: string; detail: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string) {
    const message = this.messages.find((item) => item.id === input.messageId);
    if (!message) throw new RepositoryError('NOT_FOUND', 'Message not found.');
    this.requireWrite(message.toTeamId, actorId);
    if (message.convertedIssueId) {
      const existing = this.activeIssue(message.convertedIssueId);
      if (existing) return clone(existing);
      throw new RepositoryError('CONFLICT', 'This message has already been converted to an Issue.');
    }
    assertText(input.title, 'Issue title');
    assertText(input.detail, 'Issue detail');
    const issue = await this.createIssue({ teamId: message.toTeamId, title: input.title, detail: input.detail, category: input.category, priority: input.priority, horizon: input.horizon, ownerId: input.ownerId ?? actorId, raisedById: actorId }, actorId);
    const timestamp = nowIso();
    message.status = 'converted';
    message.convertedIssueId = issue.id;
    message.readAt = message.readAt ?? timestamp;
    message.updatedAt = timestamp;
    message.updatedBy = actorId;
    message.version += 1;
    this.recordAudit(actorId, 'Created Issue from team message', issue.id, `${message.subject} → ${issue.title}`, 'issue');
    return clone(issue);
  }

  private advanceIssueEscalations(team: TeamRecord, meeting: MeetingRecord, at: string) {
    const now = new Date(at).getTime();
    for (const issueId of meeting.idsIssueIds) {
      const issue = this.activeIssue(issueId);
      if (!issue || issue.teamId !== team.teamId || issue.status === 'solved') continue;
      issue.meetingsPassed += 1;
      issue.updatedAt = at;
      issue.updatedBy = 'system';
      issue.version += 1;
      const recipient = team.escalationUserIds[issue.escalationLevel];
      if (issue.meetingsPassed >= 3 && issue.escalationState === 'not-scheduled') {
        issue.escalationState = 'scheduled';
        issue.escalationDueAt = new Date(now + 7 * DAY).toISOString();
        if (recipient) this.notify(recipient, { type: 'issue-escalation', title: 'Issue escalation scheduled', message: `${issue.title} has passed three L10 meetings and will escalate in seven days if it remains unsolved.`, issueId: issue.id, teamId: team.teamId });
      } else if ((issue.escalationState === 'scheduled' || issue.escalationState === 'escalated') && issue.escalationDueAt && new Date(issue.escalationDueAt).getTime() <= now) {
        if (recipient) {
          issue.escalationState = 'escalated';
          issue.escalatedToUserId = recipient;
          issue.escalationLevel += 1;
          const nextRecipient = team.escalationUserIds[issue.escalationLevel];
          issue.escalationDueAt = nextRecipient ? new Date(now + 7 * DAY).toISOString() : undefined;
          this.notify(recipient, { type: 'issue-escalation', title: 'Issue escalated', message: `${issue.title} has reached its escalation point for ${team.name}.`, issueId: issue.id, teamId: team.teamId });
        } else {
          issue.escalationState = 'due';
        }
      }
    }
  }

  async closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'This meeting is already closed.');
    const timestamp = nowIso();
    const sections = meetingSectionsFor(team);
    const teamRocks = this.rocks.filter((rock) => rock.teamId === teamId);
    const teamTodos = this.todos.filter((todo) => todo.teamId === teamId);
    const teamIssues = this.issues.filter((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected');
    meeting.status = 'closed';
    meeting.closedAt = timestamp;
    meeting.agendaProgress = sections.length;
    meeting.agendaTotal = sections.length;
    meeting.idsTotal = meeting.idsIssueIds.length;
    meeting.idsSolved = meeting.idsIssueIds.filter((issueId) => teamIssues.find((issue) => issue.id === issueId)?.status === 'solved').length;
    meeting.lastRating = Math.min(10, Math.max(0, rating));
    meeting.recap = meetingRecap(team, meeting, teamRocks, teamTodos, teamIssues, recap);
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.advanceIssueEscalations(team, meeting, timestamp);
    const nextDate = new Date(new Date(timestamp).getTime() + 7 * DAY);
    const carriedIssueIds = meeting.idsIssueIds.filter((issueId) => this.activeIssue(issueId)?.status !== 'solved');
    const nextMeeting: MeetingRecord = { ...baseRecord(`meeting-${teamId}-${nextDate.toISOString().slice(0, 10)}-${Date.now()}`, 'meeting', teamId), kind: 'meeting', teamId, label: `${team.shortName} L10`, dateLabel: `${team.meetingDay} · ${nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, status: 'upcoming', facilitatorId: meeting.facilitatorId, attendeeIds: [...meeting.attendeeIds], lastRating: meeting.lastRating, agendaProgress: 0, agendaTotal: sections.length, idsSolved: 0, idsTotal: carriedIssueIds.length, recap: '', sectionNotes: {}, idsIssueIds: carriedIssueIds, createdTodoIds: [], idsNotes: [] };
    this.meetings.push(nextMeeting);
    this.recordAudit(actorId, 'Closed L10 meeting', meeting.id, recap || 'Meeting closed without a recap.', 'meeting');
    return clone(meeting);
  }

  async getAdminSnapshot(actorId: string): Promise<AdminSnapshot> {
    this.requireAdmin(actorId);
    return { teams: clone(this.teams), users: clone(this.users), memberships: clone(this.memberships), settings: { ...clone(this.settings), version: this.settingsVersion }, audit: clone(this.audit), etag: etagFor([...this.teams, ...this.users, ...this.memberships, ...this.audit]) };
  }

  async createTeam(input: Omit<TeamRecord, keyof WorkspaceRecord | 'teamId' | 'active'> & { teamId?: string }, actorId: string) {
    this.requireAdmin(actorId);
    assertText(input.name, 'Team name');
    assertText(input.shortName, 'Team short name');
    if (!input.parentTeamId && this.teams.some((team) => team.active)) throw new RepositoryError('VALIDATION', 'New teams must be placed under the Leadership Team.');
    if (input.parentTeamId && !this.team(input.parentTeamId)) throw new RepositoryError('NOT_FOUND', 'Parent team not found.');
    let teamId = input.teamId || idFor('team', input.shortName);
    if (this.teams.some((team) => team.teamId === teamId)) teamId = `${teamId}-${Date.now()}`;
    const team = makeTeam({ ...input, teamId, name: input.name, shortName: input.shortName, parentTeamId: input.parentTeamId, nodeType: input.nodeType });
    this.teams.push(team);
    if (team.nodeType === 'operational') {
      const sections = meetingSectionsFor(team);
      this.meetings.push({
        ...baseRecord(`meeting-${team.teamId}-current`, 'meeting', team.teamId),
        kind: 'meeting', teamId: team.teamId, label: `${team.shortName} L10`, dateLabel: `This week · ${team.meetingDay}`, status: 'upcoming',
        facilitatorId: team.escalationUserIds[0] ?? actorId, attendeeIds: [], lastRating: 0, agendaProgress: 0,
        agendaTotal: sections.length, idsSolved: 0, idsTotal: 0, recap: '', sectionNotes: {}, idsIssueIds: [], createdTodoIds: [], idsNotes: [],
      });
    }
    this.recordAudit(actorId, 'Created team', teamId, `Created ${team.name} as a ${team.nodeType} node.`, 'team');
    return clone(team);
  }

  async updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number) {
    this.requireAdmin(actorId);
    const team = this.teams.find((item) => item.teamId === teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    assertExpectedVersion(team.version, expectedVersion);
    if (input.parentTeamId === teamId) throw new RepositoryError('VALIDATION', 'A team cannot be its own parent.');
    if (teamId === 'leadership' && input.parentTeamId !== undefined && input.parentTeamId !== null) throw new RepositoryError('VALIDATION', 'Leadership Team must remain the hierarchy root.');
    if (teamId !== 'leadership' && input.parentTeamId === null) throw new RepositoryError('VALIDATION', 'Operational teams must remain under the Leadership Team hierarchy.');
    if (input.parentTeamId && !this.team(input.parentTeamId)) throw new RepositoryError('NOT_FOUND', 'Parent team not found.');
    if (team.nodeType === 'operational' && input.nodeType === 'grouping' && (this.rocks.some((rock) => rock.teamId === teamId) || this.todos.some((todo) => todo.teamId === teamId) || this.issues.some((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected'))) {
      throw new RepositoryError('VALIDATION', 'Resolve active work before changing this node to grouping-only.');
    }
    if (input.meetingSections) {
      if (!input.meetingSections.some((section) => section.id === 'ids' && section.enabled) || !input.meetingSections.some((section) => section.id === 'conclude' && section.enabled)) throw new RepositoryError('VALIDATION', 'IDS and Conclude must remain enabled for every L10.');
      if (input.meetingSections.some((section) => !Number.isInteger(section.duration) || section.duration < 1 || section.duration > 180)) throw new RepositoryError('VALIDATION', 'Meeting section durations must be whole minutes between 1 and 180.');
    }
    if (input.escalationUserIds?.some((userId) => !this.user(userId))) throw new RepositoryError('VALIDATION', 'Every escalation recipient must be an active organization user.');
    const proposed = this.teams.map((item) => item.teamId === teamId ? { ...item, ...input } : item);
    const seen = new Set<string>();
    let current: string | null = teamId;
    while (current) {
      if (seen.has(current)) throw new RepositoryError('VALIDATION', 'The hierarchy cannot contain a cycle.');
      seen.add(current);
      current = proposed.find((item) => item.teamId === current)?.parentTeamId ?? null;
    }
    Object.assign(team, input, { meetingSections: input.meetingSections ? clone(input.meetingSections) : team.meetingSections, escalationUserIds: input.escalationUserIds ? [...input.escalationUserIds] : team.escalationUserIds, updatedAt: nowIso(), updatedBy: actorId, version: team.version + 1 });
    this.recordAudit(actorId, 'Updated team', teamId, `Updated ${team.name}.`, 'team');
    return clone(team);
  }

  async createUser(input: { name: string; email: string; accent: string; platformAdmin?: boolean }, actorId: string) {
    this.requireAdmin(actorId);
    assertText(input.name, 'Name');
    assertText(input.email, 'Email');
    if (this.users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) throw new RepositoryError('CONFLICT', 'A user with that email already exists.');
    let userId = idFor('user', input.email.split('@')[0]);
    if (this.users.some((user) => user.id === userId)) userId = `${userId}-${Date.now()}`;
    const user = makeUser({ id: userId, name: input.name, email: input.email, accent: input.accent, platformAdmin: input.platformAdmin });
    this.users.push(user);
    this.recordAudit(actorId, 'Created local user', user.id, `Created the local profile for ${user.name}.`, 'admin');
    return clone(user);
  }

  async upsertMembership(input: { userId: string; teamId: string; role: TeamMembership['role'] }, actorId: string) {
    this.requireAdmin(actorId);
    this.requireUser(input.userId);
    if (!this.team(input.teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (!['TeamLead', 'Member', 'Viewer', 'OrgAdmin'].includes(input.role)) throw new RepositoryError('VALIDATION', 'Invalid team role.');
    const existing = this.memberships.find((membership) => membership.userId === input.userId && membership.teamId === input.teamId);
    if (existing) {
      existing.role = input.role;
      existing.active = true;
      existing.updatedAt = nowIso();
      existing.updatedBy = actorId;
      existing.version += 1;
      this.recordAudit(actorId, 'Updated membership', existing.id, `Assigned ${input.userId} to ${input.teamId} as ${input.role}.`, 'membership');
      return clone(existing);
    }
    const membership = makeMembership(generatedId('membership'), input.teamId, input.userId, input.role);
    membership.updatedBy = actorId;
    this.memberships.push(membership);
    this.recordAudit(actorId, 'Created membership', membership.id, `Assigned ${input.userId} to ${input.teamId} as ${input.role}.`, 'membership');
    return clone(membership);
  }

  async updateAgeSettings(settings: IssueAgeSettings, actorId: string, expectedVersion?: number) {
    this.requireAdmin(actorId);
    if (!Number.isInteger(settings.agingDays) || !Number.isInteger(settings.staleDays) || !Number.isInteger(settings.criticalDays) || settings.agingDays <= 0 || settings.agingDays >= settings.staleDays || settings.staleDays >= settings.criticalDays) throw new RepositoryError('VALIDATION', 'Aging thresholds must be whole numbers in ascending order.');
    assertExpectedVersion(this.settingsVersion, expectedVersion);
    this.settingsVersion += 1;
    this.settings = { ...clone(settings), version: this.settingsVersion };
    this.refreshDerivedState();
    this.recordAudit(actorId, 'Updated Issue aging settings', 'issue-aging-settings', `${settings.agingDays}/${settings.staleDays}/${settings.criticalDays} day bands.`, 'admin');
    return clone(this.settings);
  }

  async updateUserProfile(input: { name?: string; email?: string; avatarDataUrl?: string | null }, actorId: string, expectedVersion?: number) {
    const user = this.requireUser(actorId);
    assertExpectedVersion(user.version, expectedVersion);
    if (input.name !== undefined) assertText(input.name, 'Name');
    if (input.email !== undefined) {
      assertText(input.email, 'Email');
      if (this.users.some((candidate) => candidate.id !== actorId && candidate.email.toLowerCase() === input.email!.toLowerCase())) throw new RepositoryError('CONFLICT', 'A user with that email already exists.');
    }
    if (input.avatarDataUrl !== undefined && input.avatarDataUrl !== null && !/^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(input.avatarDataUrl)) throw new RepositoryError('VALIDATION', 'Avatar must be a PNG, JPEG, or WebP data URL.');
    if (input.avatarDataUrl) {
      const encoded = input.avatarDataUrl.slice(input.avatarDataUrl.indexOf(',') + 1);
      const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
      const bytes = Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
      if (bytes > 256 * 1024) throw new RepositoryError('VALIDATION', 'Avatar must be no larger than 256 KB.');
    }
    Object.assign(user, { ...input, avatarDataUrl: input.avatarDataUrl === null ? undefined : input.avatarDataUrl, initials: input.name ? input.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : user.initials, updatedAt: nowIso(), updatedBy: actorId, version: user.version + 1 });
    this.recordAudit(actorId, 'Updated profile', actorId, 'Updated local profile details or avatar.', 'profile');
    return clone(user);
  }
}

/**
 * Cosmos implementation boundary. Operational documents use team partitions;
 * organization configuration, memberships, transfer envelopes, notifications,
 * settings, and audit events use the org partition. The POC repository below
 * keeps the full transition logic available locally; this adapter provides the
 * bounded Cosmos reads used by deployed API endpoints and is the seam for
 * transactional writes using ETags and transactional batches.
 */
export class CosmosWorkspaceRepository extends MemoryWorkspaceRepository {
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private settingsRecord: IssueAgeSettingsRecord | undefined;

  constructor(private readonly container: Container, environmentId: EnvironmentId = 'live') {
    super(environmentId);
  }

  static fromEnvironment(environmentId: EnvironmentId = 'live') {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const database = environmentId === 'live' ? (process.env.COSMOS_LIVE_DATABASE ?? process.env.COSMOS_DATABASE) : process.env.COSMOS_TEST_DATABASE;
    const containerName = environmentId === 'live' ? (process.env.COSMOS_LIVE_CONTAINER ?? process.env.COSMOS_CONTAINER) : process.env.COSMOS_TEST_CONTAINER;
    if (process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true') return null;
    if (!endpoint || !database || !containerName) return null;
    const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    return new CosmosWorkspaceRepository(client.database(database).container(containerName), environmentId);
  }

  private async query<T extends WorkspaceRecord>(query: string, parameters: Array<{ name: string; value: string | boolean }>, partitionKey?: string) {
    const result = await this.container.items.query<T>({ query, parameters }, partitionKey ? { partitionKey } : undefined).fetchAll();
    return result.resources.map((record) => ({
      ...record,
      environmentId: this.environmentId,
      cosmosEtag: (record as T & { _etag?: string })._etag ?? record.cosmosEtag,
    }));
  }

  private async orgRecords<T extends WorkspaceRecord>(kind: T['kind']) {
    return this.query<T>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = @kind', [{ name: '@pk', value: 'org' }, { name: '@kind', value: kind }], 'org');
  }

  private async teamRecords<T extends WorkspaceRecord>(teamId: string, kind: T['kind']) {
    return this.query<T>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = @kind AND c.teamId = @teamId', [{ name: '@pk', value: partitionFor('team', teamId) }, { name: '@kind', value: kind }, { name: '@teamId', value: teamId }], partitionFor('team', teamId));
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const orgRecords = await this.query<WorkspaceRecord>('SELECT * FROM c WHERE c.pk = @pk', [{ name: '@pk', value: 'org' }], 'org');
      const seededTeams = orgRecords.filter((record) => record.kind === 'team') as TeamRecord[];
      const teamPartitions = await Promise.all(seededTeams.map((team) => this.query<WorkspaceRecord>('SELECT * FROM c WHERE c.pk = @pk', [{ name: '@pk', value: partitionFor('team', team.teamId) }], partitionFor('team', team.teamId))));
      const records = [...orgRecords, ...teamPartitions.flat()].map((record) => ({ ...record, environmentId: this.environmentId, cosmosEtag: record.cosmosEtag ?? (record as WorkspaceRecord & { _etag?: string })._etag }));
      const ofKind = <T extends WorkspaceRecord>(kind: T['kind']) => records.filter((record) => record.kind === kind) as T[];
      this.teams = ofKind<TeamRecord>('team');
      this.users = ofKind<UserProfile>('user');
      this.memberships = ofKind<TeamMembership>('teamMembership');
      this.rocks = ofKind<RockRecord>('rock');
      this.tasks = ofKind<RockTaskRecord>('rockTask');
      this.todos = ofKind<TodoRecord>('todo');
      this.issues = ofKind<IssueRecord>('issue');
      this.transfers = ofKind<IssueTransferRecord>('issueTransfer');
      this.notifications = ofKind<NotificationRecord>('notification');
      this.messages = ofKind<TeamMessageRecord>('message');
      this.meetings = ofKind<MeetingRecord>('meeting');
      this.audit = ofKind<AuditEventRecord>('auditEvent');
      this.settingsRecord = ofKind<IssueAgeSettingsRecord>('issueAgeSettings')[0];
      this.settings = this.settingsRecord ? { agingDays: this.settingsRecord.agingDays, staleDays: this.settingsRecord.staleDays, criticalDays: this.settingsRecord.criticalDays, version: this.settingsRecord.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
      this.settingsVersion = this.settingsRecord?.version ?? 1;
      this.refreshDerivedState();
      this.loaded = true;
    })();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private allRecords(): WorkspaceRecord[] {
    const records: WorkspaceRecord[] = [...this.teams, ...this.users, ...this.memberships, ...this.rocks, ...this.tasks, ...this.todos, ...this.issues, ...this.transfers, ...this.notifications, ...this.messages, ...this.meetings, ...this.audit];
    if (this.settingsRecord) records.push(this.settingsRecord);
    return records;
  }

  private recordKey(record: WorkspaceRecord) {
    return `${record.pk}:${record.id}`;
  }

  private payload(record: WorkspaceRecord) {
    const payload = { ...record, environmentId: this.environmentId } as WorkspaceRecord & { _etag?: string };
    delete payload.cosmosEtag;
    delete payload._etag;
    return payload;
  }

  /** Keep Cosmos concurrency tokens inside the repository boundary. */
  private publicValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => this.publicValue(item)) as T;
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (key !== 'cosmosEtag') output[key] = this.publicValue(item);
      }
      return output as T;
    }
    return value;
  }

  private async writeSingle(record: WorkspaceRecord) {
    try {
      if (record.cosmosEtag) {
        const response = await this.container.item(record.id, record.pk).replace(this.payload(record), { accessCondition: { type: 'IfMatch', condition: record.cosmosEtag } });
        const etag = (response.resource as WorkspaceRecord & { _etag?: string } | undefined)?._etag;
        if (etag) record.cosmosEtag = etag;
      } else {
        const response = await this.container.items.create(this.payload(record));
        const etag = (response.resource as WorkspaceRecord & { _etag?: string } | undefined)?._etag;
        if (etag) record.cosmosEtag = etag;
      }
    } catch (error) {
      if ((error as { code?: number }).code === 412) throw new RepositoryError('CONFLICT', 'The record changed elsewhere. Refresh and try again.');
      throw error;
    }
  }

  private async writeBatch(records: WorkspaceRecord[]) {
    const operations = records.map((record) => record.cosmosEtag
      ? { operationType: 'Replace' as const, id: record.id, ifMatch: record.cosmosEtag, resourceBody: this.payload(record) as unknown as Record<string, unknown> }
      : { operationType: 'Create' as const, resourceBody: this.payload(record) as unknown as Record<string, unknown> }) as unknown as import('@azure/cosmos').OperationInput[];
    try {
      const response = await this.container.items.batch(operations, records[0].pk);
      const failed = response.result?.find((item) => item.statusCode >= 400);
      if (failed) {
        if (failed.statusCode === 412) throw new RepositoryError('CONFLICT', 'One or more records changed elsewhere. Refresh and try again.');
        throw new RepositoryError('UNAVAILABLE', 'Cosmos could not persist the transactional workspace update.');
      }
      response.result?.forEach((item, index) => {
        if (item.eTag) records[index].cosmosEtag = item.eTag;
      });
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if ((error as { code?: number }).code === 412) throw new RepositoryError('CONFLICT', 'One or more records changed elsewhere. Refresh and try again.');
      throw error;
    }
  }

  private async persistRecords(records: WorkspaceRecord[]) {
    const byPartition = new Map<string, WorkspaceRecord[]>();
    for (const record of records) byPartition.set(record.pk, [...(byPartition.get(record.pk) ?? []), record]);
    for (const partitionRecords of byPartition.values()) {
      if (partitionRecords.length > 1 && partitionRecords.length <= 100) await this.writeBatch(partitionRecords);
      else for (const record of partitionRecords) await this.writeSingle(record);
    }
  }

  private syncSettingsRecord(actorId: string) {
    if (!this.settingsRecord) this.settingsRecord = { ...baseRecord('issue-age-settings', 'issueAgeSettings'), kind: 'issueAgeSettings', agingDays: this.settings.agingDays, staleDays: this.settings.staleDays, criticalDays: this.settings.criticalDays };
    Object.assign(this.settingsRecord, { agingDays: this.settings.agingDays, staleDays: this.settings.staleDays, criticalDays: this.settings.criticalDays, version: this.settings.version ?? this.settingsVersion, updatedAt: nowIso(), updatedBy: actorId, environmentId: this.environmentId });
  }

  private async withMutation<T>(actorId: string, mutation: () => Promise<T>): Promise<T> {
    await this.ensureLoaded();
    const before = new Map(this.allRecords().map((record) => [this.recordKey(record), JSON.stringify(this.payload(record))]));
    const settingsBefore = JSON.stringify(this.settings);
    try {
      const result = await mutation();
      if (settingsBefore !== JSON.stringify(this.settings)) this.syncSettingsRecord(actorId);
      const changed = this.allRecords().filter((record) => before.get(this.recordKey(record)) !== JSON.stringify(this.payload(record)));
      await this.persistRecords(changed);
      return this.publicValue(result);
    } catch (error) {
      // Mutations run through the in-memory domain implementation first. If a
      // validation or ETag failure occurs, discard that process-local view so
      // the next mutation reloads the authoritative Cosmos state.
      this.loaded = false;
      this.settingsRecord = undefined;
      throw error;
    }
  }

  async getTeamMembership(teamId: string, userId: string) {
    const records = await this.query<TeamMembership>('SELECT TOP 1 * FROM c WHERE c.pk = @pk AND c.kind = "teamMembership" AND c.teamId = @teamId AND c.userId = @userId AND c.active = true', [{ name: '@pk', value: 'org' }, { name: '@teamId', value: teamId }, { name: '@userId', value: userId }], 'org');
    return this.publicValue(clone(records[0] ?? null));
  }

  async getLeadershipMembership(userId: string) {
    return this.getTeamMembership('leadership', userId);
  }

  async getUser(userId: string) {
    const records = await this.query<UserProfile>('SELECT TOP 1 * FROM c WHERE c.pk = @pk AND c.kind = "user" AND c.id = @id AND c.active = true', [{ name: '@pk', value: 'org' }, { name: '@id', value: userId }], 'org');
    return this.publicValue(clone(records[0] ?? null));
  }

  async getTeams() {
    return this.publicValue(clone((await this.orgRecords<TeamRecord>('team')).filter((team) => team.active)));
  }

  async getSessionContext(userId: string) {
    const [user, memberships, teams] = await Promise.all([this.getUser(userId), this.orgRecords<TeamMembership>('teamMembership'), this.getTeams()]);
    if (!user) return null;
    const ownMemberships = memberships.filter((membership) => membership.userId === userId && membership.active);
    const leadershipVisible = ownMemberships.some((membership) => membership.teamId === 'leadership');
    const teamIds = leadershipVisible ? teams.map((team) => team.teamId) : ownMemberships.map((membership) => membership.teamId);
    return this.publicValue({ user: clone(user), memberships: clone(ownMemberships.map(({ teamId, role, active }) => ({ teamId, role, active }))), leadershipVisible, platformAdmin: canAdministerPlatform(user.platformCapabilities) || ownMemberships.some((membership) => membership.teamId === 'leadership' && membership.role === 'OrgAdmin'), teams: clone(teams.filter((team) => teamIds.includes(team.teamId) && team.active).map(({ teamId, name, shortName, parentTeamId, nodeType, active }) => ({ teamId, name, shortName, parentTeamId, nodeType, active }))), currentEnvironment: this.environmentId } satisfies SessionContext);
  }

  private async ageSettings() {
    const records = await this.orgRecords<IssueAgeSettingsRecord>('issueAgeSettings');
    const record = records[0];
    return record ? { agingDays: record.agingDays, staleDays: record.staleDays, criticalDays: record.criticalDays, version: record.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
  }

  async getTeamDashboard(teamId: string, userId?: string) {
    const teams = await this.getTeams();
    if (!teams.some((team) => team.teamId === teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (userId) {
      const [membership, leadership] = await Promise.all([this.getTeamMembership(teamId, userId), this.getLeadershipMembership(userId)]);
      if (!membership && !leadership) throw new RepositoryError('FORBIDDEN', 'You do not have access to this team.');
    }
    const settings = await this.ageSettings();
    const [rocks, todos, issues] = await Promise.all([this.teamRecords<RockRecord>(teamId, 'rock'), this.teamRecords<TodoRecord>(teamId, 'todo'), this.teamRecords<IssueRecord>(teamId, 'issue')]);
    return dashboardFor(teamId, rocks, todos, issues.map((issue) => issueAge(issue, settings)));
  }

  async getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace> {
    const [team, membership, rocks, tasks, todos, issues, transfers, notifications, messages, meetings, settings] = await Promise.all([
      this.orgRecords<TeamRecord>('team').then((items) => items.find((item) => item.teamId === teamId && item.active) ?? null),
      this.getTeamMembership(teamId, userId),
      this.teamRecords<RockRecord>(teamId, 'rock'), this.teamRecords<RockTaskRecord>(teamId, 'rockTask'), this.teamRecords<TodoRecord>(teamId, 'todo'), this.teamRecords<IssueRecord>(teamId, 'issue'), this.orgRecords<IssueTransferRecord>('issueTransfer'), this.orgRecords<NotificationRecord>('notification'),
      this.orgRecords<TeamMessageRecord>('message'), this.teamRecords<MeetingRecord>(teamId, 'meeting'),
      this.ageSettings(),
    ]);
    const leadership = await this.getLeadershipMembership(userId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (!membership && !leadership) throw new RepositoryError('FORBIDDEN', 'You do not have access to this team.');
    const teamIssues = issues.filter((issue) => issue.assignmentState !== 'redirected').map((issue) => issueAge(issue, settings));
    const teamTransfers = transfers.filter((transfer) => transfer.sourceTeamId === teamId || transfer.destinationTeamId === teamId);
    const teamNotifications = notifications.filter((notification) => notification.recipientUserId === userId && (!notification.teamId || notification.teamId === teamId));
    const teamMessages = messages.filter((message) => message.fromTeamId === teamId || message.toTeamId === teamId);
    return this.publicValue({ environmentId: this.environmentId, team: clone(team), membership: membership ? { teamId, role: membership.role, active: membership.active } : null, dashboard: dashboardFor(teamId, rocks, todos, teamIssues), rocks: clone(rocks), tasks: clone(tasks), todos: clone(todos), issues: clone(teamIssues), transfers: clone(teamTransfers), notifications: clone(teamNotifications), messages: clone(teamMessages), meetings: clone(meetings), etag: etagFor([...rocks, ...tasks, ...todos, ...teamIssues, ...teamTransfers, ...teamMessages, ...meetings]) });
  }

  async getWorkspaceSnapshot(userId: string): Promise<WorkspaceSnapshot> {
    const session = await this.getSessionContext(userId);
    if (!session) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    const teamWorkspaces = await Promise.all(session.teams.map((team) => this.getTeamWorkspace(team.teamId, userId)));
    const unique = <T extends WorkspaceRecord>(items: T[]) => [...new Map(items.map((item) => [`${item.pk}:${item.id}`, item])).values()];
    const users = await this.orgRecords<UserProfile>('user');
    const memberships = await this.orgRecords<TeamMembership>('teamMembership');
    const settings = await this.ageSettings();
    const [metrics, headlines, audit] = await Promise.all([
      this.orgRecords<WorkspaceRecord & { kind: 'scorecardMetric'; label: string; target: string; actual: string; unit: string; ownerId: string; status: 'on-track' | 'off-track'; trend: 'up' | 'down' | 'flat'; trendLabel: string }>('scorecardMetric'),
      this.orgRecords<WorkspaceRecord & { kind: 'headline'; authorId: string; type: 'win' | 'concern'; title: string; detail: string; issueId?: string }>('headline'),
      this.orgRecords<AuditEventRecord>('auditEvent'),
    ]);
    const teams = teamWorkspaces.map((workspace) => workspace.team);
    const rocks = unique(teamWorkspaces.flatMap((workspace) => workspace.rocks));
    const tasks = unique(teamWorkspaces.flatMap((workspace) => workspace.tasks));
    const todos = unique(teamWorkspaces.flatMap((workspace) => workspace.todos));
    const issues = unique(teamWorkspaces.flatMap((workspace) => workspace.issues));
    const transfers = unique(teamWorkspaces.flatMap((workspace) => workspace.transfers));
    const notifications = unique(teamWorkspaces.flatMap((workspace) => workspace.notifications));
    const messages = unique(teamWorkspaces.flatMap((workspace) => workspace.messages));
    const meetings = unique(teamWorkspaces.flatMap((workspace) => workspace.meetings));
    const visibleTeamIds = new Set(teams.map((team) => team.teamId));
    const quarterEnd = new Date('2026-09-30T23:59:59Z').getTime();
    return this.publicValue({
      environmentId: this.environmentId,
      user: clone((await this.getUser(userId))!),
      teams: clone(teams),
      users: clone(users.filter((user) => user.active)),
      memberships: clone(memberships.filter((membership) => membership.active && visibleTeamIds.has(membership.teamId))),
      settings: clone(settings),
      rocks: clone(rocks),
      tasks: clone(tasks),
      todos: clone(todos),
      issues: clone(issues),
      transfers: clone(transfers),
      notifications: clone(notifications),
      messages: clone(messages),
      meetings: clone(meetings),
      metrics: clone(metrics.filter((metric) => visibleTeamIds.has(metric.teamId ?? ''))),
      headlines: clone(headlines.filter((headline) => visibleTeamIds.has(headline.teamId ?? ''))),
      audit: clone(audit),
      quarter: { id: '2026-q3', label: 'Q3 2026', theme: 'Make Q3 feel lighter.', startDate: '2026-07-01', endDate: '2026-09-30', daysRemaining: Math.max(0, Math.ceil((quarterEnd - Date.now()) / DAY)) },
      etag: etagFor([...teams, ...users, ...memberships, ...rocks, ...tasks, ...todos, ...issues, ...transfers, ...notifications, ...messages, ...meetings, ...metrics, ...headlines, ...audit]),
    });
  }

  async getCompanyOverview(userId: string) {
    const context = await this.getSessionContext(userId);
    if (!context?.leadershipVisible) throw new RepositoryError('FORBIDDEN', 'Leadership membership is required for company visibility.');
    const teams = await this.getTeams();
    const groups = await Promise.all(teams.map(async (team) => Promise.all([this.teamRecords<RockRecord>(team.teamId, 'rock'), this.teamRecords<TodoRecord>(team.teamId, 'todo'), this.teamRecords<IssueRecord>(team.teamId, 'issue')])));
    const rocks = groups.flatMap((group) => group[0]);
    const todos = groups.flatMap((group) => group[1]);
    const issues = groups.flatMap((group) => group[2]);
    const settings = await this.ageSettings();
    const activeIssues = issues.filter((issue) => issue.assignmentState !== 'redirected').map((issue) => issueAge(issue, settings));
    const descendants = (teamId: string): string[] => teams.filter((team) => team.parentTeamId === teamId).flatMap((child) => [child.teamId, ...descendants(child.teamId)]);
    const rollups = teams.map((team) => {
      const childIds = descendants(team.teamId);
      const directRocks = rocks.filter((rock) => rock.teamId === team.teamId);
      const directTodos = todos.filter((todo) => todo.teamId === team.teamId);
      const directIssues = activeIssues.filter((issue) => issue.teamId === team.teamId);
      return { teamId: team.teamId, direct: { rocks: { total: directRocks.length, onTrack: directRocks.filter((rock) => rock.status === 'on-track').length, offTrack: directRocks.filter((rock) => rock.status === 'off-track').length, complete: directRocks.filter((rock) => rock.status === 'complete').length }, todos: { total: directTodos.length, open: directTodos.filter((todo) => todo.status === 'open').length, done: directTodos.filter((todo) => todo.status === 'done').length, notDone: directTodos.filter((todo) => todo.status === 'not-done').length }, issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, aging: directIssues.filter((issue) => issue.ageBand === 'aging').length, stale: directIssues.filter((issue) => issue.ageBand === 'stale').length, critical: directIssues.filter((issue) => issue.ageBand === 'critical').length } }, descendants: { rocks: rocks.filter((rock) => childIds.includes(rock.teamId)).length, todos: todos.filter((todo) => childIds.includes(todo.teamId)).length, issues: activeIssues.filter((issue) => childIds.includes(issue.teamId)).length } };
    });
    return this.publicValue({ teams: rollups, issues: clone(activeIssues), rocks: clone(rocks), todos: clone(todos), etag: etagFor([...teams, ...rocks, ...todos, ...activeIssues]) });
  }

  async getNotifications(userId: string) {
    if (!await this.getUser(userId)) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    const records = await this.orgRecords<NotificationRecord>('notification');
    return this.publicValue(clone(records.filter((notification) => notification.recipientUserId === userId)));
  }

  async markNotificationRead(notificationId: string, userId: string, expectedVersion?: number) { return this.withMutation(userId, () => super.markNotificationRead(notificationId, userId, expectedVersion)); }
  async updateRockStatus(rockId: string, status: RockRecord['status'], actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateRockStatus(rockId, status, actorId, expectedVersion)); }
  async updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateRock(rockId, input, actorId, expectedVersion)); }
  async updateTodoStatus(todoId: string, status: TodoRecord['status'], actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTodoStatus(todoId, status, actorId, expectedVersion)); }
  async updateTodo(todoId: string, input: Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTodo(todoId, input, actorId, expectedVersion)); }
  async moveTodoForward(todoId: string, dueDate: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.moveTodoForward(todoId, dueDate, actorId, expectedVersion)); }
  async createIssue(input: { teamId: string; title: string; detail?: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; raisedById: string; ownerId?: string; linkedRockId?: string; idsNote?: string }, actorId: string) { return this.withMutation(actorId, () => super.createIssue(input, actorId)); }
  async updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateIssue(issueId, input, actorId, expectedVersion)); }
  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.addMeetingIssueNote(issueId, meetingId, note, actorId, expectedVersion)); }
  async startIssue(issueId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.startIssue(issueId, actorId, expectedVersion)); }
  async solveIssue(issueId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.solveIssue(issueId, actorId, expectedVersion)); }
  async createRock(input: { teamId: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string) { return this.withMutation(actorId, () => super.createRock(input, actorId)); }
  async createTodo(input: { teamId: string; title: string; notes?: string; ownerId: string; dueDate: string; linkedRockTaskId?: string }, actorId: string) { return this.withMutation(actorId, () => super.createTodo(input, actorId)); }
  async createRockTask(input: { rockId: string; title: string; notes?: string; assigneeId: string; assignedAt: string; startDate: string; dueDate: string }, actorId: string) { return this.withMutation(actorId, () => super.createRockTask(input, actorId)); }
  async updateRockTask(taskId: string, input: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateRockTask(taskId, input, actorId, expectedVersion)); }
  async convertRockTaskToTodo(taskId: string, actorId: string) { return this.withMutation(actorId, () => super.convertRockTaskToTodo(taskId, actorId)); }
  async getIssue(issueId: string, userId: string) {
    const context = await this.getSessionContext(userId);
    if (!context) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    const candidateTeams = context.leadershipVisible ? (await this.getTeams()).map((team) => team.teamId) : context.teams.map((team) => team.teamId);
    const records = (await Promise.all(candidateTeams.map((teamId) => this.teamRecords<IssueRecord>(teamId, 'issue')))).flat();
    const issue = records.find((item) => item.id === issueId && item.assignmentState !== 'redirected');
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    return this.publicValue(issueAge(issue, await this.ageSettings()));
  }
  async getIssueTransfer(transferId: string) { const records = await this.orgRecords<IssueTransferRecord>('issueTransfer'); const transfer = records.find((item) => item.id === transferId); if (!transfer) throw new RepositoryError('NOT_FOUND', 'Issue transfer not found.'); return this.publicValue(transfer); }
  async requestIssueTransfer(input: { issueId: string; destinationTeamId: string; requestedById: string; note?: string; idempotencyKey?: string }) { return this.withMutation(input.requestedById, () => super.requestIssueTransfer(input)); }
  async acceptIssueTransfer(transferId: string, decidedById: string, expectedVersion?: number) { return this.withMutation(decidedById, () => super.acceptIssueTransfer(transferId, decidedById, expectedVersion)); }
  async rejectIssueTransfer(transferId: string, decidedById: string, message: string, expectedVersion?: number) { return this.withMutation(decidedById, () => super.rejectIssueTransfer(transferId, decidedById, message, expectedVersion)); }
  async cancelIssueTransfer(transferId: string, cancelledById: string, expectedVersion?: number) { return this.withMutation(cancelledById, () => super.cancelIssueTransfer(transferId, cancelledById, expectedVersion)); }
  async sendTeamMessage(input: { fromTeamId: string; toTeamId: string; subject: string; body: string; senderId: string }) { return this.withMutation(input.senderId, () => super.sendTeamMessage(input)); }
  async markMessageRead(messageId: string, userId: string, expectedVersion?: number) { return this.withMutation(userId, () => super.markMessageRead(messageId, userId, expectedVersion)); }
  async createIssueFromMessage(input: { messageId: string; title: string; detail: string; category?: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string) { return this.withMutation(actorId, () => super.createIssueFromMessage(input, actorId)); }
  async closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.closeMeeting(teamId, meetingId, recap, rating, actorId, expectedVersion)); }
  async getAdminSnapshot(actorId: string): Promise<AdminSnapshot> {
    const actor = await this.getUser(actorId);
    if (!actor) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    if (!canAdministerPlatform(actor.platformCapabilities) && (await this.getLeadershipMembership(actorId))?.role !== 'OrgAdmin') throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required.');
    const [teams, users, memberships, settingsRecords, audit] = await Promise.all([this.getTeams(), this.orgRecords<UserProfile>('user'), this.orgRecords<TeamMembership>('teamMembership'), this.orgRecords<IssueAgeSettingsRecord>('issueAgeSettings'), this.orgRecords<AuditEventRecord>('auditEvent')]);
    const settingsRecord = settingsRecords[0];
    const settings = settingsRecord ? { agingDays: settingsRecord.agingDays, staleDays: settingsRecord.staleDays, criticalDays: settingsRecord.criticalDays, version: settingsRecord.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
    return this.publicValue({ teams, users: clone(users.filter((user) => user.active)), memberships: clone(memberships.filter((membership) => membership.active)), settings, audit: clone(audit), etag: etagFor([...teams, ...users, ...memberships, ...audit, ...(settingsRecord ? [settingsRecord] : [])]) });
  }
  async createTeam(input: Omit<TeamRecord, keyof WorkspaceRecord | 'teamId' | 'active' | 'memberCount'> & { teamId?: string }, actorId: string) { return this.withMutation(actorId, () => super.createTeam(input, actorId)); }
  async updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTeam(teamId, input, actorId, expectedVersion)); }
  async createUser(input: { name: string; email: string; accent: string; platformAdmin?: boolean }, actorId: string) { return this.withMutation(actorId, () => super.createUser(input, actorId)); }
  async upsertMembership(input: { userId: string; teamId: string; role: TeamMembership['role'] }, actorId: string) { return this.withMutation(actorId, () => super.upsertMembership(input, actorId)); }
  async updateAgeSettings(settings: IssueAgeSettings, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateAgeSettings(settings, actorId, expectedVersion)); }
  async updateUserProfile(input: { name?: string; email?: string; avatarDataUrl?: string | null }, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateUserProfile(input, actorId, expectedVersion)); }
}

export const repository: WorkspaceRepository = CosmosWorkspaceRepository.fromEnvironment() ?? new MemoryWorkspaceRepository();

export async function assertTeamMember(principal: ClientPrincipal, teamId: string) {
  const membership = await repository.getTeamMembership(teamId, principal.userId);
  if (!membership) throw new RepositoryError('FORBIDDEN', 'You do not have access to this team.');
  return membership;
}
