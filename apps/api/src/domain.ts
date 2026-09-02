export type UserRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';
export type TeamRole = 'TeamLead' | 'Member' | 'Viewer';
export type PlatformCapability = 'PlatformAdmin';
export type TeamNodeType = 'operational' | 'grouping';
export type EnvironmentId = 'live' | 'test';

export interface EnvironmentSummary {
  id: EnvironmentId;
  label: string;
  canAccess: boolean;
}

export type RecordKind =
  | 'organization'
  | 'user'
  | 'team'
  | 'teamMembership'
  | 'quarter'
  | 'meeting'
  | 'rock'
  | 'rockTask'
  | 'todo'
  | 'issue'
  | 'issueTransfer'
  | 'scorecardMetric'
  | 'headline'
  | 'notification'
  | 'message'
  | 'issueAgeSettings'
  | 'auditEvent';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type RockTaskStatus = 'open' | 'in-progress' | 'done';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'solved';
export type IssueHorizon = 'short-term' | 'long-term';
export type IssueAssignmentState = 'assigned' | 'pending-transfer' | 'unassigned' | 'redirected';
export type IssueAgeBand = 'fresh' | 'aging' | 'stale' | 'critical';
export type IssueTransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type NotificationType = 'issue-transfer-requested' | 'issue-transfer-decided' | 'team-message' | 'issue-escalation' | 'system';
export type MessageStatus = 'unread' | 'read' | 'converted';
export type EscalationState = 'not-scheduled' | 'scheduled' | 'due' | 'escalated';
export type MeetingSection = 'segue' | 'scorecard' | 'rock-review' | 'headlines' | 'todo-review' | 'ids' | 'conclude';

export interface MeetingSectionConfig {
  id: MeetingSection;
  label: string;
  enabled: boolean;
  duration: number;
}

export interface WorkspaceRecord {
  id: string;
  kind: RecordKind;
  pk: string;
  orgId: string;
  teamId?: string;
  quarterId?: string;
  meetingId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  /** The database boundary that owns this record. Legacy records may omit it. */
  environmentId?: EnvironmentId;
  /** Cosmos DB's last observed ETag, used for conditional writes. */
  cosmosEtag?: string;
}

export interface UserProfile extends WorkspaceRecord {
  kind: 'user';
  name: string;
  email: string;
  initials: string;
  accent: string;
  active: boolean;
  platformCapabilities: PlatformCapability[];
  avatarDataUrl?: string;
}

export interface TeamRecord extends WorkspaceRecord {
  kind: 'team';
  teamId: string;
  name: string;
  shortName: string;
  description: string;
  parentTeamId: string | null;
  nodeType: TeamNodeType;
  active: boolean;
  meetingDay: string;
  meetingTime: string;
  accent: string;
  initials: string;
  meetingSections: MeetingSectionConfig[];
  escalationUserIds: string[];
}

export interface TeamMembership extends WorkspaceRecord {
  kind: 'teamMembership';
  teamId: string;
  userId: string;
  role: TeamRole | 'OrgAdmin';
  active: boolean;
}

