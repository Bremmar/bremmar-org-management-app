export type UserRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';
export type TeamRole = 'TeamLead' | 'Member' | 'Viewer';
export type PlatformCapability = 'PlatformAdmin';
export type TeamNodeType = 'operational' | 'grouping';
export type MeetingCadence = 'weekly' | 'monthly';
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
  | 'vto'
  | 'vtoVersion'
  | 'meeting'
  | 'meetingSummaryJob'
  | 'rock'
  | 'rockTask'
  | 'todo'
  | 'issue'
  | 'issueTransfer'
  | 'scorecardMetric'
  | 'scorecardResult'
  | 'headline'
  | 'notification'
  | 'message'
  | 'issueAgeSettings'
  | 'auditEvent';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type RockTaskStatus = 'open' | 'in-progress' | 'done';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'parked' | 'solved';
export type IssueHorizon = 'short-term' | 'long-term';
export type IssueAssignmentState = 'assigned' | 'pending-transfer' | 'unassigned' | 'redirected';
export type IssueAgeBand = 'fresh' | 'aging' | 'stale' | 'critical';
export type IssueMeetingBand = 'neutral' | 'green' | 'yellow' | 'orange' | 'red';
export type IssueTransferStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type NotificationType = 'issue-transfer-requested' | 'issue-transfer-decided' | 'team-message' | 'issue-escalation' | 'system';
export type MessageStatus = 'unread' | 'read' | 'converted';
export type ScorecardStatus = 'on-track' | 'off-track';
export type ScorecardTrend = 'up' | 'down' | 'flat';
export type EscalationState = 'not-scheduled' | 'scheduled' | 'due' | 'escalated';
export type MeetingSection = 'segue' | 'scorecard' | 'rock-review' | 'headlines' | 'todo-review' | 'ids' | 'conclude';
export type MeetingStatus = 'upcoming' | 'in-progress' | 'closed' | 'skipped';
export type MeetingReviewStatus = MeetingStatus | 'missed' | 'overdue';
export type MeetingReviewFilter = 'attention' | 'completed' | 'skipped' | 'all';
export type MeetingSkipReason = 'public-holiday' | 'annual-leave' | 'other';
export type MeetingAiSummaryStatus = 'not-generated' | 'queued' | 'generating' | 'ready' | 'failed' | 'cancelled';
export type QuarterStatus = 'past' | 'current' | 'upcoming';

export interface QuarterRecord extends WorkspaceRecord {
  kind: 'quarter';
  label: string;
  theme: string;
  startDate: string;
  endDate: string;
}

export interface QuarterSummary extends Pick<QuarterRecord, 'id' | 'label' | 'theme' | 'startDate' | 'endDate'> {
  status: QuarterStatus;
  daysRemaining: number;
  daysUntilStart?: number;
}

export interface VtoMarketingStrategy {
  targetMarket: string;
  uniques: string[];
  provenProcess: string;
  guarantee: string;
}

export interface VtoThreeYearPicture {
  targetDate: string;
  revenue: string;
  profit: string;
  headcount: string;
  description: string;
}

export interface VtoOneYearPlan {
  year: number;
  revenue: string;
  profit: string;
  measurables: string[];
  goals: string[];
}

/** The eight EOS V/TO questions, with operational links kept as references. */
export interface VtoContent {
  coreValues: string[];
  coreFocusPurpose: string;
  coreFocusNiche: string;
  tenYearTarget: string;
  marketingStrategy: VtoMarketingStrategy;
  threeYearPicture: VtoThreeYearPicture;
  oneYearPlan: VtoOneYearPlan;
  quarterlyRockIds: string[];
  issueIds: string[];
}

export interface VtoRecord extends WorkspaceRecord, VtoContent {
  kind: 'vto';
  teamId: string;
  versionNumber: number;
  effectiveDate: string;
  changeSummary: string;
  savedBy: string;
}

export interface VtoVersionRecord extends WorkspaceRecord, VtoContent {
  kind: 'vtoVersion';
  teamId: string;
  vtoId: string;
  versionNumber: number;
  effectiveDate: string;
  changeSummary: string;
  savedBy: string;
}

export interface VtoDocument {
  current: VtoRecord | null;
  versions: VtoVersionRecord[];
}

