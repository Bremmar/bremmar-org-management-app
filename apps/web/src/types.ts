export type ViewId = 'overview' | 'company' | 'meeting' | 'meeting-history' | 'rocks' | 'todos' | 'issues' | 'messages' | 'scorecard' | 'admin' | 'profile';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type RockTaskStatus = 'open' | 'in-progress' | 'done';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'solved';
export type IssueHorizon = 'short-term' | 'long-term';
export type IssueAssignmentState = 'assigned' | 'pending-transfer' | 'unassigned' | 'redirected';
export type IssueAgeBand = 'fresh' | 'aging' | 'stale' | 'critical';
export type IssueMeetingBand = 'neutral' | 'green' | 'yellow' | 'orange' | 'red';
export type MeetingStatus = 'upcoming' | 'in-progress' | 'closed' | 'skipped';
export type MeetingReviewStatus = MeetingStatus | 'missed' | 'overdue';
export type MeetingReviewFilter = 'attention' | 'completed' | 'skipped' | 'all';
export type MeetingSkipReason = 'public-holiday' | 'annual-leave' | 'other';
export type MeetingAiSummaryStatus = 'not-generated' | 'queued' | 'generating' | 'ready' | 'failed';
export type MetricStatus = 'on-track' | 'off-track';
export type ScorecardTrend = 'up' | 'down' | 'flat';
export type TeamNodeType = 'operational' | 'grouping';
export type TeamRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';
export type PlatformCapability = 'PlatformAdmin';
export type MessageStatus = 'unread' | 'read' | 'converted';
export type EscalationState = 'not-scheduled' | 'scheduled' | 'due' | 'escalated';
export type EnvironmentId = 'live' | 'test';
export type MeetingCadence = 'weekly' | 'monthly';

export function issueMeetingBand(meetingsPassed: number, status: IssueStatus): IssueMeetingBand {
  if (status === 'solved' || meetingsPassed <= 0) return 'neutral';
  if (meetingsPassed >= 4) return 'red';
  if (meetingsPassed === 3) return 'orange';
  if (meetingsPassed === 2) return 'yellow';
  return 'green';
}

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
  version?: number;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  description: string;
  parentTeamId: string | null;
  nodeType: TeamNodeType;
  memberCount: number;
  meetingCadence: MeetingCadence;
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
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  tasks: RockTask[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RockMilestoneCounts {
  total: number;
  completed: number;
  remaining: number;
}

export function rockMilestoneCounts(rock: Pick<Rock, 'tasks'>): RockMilestoneCounts {
  const total = rock.tasks.length;
  const completed = rock.tasks.filter((task) => task.status === 'done').length;
  return { total, completed, remaining: total - completed };
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
  sourceIssueId?: string;
  checklist: TodoChecklistItem[];
  createdAt: string;
  updatedAt: string;
  version: number;
  isMine?: boolean;
  carryForwardCount: number;
  flagged: boolean;
  convertedIssueId?: string;
}

export interface TodoChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  supporterId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  teamId: string;
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
  createdAt: string;
  updatedAt: string;
  solvedAt?: string;
  ageInDays: number;
  ageBand: IssueAgeBand;
  meetingBand: IssueMeetingBand;
  linkedRockId?: string;
  linkedScorecardMetricId?: string;
  linkedScorecardWeekStartDate?: string;
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

export interface ScorecardMetric {
  id: string;
  teamId: string;
  label: string;
  target: string;
  unit: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ScorecardResult {
  id: string;
  metricId: string;
  teamId: string;
  weekStartDate: string;
  actual: string;
  status: MetricStatus;
  trend: ScorecardTrend;
  trendLabel: string;
  createdAt: string;
  updatedAt: string;
  version: number;
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
  /** Calendar date selected for this meeting occurrence. Legacy snapshots may omit it. */
  scheduledDate?: string;
  /** Display-ready time selected for this meeting occurrence. Legacy snapshots may omit it. */
  scheduledTime?: string;
  /** The recurring cadence slot. One-off reschedules leave this unchanged. */
  recurrenceDate?: string;
  weekStartDate?: string;
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
  updatedAt?: string;
  sectionNotes: Partial<Record<MeetingSection, string>>;
  idsIssueIds: string[];
  idsAddedIssueIds: string[];
  createdTodoIds: string[];
  idsNotes: MeetingIssueNote[];
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
  version?: number;
}

export interface MeetingReviewItem {
  meeting: MeetingInstance;
  team: Pick<Team, 'id' | 'name' | 'shortName' | 'parentTeamId'>;
  reviewStatus: MeetingReviewStatus;
}

export interface MeetingReviewQuery {
  filter?: MeetingReviewFilter;
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
  version?: number;
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
  scorecardResults: ScorecardResult[];
  headlines: Headline[];
  meetings: MeetingInstance[];
  activity: AuditEvent[];
}

export function weekStartDateFor(value: string | Date = new Date()) {
  const dateValue = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return date.toISOString().slice(0, 10);
}

const weekdayOffsets: Record<string, number> = { sunday: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5 };

function dateOnlyFor(value: string | Date) {
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  const dateValue = dateOnly ? `${dateOnly}T12:00:00Z` : value;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date.');
  if (dateOnly && date.toISOString().slice(0, 10) !== dateOnly) throw new Error('Invalid date.');
  return date;
}

export function meetingDateFor(team: Pick<Team, 'meetingCadence' | 'meetingDay'>, value: string | Date = new Date()) {
  const current = dateOnlyFor(value);
  if (team.meetingCadence === 'monthly') {
    const requestedDay = Number.parseInt(team.meetingDay.trim(), 10);
    if (Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 31) {
      const lastDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
      current.setUTCDate(Math.min(requestedDay, lastDay));
    }
    return current.toISOString().slice(0, 10);
  }
  const weekStart = dateOnlyFor(weekStartDateFor(current));
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekdayOffsets[team.meetingDay.trim().toLowerCase()] ?? 0));
  return weekStart.toISOString().slice(0, 10);
}

