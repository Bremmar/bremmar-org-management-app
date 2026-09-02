export type ViewId = 'overview' | 'company' | 'meeting' | 'rocks' | 'todos' | 'issues' | 'messages' | 'scorecard' | 'admin' | 'profile';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type RockTaskStatus = 'open' | 'in-progress' | 'done';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'solved';
export type IssueHorizon = 'short-term' | 'long-term';
export type IssueAssignmentState = 'assigned' | 'pending-transfer' | 'unassigned' | 'redirected';
export type IssueAgeBand = 'fresh' | 'aging' | 'stale' | 'critical';
export type MeetingStatus = 'upcoming' | 'in-progress' | 'closed';
export type MetricStatus = 'on-track' | 'off-track';
export type TeamNodeType = 'operational' | 'grouping';
export type TeamRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';
export type PlatformCapability = 'PlatformAdmin';
export type MessageStatus = 'unread' | 'read' | 'converted';
export type EscalationState = 'not-scheduled' | 'scheduled' | 'due' | 'escalated';
export type EnvironmentId = 'live' | 'test';

export interface EnvironmentSummary {
  id: EnvironmentId;
  label: string;
  canAccess: boolean;
}

export interface EnvironmentSession {
  currentEnvironment: EnvironmentId;
  availableEnvironments: EnvironmentSummary[];
  canSwitchToTest: boolean;
}

export interface EnvironmentAccess {
  userId: string;
  name: string;
  email: string;
  testAllowed: boolean;
  version: number;
}

export type MeetingSection =
  | 'segue'
  | 'scorecard'
  | 'rock-review'
  | 'headlines'
  | 'todo-review'
  | 'ids'
  | 'conclude';

export interface MeetingSectionConfig {
  id: MeetingSection;
  label: string;
  enabled: boolean;
  duration: number;
}

export interface User {
  id: string;
  name: string;
  initials: string;
  email: string;
  accent: string;
  active: boolean;
  platformCapabilities: PlatformCapability[];
  avatarDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  description: string;
  parentTeamId: string | null;
  nodeType: TeamNodeType;
  memberCount: number;
  meetingDay: string;
  meetingTime: string;
  accent: string;
  initials: string;
  active: boolean;
  meetingSections: MeetingSectionConfig[];
  escalationUserIds: string[];
}

export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Quarter {
  id: string;
  label: string;
  theme: string;
  startDate: string;
  endDate: string;
  daysRemaining: number;
}