export function issueMeetingBand(meetingsPassed: number, status: IssueStatus): IssueMeetingBand {
  if (status === 'solved' || meetingsPassed <= 0) return 'neutral';
  if (meetingsPassed >= 4) return 'red';
  if (meetingsPassed === 3) return 'orange';
  if (meetingsPassed === 2) return 'yellow';
  return 'green';
}

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

export interface HeadlineRecord extends WorkspaceRecord {
  kind: 'headline';
  teamId: string;
  quarterId?: string;
  authorId: string;
  type: 'win' | 'concern';
  title: string;
  detail: string;
  issueId?: string;
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
  meetingCadence: MeetingCadence;
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

export interface DeleteRockTaskResult {
  deletedTaskId: string;
  rockId: string;
  rockVersion: number;
}

export interface TodoChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  supporterId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodoRecord extends WorkspaceRecord {
  kind: 'todo';
  teamId: string;
  quarterId?: string;
  title: string;
  notes: string;
  ownerId: string;
  dueDate: string;
  status: TodoStatus;
  origin: string;
  linkedRockTaskId?: string;
  sourceIssueId?: string;
  checklist: TodoChecklistItem[];
  carryForwardCount: number;
  flagged: boolean;
  convertedIssueId?: string;
}

export interface IssueRecord extends WorkspaceRecord {
  kind: 'issue';
  teamId: string;
  quarterId?: string;
  sourceTeamId: string;
  currentTeamId: string | null;
  title: string;
  detail: string;
  priority: number;
  status: IssueStatus;
  horizon: IssueHorizon;
  assignmentState: IssueAssignmentState;
  raisedById: string;
  ownerId?: string;
  solvedAt?: string;
  linkedRockId?: string;
  linkedScorecardMetricId?: string;
  linkedScorecardWeekStartDate?: string;
  idsNote?: string;
  ageInDays: number;
  ageBand: IssueAgeBand;
  meetingsPassed: number;
  meetingBand: IssueMeetingBand;
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

export interface MeetingAttendeeRating {
  attendeeId: string;
  rating: number;
}

/** Named participant data supplied to the AI worker; IDs remain internal metadata. */
export interface MeetingParticipantSnapshot {
  id: string;
  name: string;
  rating?: number;
}

/** Member ratings use the same 0.5–10 scale as the L10 rating control. */
export function isValidMeetingRating(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0.5
    && value <= 10
    && Number.isInteger(value * 2);
}

/** The meeting score is the arithmetic mean of its recorded member ratings. */
export function averageMeetingRating(ratings: readonly MeetingAttendeeRating[]): number | undefined {
  if (!ratings.length) return undefined;
  const average = ratings.reduce((total, entry) => total + entry.rating, 0) / ratings.length;
  return Number(average.toFixed(2));
}

export interface MeetingActionSummary {
  todosCreated: number;
  issuesReviewedInIds: number;
  issuesAddedToIds: number;
  issuesSolved: number;
}

export interface MeetingAiSummary {
  executiveSummary: string;
  decisions: string[];
  commitments: string[];
  risks: string[];
  nextFocus: string[];
  generatedAt: string;
  source: 'close' | 'legacy';
}

export interface MeetingRecord extends WorkspaceRecord {
  kind: 'meeting';
  teamId: string;
  quarterId?: string;
  label: string;
  dateLabel: string;
  /** Calendar date selected for this meeting occurrence. */
  scheduledDate: string;
  /** Display-ready time selected for this meeting occurrence. */
  scheduledTime: string;
  /** The recurring cadence slot. One-off reschedules leave this unchanged. */
  recurrenceDate?: string;
  /** ISO Monday-start week used to match this meeting to Scorecard results. */
  weekStartDate: string;
  status: MeetingStatus;
  facilitatorId: string;
  attendeeIds: string[];
  lastRating: number;
  agendaProgress: number;
  agendaTotal: number;
  idsSolved: number;
  idsTotal: number;
  recap: string;
  /** The exact facilitator-entered close-time recap, kept separate from the generated record snapshot. */
  manualRecap?: string;
  startedAt?: string;
  closedAt?: string;
  durationSeconds?: number;
  sectionDurations?: Partial<Record<MeetingSection, number>>;
  activeSection?: MeetingSection;
  activeSectionStartedAt?: string;
  attendeeRatings?: MeetingAttendeeRating[];
  sectionNotes: Partial<Record<MeetingSection, string>>;
  idsIssueIds: string[];
  idsAddedIssueIds: string[];
  createdTodoIds: string[];
  idsNotes: MeetingIssueNoteRecord[];
  actionSummary?: MeetingActionSummary;
  skipReason?: MeetingSkipReason;
  skipNote?: string;
  skippedAt?: string;
  skippedById?: string;
  aiSummaryStatus?: MeetingAiSummaryStatus;
  aiSummary?: MeetingAiSummary;
  aiSummaryError?: string;
  aiSummaryRequestedAt?: string;
  aiSummaryGeneratedAt?: string;
  aiSummaryJobId?: string;
  aiSummarySource?: 'close' | 'legacy';
}

export interface MeetingGenerationResult {
  deletedCount: number;
  createdCount: number;
  meetings: MeetingRecord[];
}

export interface MeetingSummaryContext {
  meetingId: string;
  teamId: string;
  label: string;
  scheduledDate: string;
  scheduledTime: string;
  facilitatorId: string;
  facilitatorName?: string;
  startedAt?: string;
  closedAt: string;
  durationSeconds?: number;
  sectionDurations?: Partial<Record<MeetingSection, number>>;
  attendeeIds: string[];
  attendees?: MeetingParticipantSnapshot[];
  attendeeRatings?: MeetingAttendeeRating[];
  manualRecap?: string;
  recap: string;
  sectionNotes: Partial<Record<MeetingSection, string>>;
  idsNotes: MeetingIssueNoteRecord[];
  actionSummary?: MeetingActionSummary;
  rocks: Array<{ id: string; title: string; status: RockStatus; completedMilestones: number; remainingMilestones: number; dueDate: string }>;
  todos: Array<{ id: string; title: string; status: TodoStatus; ownerId: string; dueDate: string }>;
  issues: Array<{ id: string; title: string; status: IssueStatus; idsNote?: string }>;
  headlines: Array<{ title: string; type: 'win' | 'concern'; detail: string }>;
  scorecard: Array<{ label: string; target: string; actual?: string; status?: ScorecardStatus }>;
}

export interface MeetingSummaryJobRecord extends WorkspaceRecord {
  kind: 'meetingSummaryJob';
  teamId: string;
  meetingId: string;
  status: Exclude<MeetingAiSummaryStatus, 'not-generated'>;
  attempt: number;
  source: 'close' | 'legacy';
  contextSnapshot: MeetingSummaryContext;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface MeetingReviewItem {
  meeting: MeetingRecord;
  team: Pick<TeamRecord, 'teamId' | 'name' | 'shortName' | 'parentTeamId'>;
  reviewStatus: MeetingReviewStatus;
}

export interface MeetingReviewQuery {
  filter?: MeetingReviewFilter;
  /** Optional status alias for API consumers that want a precise review state. */
  status?: MeetingReviewFilter | MeetingReviewStatus;
  teamId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface MeetingReviewPage {
  items: MeetingReviewItem[];
  attentionCount: number;
  nextCursor?: string;
}

export interface ScorecardMetricRecord extends WorkspaceRecord {
  kind: 'scorecardMetric';
  teamId: string;
  label: string;
  target: string;
  unit: string;
  ownerId: string;
}

export interface ScorecardResultRecord extends WorkspaceRecord {
  kind: 'scorecardResult';
  teamId: string;
  metricId: string;
  weekStartDate: string;
  actual: string;
  status: ScorecardStatus;
  trend: ScorecardTrend;
  trendLabel: string;
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
  eventType: 'team' | 'membership' | 'rock' | 'todo' | 'issue' | 'transfer' | 'profile' | 'meeting' | 'vto' | 'admin';
}

export type AuditEntityType = 'rock' | 'todo' | 'issue';

export interface DashboardSummary {
  teamId: string;
  rocks: { total: number; onTrack: number; offTrack: number; complete: number };
  todos: { total: number; done: number; open: number; notDone: number };
  issues: { total: number; open: number; inIds: number; solved: number; neutral: number; green: number; yellow: number; orange: number; red: number };
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
  metrics: ScorecardMetricRecord[];
  scorecardResults: ScorecardResultRecord[];
  headlines: HeadlineRecord[];
  vto: VtoRecord | null;
  vtoVersions: VtoVersionRecord[];
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
  metrics: ScorecardMetricRecord[];
  scorecardResults: ScorecardResultRecord[];
  headlines: HeadlineRecord[];
  audit: AuditEventRecord[];
  quarters: QuarterSummary[];
  vtos: VtoRecord[];
  vtoVersions: VtoVersionRecord[];
  quarter: QuarterSummary;
  etag: string;
}

export interface TeamRollup {
  teamId: string;
  direct: {
    rocks: { total: number; onTrack: number; offTrack: number; complete: number };
    todos: { total: number; open: number; done: number; notDone: number };
    issues: { total: number; open: number; inIds: number; solved: number; neutral: number; green: number; yellow: number; orange: number; red: number };
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

/** Normalize the saved sections while preserving a legacy partial agenda. */
export function normalizeMeetingSections(sections?: readonly MeetingSectionConfig[]): MeetingSectionConfig[] {
  const configured = sections?.length ? sections : DEFAULT_MEETING_SECTIONS;
  const defaultsById = new Map(DEFAULT_MEETING_SECTIONS.map((section) => [section.id, section]));
  const seen = new Set<MeetingSection>();
  const ordered = configured.flatMap((section) => {
    const fallback = defaultsById.get(section.id);
    if (!fallback || seen.has(section.id)) return [];
    seen.add(section.id);
    return [{
      id: section.id,
      label: section.label?.trim() || fallback.label,
      enabled: section.enabled !== false,
      duration: Number.isInteger(section.duration) && section.duration > 0 ? section.duration : fallback.duration,
    }];
  });
  return ordered;
}

export function meetingSectionsFor(team: Pick<TeamRecord, 'meetingSections'>): MeetingSectionConfig[] {
  return normalizeMeetingSections(team.meetingSections).filter((section) => section.enabled);
}

export function meetingScheduledAt(meeting: Pick<MeetingRecord, 'scheduledDate' | 'scheduledTime'>): number {
  const dateMatch = meeting.scheduledDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.NaN;
  const timeMatch = meeting.scheduledTime.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!timeMatch) return Date.parse(`${meeting.scheduledDate}T00:00:00Z`);
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toUpperCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return Number.NaN;
    if (meridiem === 'PM' && hour !== 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return Number.NaN;
  return Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute);
}

export function meetingDurationMinutes(team: Pick<TeamRecord, 'meetingSections'>) {
  return meetingSectionsFor(team).reduce((total, section) => total + section.duration, 0);
}

export function meetingReviewStatus(meeting: MeetingRecord, team: Pick<TeamRecord, 'meetingSections'>, at = Date.now()): MeetingReviewStatus {
  if (meeting.status === 'closed' || meeting.status === 'skipped') return meeting.status;
  if (meeting.status === 'in-progress') {
    const startedAt = meeting.startedAt ? new Date(meeting.startedAt).getTime() : Number.NaN;
    if (Number.isFinite(startedAt) && startedAt + meetingDurationMinutes(team) * 60_000 < at) return 'overdue';
    return 'in-progress';
  }
  const scheduledAt = meetingScheduledAt(meeting);
  return Number.isFinite(scheduledAt) && scheduledAt < at ? 'missed' : 'upcoming';
}

export const partitionFor = (scope: 'org' | 'team', id: string) => scope === 'org' ? 'org' : `team:${id}`;

export function weekStartDateFor(value: string | Date = new Date()) {
  const dateValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  const day = date.getUTCDay();
  const daysFromMonday = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function dateOnlyFor(value: string | Date) {
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  const dateValue = dateOnly ? `${dateOnly}T12:00:00Z` : value;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  if (dateOnly && date.toISOString().slice(0, 10) !== dateOnly) throw new Error('Invalid date.');
  return date;
}

function quarterDateAt(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid quarter date.');
  return date;
}

/** Add calculated status to a persisted quarter without storing volatile dates. */
export function quarterSummary(record: Pick<QuarterRecord, 'id' | 'label' | 'theme' | 'startDate' | 'endDate'>, at: string | Date = new Date()): QuarterSummary {
  const start = quarterDateAt(record.startDate);
  const end = quarterDateAt(record.endDate);
  const reference = new Date(at);
  if (Number.isNaN(reference.getTime())) throw new Error('Invalid quarter reference date.');
  const referenceDate = reference.toISOString().slice(0, 10);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const status: QuarterStatus = referenceDate < startDate ? 'upcoming' : referenceDate > endDate ? 'past' : 'current';
  const endOfQuarter = Date.parse(`${endDate}T23:59:59.999Z`);
  const startOfQuarter = Date.parse(`${startDate}T00:00:00.000Z`);
  return {
    id: record.id,
    label: record.label,
    theme: record.theme,
    startDate,
    endDate,
    status,
    daysRemaining: status === 'current' ? Math.max(0, Math.ceil((endOfQuarter - reference.getTime()) / (24 * 60 * 60 * 1000))) : 0,
    ...(status === 'upcoming' ? { daysUntilStart: Math.max(0, Math.ceil((startOfQuarter - reference.getTime()) / (24 * 60 * 60 * 1000))) } : {}),
  };
}

export function quarterIdForDate(value: string | Date, quarters: readonly Pick<QuarterRecord, 'id' | 'startDate' | 'endDate'>[]) {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return quarters.find((quarter) => date >= quarter.startDate && date <= quarter.endDate)?.id;
}

export function currentQuarterId(quarters: readonly QuarterSummary[]) {
  return quarters.find((quarter) => quarter.status === 'current')?.id ?? [...quarters].sort((left, right) => left.startDate.localeCompare(right.startDate)).at(-1)?.id;
}

/** Return the next occurrence, preserving the day of month for monthly teams. */
export function nextMeetingDateFor(value: string | Date, cadence: MeetingCadence = 'weekly') {
  const date = dateOnlyFor(value);
  if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else {
    const dayOfMonth = date.getUTCDate();
    const nextMonth = date.getUTCMonth() + 1;
    const nextMonthLastDay = new Date(Date.UTC(date.getUTCFullYear(), nextMonth + 1, 0)).getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(nextMonth);
    date.setUTCDate(Math.min(dayOfMonth, nextMonthLastDay));
  }
  return date.toISOString().slice(0, 10);
}

/** Move a recurrence forward until it is after the supplied date. */
export function nextMeetingDateAfter(value: string | Date, cadence: MeetingCadence, after: string | Date = new Date()) {
  const afterDate = dateOnlyFor(after).getTime();
  let next = nextMeetingDateFor(value, cadence);
  let guard = 0;
  while (dateOnlyFor(next).getTime() <= afterDate && guard < 120) {
    next = nextMeetingDateFor(next, cadence);
    guard += 1;
  }
  return next;
}

const meetingWeekdayOffsets: Record<string, number> = { sunday: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5 };

function monthlyMeetingDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)).toISOString().slice(0, 10);
}

/** Return the next occurrence from the team's configured cadence after a meeting is closed. */
export function nextConfiguredMeetingDateAfter(team: Pick<TeamRecord, 'meetingCadence' | 'meetingDay'>, value: string | Date, after: string | Date = new Date()) {
  const current = dateOnlyFor(value);
  const currentDate = current.toISOString().slice(0, 10);
  const afterDate = dateOnlyFor(after).toISOString().slice(0, 10);
  let next: string;
  const requestedDay = Number.parseInt(team.meetingDay.trim(), 10);
  if (team.meetingCadence === 'monthly' && Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 31) {
    next = monthlyMeetingDate(current.getUTCFullYear(), current.getUTCMonth() + 1, requestedDay);
    while (next <= afterDate) {
      const nextMonth = dateOnlyFor(next);
      next = monthlyMeetingDate(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, requestedDay);
    }
    return next;
  }
  if (team.meetingCadence === 'monthly') return nextMeetingDateAfter(current, 'monthly', after);
  const weekStart = dateOnlyFor(weekStartDateFor(current));
  weekStart.setUTCDate(weekStart.getUTCDate() + (meetingWeekdayOffsets[team.meetingDay.trim().toLowerCase()] ?? 0));
  next = weekStart.toISOString().slice(0, 10);
  if (next <= currentDate) next = nextMeetingDateFor(next, 'weekly');
  while (next <= afterDate) next = nextMeetingDateFor(next, 'weekly');
  return next;
}

export function scorecardTrendFor(actual: string, priorActual?: string): { trend: ScorecardTrend; trendLabel: string } {
  const current = Number(actual.trim().replace(/%$/, ''));
  const prior = priorActual === undefined ? Number.NaN : Number(priorActual.trim().replace(/%$/, ''));
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return { trend: 'flat', trendLabel: 'No comparable prior result' };
  const delta = current - prior;
  if (delta === 0) return { trend: 'flat', trendLabel: 'No change vs prior week' };
  const formatted = Number.isInteger(delta) ? String(delta) : delta.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return { trend: delta > 0 ? 'up' : 'down', trendLabel: `${delta > 0 ? '+' : ''}${formatted} vs prior week` };
}

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