export function nextMeetingDateFor(value: string | Date, cadence: MeetingCadence = 'weekly') {
  const date = dateOnlyFor(value);
  if (cadence === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  }
  const dayOfMonth = date.getUTCDate();
  const nextMonth = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), nextMonth + 1, 0)).getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(nextMonth);
  date.setUTCDate(Math.min(dayOfMonth, lastDay));
  return date.toISOString().slice(0, 10);
}

export function nextMeetingDateAfter(value: string | Date, cadence: MeetingCadence = 'weekly', after: string | Date = new Date()) {
  const afterDate = dateOnlyFor(after).toISOString().slice(0, 10);
  let next = nextMeetingDateFor(value, cadence);
  let guard = 0;
  while (next <= afterDate && guard < 120) {
    next = nextMeetingDateFor(next, cadence);
    guard += 1;
  }
  return next;
}

function monthlyMeetingDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay), 12)).toISOString().slice(0, 10);
}

export function nextConfiguredMeetingDateAfter(team: Pick<Team, 'meetingCadence' | 'meetingDay'>, value: string | Date, after: string | Date = new Date()) {
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
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekdayOffsets[team.meetingDay.trim().toLowerCase()] ?? 0));
  next = weekStart.toISOString().slice(0, 10);
  if (next <= currentDate) next = nextMeetingDateFor(next, 'weekly');
  while (next <= afterDate) next = nextMeetingDateFor(next, 'weekly');
  return next;
}

export function meetingDateLabel(scheduledDate: string) {
  return dateOnlyFor(scheduledDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(', ', ' · ');
}

export function meetingScheduledAt(meeting: Pick<MeetingInstance, 'scheduledDate' | 'scheduledTime'>): number {
  if (!meeting.scheduledDate) return Number.NaN;
  const dateMatch = meeting.scheduledDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return Number.NaN;
  const time = (meeting.scheduledTime ?? '').trim();
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
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

export function meetingDurationMinutes(team: Pick<Team, 'meetingSections'>) {
  return meetingSectionsFor(team).reduce((total, section) => total + section.duration, 0);
}

export function meetingReviewStatus(meeting: MeetingInstance, team: Pick<Team, 'meetingSections'>, at = Date.now()): MeetingReviewStatus {
  if (meeting.status === 'closed' || meeting.status === 'skipped') return meeting.status;
  if (meeting.status === 'in-progress') {
    const startedAt = meeting.startedAt ? new Date(meeting.startedAt).getTime() : Number.NaN;
    if (Number.isFinite(startedAt) && startedAt + meetingDurationMinutes(team) * 60_000 < at) return 'overdue';
    return 'in-progress';
  }
  const scheduledAt = meetingScheduledAt(meeting);
  return Number.isFinite(scheduledAt) && scheduledAt < at ? 'missed' : 'upcoming';
}

export function normalizeMeeting(meeting: MeetingInstance, team?: Pick<Team, 'meetingCadence' | 'meetingDay' | 'meetingTime'>): MeetingInstance {
  const fallbackTeam = team ?? { meetingCadence: 'weekly' as const, meetingDay: 'Monday', meetingTime: '9:00 AM' };
  let scheduledDate = meeting.scheduledDate;
  try {
    if (!scheduledDate) scheduledDate = meetingDateFor(fallbackTeam, meeting.weekStartDate ?? new Date());
    dateOnlyFor(scheduledDate);
  } catch {
    scheduledDate = meetingDateFor(fallbackTeam, meeting.weekStartDate ?? new Date());
  }
  const scheduledTime = meeting.scheduledTime?.trim() || fallbackTeam.meetingTime || '9:00 AM';
  return { ...meeting, scheduledDate, scheduledTime, recurrenceDate: meeting.recurrenceDate ?? scheduledDate, dateLabel: meetingDateLabel(scheduledDate), weekStartDate: weekStartDateFor(scheduledDate), sectionNotes: meeting.sectionNotes ?? {}, idsIssueIds: meeting.idsIssueIds ?? [], idsAddedIssueIds: meeting.idsAddedIssueIds ?? [], createdTodoIds: meeting.createdTodoIds ?? [], idsNotes: meeting.idsNotes ?? [], version: meeting.version ?? 1 };
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

export interface TeamRollup {
  teamId: string;
  direct: {
    rocks: { total: number; onTrack: number; offTrack: number; complete: number };
    todos: { total: number; open: number; done: number; notDone: number };
    issues: { total: number; open: number; inIds: number; solved: number; neutral: number; green: number; yellow: number; orange: number; red: number };
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