export interface RockTask {
  id: string;
  rockId: string;
  teamId: string;
  title: string;
  notes: string;
  assigneeId: string;
  assignedAt: string;
  startDate: string;
  dueDate: string;
  status: RockTaskStatus;
  linkedTodoId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Rock {
  id: string;
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
  tasks: RockTask[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Todo {
  id: string;
  teamId: string;
  title: string;
  notes: string;
  ownerId: string;
  dueDate: string;
  status: TodoStatus;
  origin: string;
  linkedRockTaskId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  isMine?: boolean;
  carryForwardCount: number;
  flagged: boolean;
  convertedIssueId?: string;
}

export interface Issue {
  id: string;
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
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
  ageInDays: number;
  ageBand: IssueAgeBand;
  linkedRockId?: string;
  idsNote?: string;
  version: number;
  meetingsPassed: number;
  escalationState: EscalationState;
  escalationDueAt?: string;
  escalationLevel: number;
  escalatedToUserId?: string;
  sourceTodoId?: string;
}

export type IssueTransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface IssueTransfer {
  id: string;
  issueId: string;
  sourceTeamId: string;
  destinationTeamId: string;
  requestedById: string;
  requestedAt: string;
  status: IssueTransferStatus;
  sourceIssueVersion: number;
  decidedById?: string;
  decidedAt?: string;
  rejectionMessage?: string;
  note?: string;
  version: number;
}

export interface Notification {
  id: string;
  recipientUserId: string;
  type: 'issue-transfer-requested' | 'issue-transfer-decided' | 'team-message' | 'issue-escalation' | 'system';
  title: string;
  message: string;
  issueId?: string;
  transferId?: string;
  teamId?: string;
  createdAt: string;
  readAt?: string;
}

export interface TeamMessage {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  senderId: string;
  subject: string;
  body: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  readAt?: string;
  convertedIssueId?: string;
  version: number;
}

export interface MeetingIssueNote {
  id: string;
  meetingId: string;
  issueId: string;
  authorId: string;
  note: string;
  createdAt: string;
}

export interface ScorecardMetric {
  id: string;
  teamId: string;
  label: string;
  target: string;
  actual: string;
  unit: string;
  ownerId: string;
  status: MetricStatus;
  trend: 'up' | 'down' | 'flat';
  trendLabel: string;
}

export interface Headline {
  id: string;
  teamId: string;
  authorId: string;
  type: 'win' | 'concern';
  title: string;
  detail: string;
  createdAt: string;
  issueId?: string;
}

export interface MeetingInstance {
  id: string;
  teamId: string;
  label: string;
  dateLabel: string;
  status: MeetingStatus;
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
  idsNotes: MeetingIssueNote[];
  version?: number;
}

export interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
  type: 'team' | 'membership' | 'rock' | 'todo' | 'issue' | 'transfer' | 'profile' | 'meeting';
}

export interface IssueAgeSettings {
  agingDays: number;
  staleDays: number;
  criticalDays: number;
}

export interface Workspace {
  environment: EnvironmentId;
  currentUser: User;
  quarter: Quarter;
  settings: IssueAgeSettings;
  teams: Team[];
  users: User[];
  memberships: TeamMembership[];
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  messages: TeamMessage[];
  transfers: IssueTransfer[];
  notifications: Notification[];
  metrics: ScorecardMetric[];
  headlines: Headline[];
  meetings: MeetingInstance[];
  activity: AuditEvent[];
}

export interface TeamRollup {
  teamId: string;
  direct: {
    rocks: { total: number; onTrack: number; offTrack: number; complete: number };
    todos: { total: number; open: number; done: number; notDone: number };
    issues: { total: number; open: number; inIds: number; solved: number; aging: number; stale: number; critical: number };
  };
  descendants: {
    rocks: number;
    todos: number;
    issues: number;
  };
}

export interface CompanyOverview {
  teams: TeamRollup[];
  issues: Issue[];
  rocks: Rock[];
  todos: Todo[];
}

export const agendaSections: Array<{
  id: MeetingSection;
  label: string;
  shortLabel: string;
  duration: number;
}> = [
  { id: 'segue', label: 'Segue', shortLabel: 'Segue', duration: 5 },
  { id: 'scorecard', label: 'Scorecard', shortLabel: 'Scorecard', duration: 5 },
  { id: 'rock-review', label: 'Rock Review', shortLabel: 'Rocks', duration: 5 },
  { id: 'headlines', label: 'Customer & Employee Headlines', shortLabel: 'Headlines', duration: 5 },
  { id: 'todo-review', label: 'To-Do Review', shortLabel: 'To-Dos', duration: 5 },
  { id: 'ids', label: 'IDS', shortLabel: 'IDS', duration: 60 },
  { id: 'conclude', label: 'Conclude', shortLabel: 'Conclude', duration: 5 },
];

export const defaultMeetingSections = (): MeetingSectionConfig[] => agendaSections.map((section) => ({
  id: section.id,
  label: section.label,
  enabled: true,
  duration: section.duration,
}));

export function meetingSectionsFor(team: Pick<Team, 'meetingSections'>): MeetingSectionConfig[] {
  const configured = team.meetingSections?.length ? team.meetingSections : defaultMeetingSections();
  return configured.filter((section) => section.enabled).map((section) => ({
    ...section,
    label: section.label.trim() || agendaSections.find((defaultSection) => defaultSection.id === section.id)?.label || section.id,
    duration: Number.isFinite(section.duration) && section.duration > 0 ? section.duration : agendaSections.find((defaultSection) => defaultSection.id === section.id)?.duration || 5,
  }));
}