export interface RockRecord extends WorkspaceRecord {
  kind: 'rock';
  teamId: string;
  quarterId: string;
  title: string;
  description: string;
  notes: string;
  ownerId: string;
  status: RockStatus;
  progress: number;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RockTaskRecord extends WorkspaceRecord {
  kind: 'rockTask';
  teamId: string;
  rockId: string;
  title: string;
  notes: string;
  assigneeId: string;
  assignedAt: string;
  startDate: string;
  dueDate: string;
  status: RockTaskStatus;
  linkedTodoId?: string;
}

export interface TodoRecord extends WorkspaceRecord {
  kind: 'todo';
  teamId: string;
  title: string;
  notes: string;
  ownerId: string;
  dueDate: string;
  status: TodoStatus;
  origin: string;
  linkedRockTaskId?: string;
  carryForwardCount: number;
  flagged: boolean;
  convertedIssueId?: string;
}

export interface IssueRecord extends WorkspaceRecord {
  kind: 'issue';
  teamId: string;
  sourceTeamId: string;
  currentTeamId: string | null;
  title: string;
  detail: string;
  category: string;
  priority: number;
  status: IssueStatus;
  horizon: IssueHorizon;
  assignmentState: IssueAssignmentState;
  raisedById: string;
  ownerId?: string;
  solvedAt?: string;
  linkedRockId?: string;
  idsNote?: string;
  ageInDays: number;
  ageBand: IssueAgeBand;
  meetingsPassed: number;
  escalationState: EscalationState;
  escalationDueAt?: string;
  escalationLevel: number;
  escalatedToUserId?: string;
  sourceTodoId?: string;
}

export interface IssueTransferRecord extends WorkspaceRecord {
  kind: 'issueTransfer';
  issueId: string;
  sourceTeamId: string;
  destinationTeamId: string;
  requestedById: string;
  requestedAt: string;
  status: IssueTransferStatus;
  decidedById?: string;
  decidedAt?: string;
  rejectionMessage?: string;
  note?: string;
  sourceIssueVersion: number;
  idempotencyKey?: string;
}

export interface NotificationRecord extends WorkspaceRecord {
  kind: 'notification';
  recipientUserId: string;
  type: NotificationType;
  title: string;
  message: string;
  issueId?: string;
  transferId?: string;
  teamId?: string;
  readAt?: string;
}

export interface TeamMessageRecord extends WorkspaceRecord {
  kind: 'message';
  fromTeamId: string;
  toTeamId: string;
  senderId: string;
  subject: string;
  body: string;
  status: MessageStatus;
  readAt?: string;
  convertedIssueId?: string;
}

export interface MeetingIssueNoteRecord {
  id: string;
  meetingId: string;
  issueId: string;
  authorId: string;
  note: string;
  createdAt: string;
}

export interface MeetingRecord extends WorkspaceRecord {
  kind: 'meeting';
  teamId: string;
  label: string;
  dateLabel: string;
  status: 'upcoming' | 'in-progress' | 'closed';
  facilitatorId: string;
  attendeeIds: string[];
  lastRating: number;
  agendaProgress: number;
  agendaTotal: number;
  idsSolved: number;
  idsTotal: number;
  recap: string;
  startedAt?: string;
  closedAt?: string;
  sectionNotes: Partial<Record<MeetingSection, string>>;
  idsIssueIds: string[];
  createdTodoIds: string[];
  idsNotes: MeetingIssueNoteRecord[];
}

export interface IssueAgeSettings {
  agingDays: number;
  staleDays: number;
  criticalDays: number;
  version?: number;
}

export interface IssueAgeSettingsRecord extends WorkspaceRecord {
  kind: 'issueAgeSettings';
  agingDays: number;
  staleDays: number;
  criticalDays: number;
}

export interface AuditEventRecord extends WorkspaceRecord {
  kind: 'auditEvent';
  actorId: string;
  action: string;
  target: string;
  detail: string;
  eventType: 'team' | 'membership' | 'rock' | 'todo' | 'issue' | 'transfer' | 'profile' | 'meeting' | 'admin';
}

export interface DashboardSummary {
  teamId: string;
  rocks: { total: number; onTrack: number; offTrack: number; complete: number };
  todos: { total: number; done: number; open: number; notDone: number };
  issues: { total: number; open: number; inIds: number; solved: number; aging: number; stale: number; critical: number };
  metrics: { total: number; onTrack: number; offTrack: number };
}

export interface SessionContext {
  user: Pick<UserProfile, 'id' | 'name' | 'email' | 'initials' | 'active' | 'platformCapabilities'>;
  memberships: Array<Pick<TeamMembership, 'teamId' | 'role' | 'active'>>;
  leadershipVisible: boolean;
  platformAdmin: boolean;
  teams: Array<Pick<TeamRecord, 'teamId' | 'name' | 'shortName' | 'parentTeamId' | 'nodeType' | 'active'>>;
  currentEnvironment?: EnvironmentId;
}

export interface TeamWorkspace {
  environmentId?: EnvironmentId;
  team: TeamRecord;
  membership: Pick<TeamMembership, 'teamId' | 'role' | 'active'> | null;
  dashboard: DashboardSummary;
  rocks: RockRecord[];
  tasks: RockTaskRecord[];
  todos: TodoRecord[];
  issues: IssueRecord[];
  transfers: IssueTransferRecord[];
  notifications: NotificationRecord[];
  messages: TeamMessageRecord[];
  meetings: MeetingRecord[];
  etag: string;
}

export interface WorkspaceSnapshot {
  environmentId: EnvironmentId;
  user: UserProfile;
  teams: TeamRecord[];
  users: UserProfile[];
  memberships: TeamMembership[];
  settings: IssueAgeSettings;
  rocks: RockRecord[];
  tasks: RockTaskRecord[];
  todos: TodoRecord[];
  issues: IssueRecord[];
  transfers: IssueTransferRecord[];
  notifications: NotificationRecord[];
  messages: TeamMessageRecord[];
  meetings: MeetingRecord[];
  metrics: Array<WorkspaceRecord & { kind: 'scorecardMetric'; label: string; target: string; actual: string; unit: string; ownerId: string; status: 'on-track' | 'off-track'; trend: 'up' | 'down' | 'flat'; trendLabel: string }>;
  headlines: Array<WorkspaceRecord & { kind: 'headline'; authorId: string; type: 'win' | 'concern'; title: string; detail: string; issueId?: string }>;
  audit: AuditEventRecord[];
  quarter: { id: string; label: string; theme: string; startDate: string; endDate: string; daysRemaining: number };
  etag: string;
}

export interface TeamRollup {
  teamId: string;
  direct: {
    rocks: { total: number; onTrack: number; offTrack: number; complete: number };
    todos: { total: number; open: number; done: number; notDone: number };
    issues: { total: number; open: number; inIds: number; solved: number; aging: number; stale: number; critical: number };
  };
  descendants: { rocks: number; todos: number; issues: number };
}

export interface CompanyOverview {
  teams: TeamRollup[];
  issues: IssueRecord[];
  rocks: RockRecord[];
  todos: TodoRecord[];
  etag: string;
}

export const DEFAULT_ISSUE_AGE_SETTINGS: IssueAgeSettings = { agingDays: 7, staleDays: 14, criticalDays: 30 };

export const DEFAULT_MEETING_SECTIONS: MeetingSectionConfig[] = [
  { id: 'segue', label: 'Segue', enabled: true, duration: 5 },
  { id: 'scorecard', label: 'Scorecard', enabled: true, duration: 5 },
  { id: 'rock-review', label: 'Rock Review', enabled: true, duration: 5 },
  { id: 'headlines', label: 'Customer & Employee Headlines', enabled: true, duration: 5 },
  { id: 'todo-review', label: 'To-Do Review', enabled: true, duration: 5 },
  { id: 'ids', label: 'IDS', enabled: true, duration: 60 },
  { id: 'conclude', label: 'Conclude', enabled: true, duration: 5 },
];

export function meetingSectionsFor(team: Pick<TeamRecord, 'meetingSections'>): MeetingSectionConfig[] {
  const configured = team.meetingSections?.length ? team.meetingSections : DEFAULT_MEETING_SECTIONS;
  return configured.filter((section) => section.enabled).map((section) => ({ ...section }));
}

export const partitionFor = (scope: 'org' | 'team', id: string) => scope === 'org' ? 'org' : `team:${id}`;

export function canWriteTeam(role: UserRole | TeamRole) {
  return role === 'OrgAdmin' || role === 'TeamLead' || role === 'Member';
}

export function canManageTeam(role: UserRole | TeamRole) {
  return role === 'OrgAdmin' || role === 'TeamLead';
}

export function canAcceptTransfer(role: UserRole | TeamRole) {
  return role === 'TeamLead' || role === 'Member';
}

export function canAdministerPlatform(capabilities: readonly PlatformCapability[]) {
  return capabilities.includes('PlatformAdmin');
}

export function issueAgeBand(ageInDays: number, settings: IssueAgeSettings = DEFAULT_ISSUE_AGE_SETTINGS): IssueAgeBand {
  if (ageInDays >= settings.criticalDays) return 'critical';
  if (ageInDays >= settings.staleDays) return 'stale';
  if (ageInDays >= settings.agingDays) return 'aging';
  return 'fresh';
}

export function validateAgeSettings(settings: IssueAgeSettings) {
  if (!Number.isInteger(settings.agingDays) || !Number.isInteger(settings.staleDays) || !Number.isInteger(settings.criticalDays)) return false;
  return settings.agingDays > 0 && settings.agingDays < settings.staleDays && settings.staleDays < settings.criticalDays;
}

export function validateHierarchy(teams: readonly Pick<TeamRecord, 'teamId' | 'parentTeamId'>[]) {
  const ids = new Set<string>();
  for (const team of teams) {
    if (!team.teamId || ids.has(team.teamId) || team.parentTeamId === team.teamId) return false;
    ids.add(team.teamId);
  }
  for (const team of teams) {
    if (team.parentTeamId && !ids.has(team.parentTeamId)) return false;
    const seen = new Set<string>([team.teamId]);
    let parent = team.parentTeamId;
    while (parent) {
      if (seen.has(parent)) return false;
      seen.add(parent);
      parent = teams.find((candidate) => candidate.teamId === parent)?.parentTeamId ?? null;
    }
  }
  return true;
}

export function nextTodoStatus(status: TodoStatus): TodoStatus {
  return status === 'done' ? 'open' : 'done';
}
