import { CosmosClient, type Container } from '@azure/cosmos';
import { normalizeObjectId, type ClientPrincipal } from '../auth.js';
import {
  canAcceptTransfer,
  canAdministerPlatform,
  canManageTeam,
  canWriteTeam,
  currentQuarterId,
  DEFAULT_ISSUE_AGE_SETTINGS,
  DEFAULT_MEETING_SECTIONS,
  averageMeetingRating,
  issueAgeBand,
  issueMeetingBand,
  isValidMeetingRating,
  meetingScheduledAt,
  meetingReviewStatus,
  normalizeMeetingSections,
  meetingSectionsFor,
  nextConfiguredMeetingDateAfter,
  partitionFor,
  quarterIdForDate,
  quarterSummary,
  scorecardTrendFor,
  weekStartDateFor,
  type AuditEventRecord,
  type AuditEntityType,
  type CompanyOverview,
  type DeleteRockTaskResult,
  type DashboardSummary,
  type EnvironmentId,
  type IssueAgeSettings,
  type IssueAgeSettingsRecord,
  type IssueRecord,
  type IssueTransferRecord,
  type MeetingActionSummary,
  type MeetingAttendeeRating,
  type MeetingAiSummary,
  type MeetingReviewPage,
  type MeetingReviewQuery,
  type MeetingSkipReason,
  type MeetingSummaryContext,
  type MeetingSummaryJobRecord,
  type MeetingCadence,
  type MeetingIssueNoteRecord,
  type MeetingRecord,
  type MeetingSection,
  type MeetingSectionConfig,
  type HeadlineRecord,
  type QuarterRecord,
  type QuarterSummary,
  type TeamMessageRecord,
  type NotificationRecord,
  type RockRecord,
  type RockTaskRecord,
  type ScorecardMetricRecord,
  type ScorecardResultRecord,
  type SessionContext,
  type TeamMembership,
  type TeamRecord,
  type TeamWorkspace,
  type TodoChecklistItem,
  type WorkspaceSnapshot,
  type TodoRecord,
  type VtoContent,
  type VtoDocument,
  type VtoRecord,
  type VtoVersionRecord,
  type UserProfile,
  type WorkspaceRecord,
} from '../domain.js';
import { richTextToPlainText, sanitizeRichText, sanitizeTodoNotes } from '../richText.js';

export type RepositoryErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE';

export class RepositoryError extends Error {
  constructor(public readonly code: RepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RepositoryError';
  }
}

class CosmosBatchError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'CosmosBatchError';
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

export interface CreateUserInput {
  name: string;
  email: string;
  accent: string;
  platformAdmin?: boolean;
  /** Normalized Entra directory object ID for a deployed identity-linked user. */
  identityId?: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  platformAdmin?: boolean;
  /** Used by the HTTP boundary to verify that an edited email keeps its stable Entra identity. */
  identityId?: string;
}

export interface CreateIssueInput {
  /** Optional server-selected stable ID used by idempotent source conversions. */
  id?: string;
  teamId: string;
  quarterId?: string;
  title: string;
  detail?: string;
  priority?: number;
  horizon?: IssueRecord['horizon'];
  raisedById: string;
  ownerId?: string;
  linkedRockId?: string;
  linkedScorecardMetricId?: string;
  linkedScorecardWeekStartDate?: string;
  idsNote?: string;
}

export interface SolveIssueInput {
  createFollowUpTodo: boolean;
  resolutionNote?: string;
}

export interface CreateHeadlineInput {
  teamId: string;
  meetingId?: string;
  type: HeadlineRecord['type'];
  title: string;
  detail?: string;
  issueId?: string;
}

export interface CreateTodoInput {
  teamId: string;
  quarterId?: string;
  title: string;
  notes?: string;
  ownerId: string;
  dueDate: string;
  linkedRockTaskId?: string;
  sourceIssueId?: string;
}

export type SaveVtoInput = VtoContent & Pick<VtoRecord, 'effectiveDate' | 'changeSummary'>;

export interface CreateHistoricalMeetingInput {
  teamId: string;
  quarterId?: string;
  scheduledDate: string;
  scheduledTime: string;
  facilitatorId: string;
  attendeeIds: string[];
  rating?: number;
  recap?: string;
  idsNote?: string;
}

export interface UpdateTodoChecklistItemInput {
  text?: string;
  completed?: boolean;
  supporterId?: string;
}

export type CreateTeamInput = Omit<TeamRecord, keyof WorkspaceRecord | 'teamId' | 'active' | 'memberCount' | 'meetingCadence'> & {
  teamId?: string;
  meetingCadence?: MeetingCadence;
};

export interface WorkspaceRepository {
  readonly environmentId: EnvironmentId;
  getTeamMembership(teamId: string, userId: string): Promise<TeamMembership | null>;
  getLeadershipMembership(userId: string): Promise<TeamMembership | null>;
  getUser(userId: string): Promise<UserProfile | null>;
  getTeams(): Promise<TeamRecord[]>;
  getSessionContext(userId: string): Promise<SessionContext | null>;
  getTeamDashboard(teamId: string, userId?: string): Promise<DashboardSummary>;
  getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace>;
  getWorkspaceSnapshot(userId: string, quarterId?: string): Promise<WorkspaceSnapshot>;
  getVto(teamId: string, userId: string): Promise<VtoDocument>;
  getMeetingReview(userId: string, query?: MeetingReviewQuery): Promise<MeetingReviewPage>;
  getMeeting(teamId: string, meetingId: string, userId: string): Promise<MeetingRecord>;
  getCompanyOverview(userId: string): Promise<CompanyOverview>;
  getNotifications(userId: string): Promise<NotificationRecord[]>;
  markNotificationRead(notificationId: string, userId: string, expectedVersion?: number): Promise<NotificationRecord>;
  getIssue(issueId: string, userId: string): Promise<IssueRecord>;
  getAuditTrail(entityType: AuditEntityType, entityId: string, userId: string): Promise<AuditEventRecord[]>;
  updateRockStatus(rockId: string, status: RockRecord['status'], actorId: string, expectedVersion?: number): Promise<RockRecord>;
  updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number): Promise<RockRecord>;
  updateTodoStatus(todoId: string, status: TodoRecord['status'], actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  updateTodo(todoId: string, input: Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  addTodoChecklistItem(todoId: string, text: string, supporterId: string | undefined, actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  updateTodoChecklistItem(todoId: string, itemId: string, input: UpdateTodoChecklistItemInput, actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  deleteTodoChecklistItem(todoId: string, itemId: string, actorId: string, expectedVersion?: number): Promise<TodoRecord>;
  createScorecardMetric(input: { teamId: string; label: string; target: string; unit: string; ownerId: string }, actorId: string): Promise<ScorecardMetricRecord>;
  updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetricRecord, 'label' | 'target' | 'unit' | 'ownerId'>>, actorId: string, expectedVersion?: number): Promise<ScorecardMetricRecord>;
  upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResultRecord, 'actual' | 'status'>, actorId: string, expectedVersion?: number): Promise<ScorecardResultRecord>;
  createIssue(input: CreateIssueInput, actorId: string): Promise<IssueRecord>;
  createHeadline(input: CreateHeadlineInput, actorId: string): Promise<HeadlineRecord>;
  createIssueFromScorecard(metricId: string, weekStartDate: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  createIssueFromRock(rockId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number): Promise<{ issue: IssueRecord; meeting: MeetingRecord }>;
  updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  startMeeting(teamId: string, meetingId: string, actorId: string, expectedVersion?: number, facilitatorId?: string): Promise<MeetingRecord>;
  startIssue(issueId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  parkIssue(issueId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  solveIssue(issueId: string, input: SolveIssueInput, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  reopenIssue(issueId: string, actorId: string, expectedVersion?: number): Promise<IssueRecord>;
  createRock(input: { teamId: string; quarterId?: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string): Promise<RockRecord>;
  createTodo(input: CreateTodoInput, actorId: string): Promise<TodoRecord>;
  saveVto(teamId: string, input: SaveVtoInput, actorId: string, expectedVersion?: number): Promise<VtoRecord>;
  createHistoricalMeeting(input: CreateHistoricalMeetingInput, actorId: string): Promise<MeetingRecord>;
  createRockTask(input: { rockId: string; title: string; notes?: string; assigneeId: string; assignedAt: string; startDate: string; dueDate: string }, actorId: string): Promise<RockTaskRecord>;
  updateRockTask(taskId: string, input: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number): Promise<RockTaskRecord>;
  deleteRockTask(taskId: string, actorId: string, expectedVersion?: number): Promise<DeleteRockTaskResult>;
  convertRockTaskToTodo(taskId: string, actorId: string): Promise<{ task: RockTaskRecord; todo: TodoRecord }>;
  getIssueTransfer(transferId: string): Promise<IssueTransferRecord>;
  requestIssueTransfer(input: { issueId: string; destinationTeamId: string; requestedById: string; note?: string; idempotencyKey?: string }): Promise<IssueTransferRecord>;
  acceptIssueTransfer(transferId: string, decidedById: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  rejectIssueTransfer(transferId: string, decidedById: string, message: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  cancelIssueTransfer(transferId: string, cancelledById: string, expectedVersion?: number): Promise<IssueTransferRecord>;
  sendTeamMessage(input: { fromTeamId: string; toTeamId: string; subject: string; body: string; senderId: string }): Promise<TeamMessageRecord>;
  markMessageRead(messageId: string, userId: string, expectedVersion?: number): Promise<TeamMessageRecord>;
  createIssueFromMessage(input: { messageId: string; title: string; detail: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string): Promise<IssueRecord>;
  updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note: string, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number, attendeeRatings?: MeetingAttendeeRating[]): Promise<MeetingRecord>;
  getMeetingSummaryJob(teamId: string, meetingId: string, userId: string): Promise<MeetingSummaryJobRecord | null>;
  requestMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  cancelMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number): Promise<MeetingRecord>;
  updateMeetingSummaryDispatch(jobId: string, status: 'generating' | 'failed', error: string | undefined, actorId: string): Promise<MeetingSummaryJobRecord>;
  completeMeetingSummary(jobId: string, status: 'ready' | 'failed', summary: MeetingAiSummary | undefined, error: string | undefined, attempt?: number): Promise<MeetingRecord>;
  getAdminSnapshot(actorId: string): Promise<AdminSnapshot>;
  createTeam(input: CreateTeamInput, actorId: string): Promise<TeamRecord>;
  updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number): Promise<TeamRecord>;
  createUser(input: CreateUserInput, actorId: string): Promise<UserProfile>;
  updateUser(userId: string, input: UpdateUserInput, actorId: string, expectedVersion?: number): Promise<UserProfile>;
  upsertMembership(input: { userId: string; teamId: string; role: TeamMembership['role'] }, actorId: string): Promise<TeamMembership>;
  updateAgeSettings(settings: IssueAgeSettings, actorId: string, expectedVersion?: number): Promise<IssueAgeSettings>;
  updateUserProfile(input: { name?: string; email?: string; avatarDataUrl?: string | null }, actorId: string, expectedVersion?: number): Promise<UserProfile>;
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_IDS_ISSUES = 5;
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

const quarterThemes = ['Make the foundation visible.', 'Create useful momentum.', 'Make Q3 feel lighter.', 'Finish the year with focus.'];

function quarterRecord(year: number, quarter: number): QuarterRecord {
  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(Date.UTC(year, startMonth, 1, 12)).toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, startMonth + 3, 0, 12)).toISOString().slice(0, 10);
  const id = `${year}-q${quarter}`;
  return { ...baseRecord(id, 'quarter'), kind: 'quarter', label: `Q${quarter} ${year}`, theme: quarterThemes[quarter - 1] ?? `Q${quarter} ${year} focus.`, startDate, endDate };
}

function defaultQuarterRecords(reference = new Date()): QuarterRecord[] {
  const date = new Date(reference);
  const currentQuarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const currentIndex = date.getUTCFullYear() * 4 + currentQuarter - 1;
  return [-2, -1, 0, 1, 2].map((offset) => {
    const index = currentIndex + offset;
    const year = Math.floor(index / 4);
    const quarter = (index % 4) + 1;
    return quarterRecord(year, quarter);
  });
}

function emptyVtoContent(teamName: string): VtoContent {
  return {
    coreValues: ['Be useful', 'Be clear', 'Own the outcome'],
    coreFocusPurpose: `Help ${teamName} make meaningful progress.`,
    coreFocusNiche: `${teamName} work that turns priorities into dependable outcomes.`,
    tenYearTarget: `A trusted, high-performing ${teamName} function.`,
    marketingStrategy: { targetMarket: 'Our organisation and its customers.', uniques: ['Practical', 'Clear', 'Accountable'], provenProcess: 'Align · Prioritise · Execute · Review', guarantee: 'Every commitment has a clear owner and next step.' },
    threeYearPicture: { targetDate: '2029-12-31', revenue: 'To be agreed', profit: 'To be agreed', headcount: 'To be agreed', description: `${teamName} is known for dependable delivery and visible traction.` },
    oneYearPlan: { year: new Date().getUTCFullYear(), revenue: 'To be agreed', profit: 'To be agreed', measurables: ['Commitments completed on time'], goals: ['Create a repeatable operating rhythm'] },
    quarterlyRockIds: [],
    issueIds: [],
  };
}

function makeVto(team: TeamRecord, content: VtoContent, versionNumber = 1, kind: 'vto' | 'vtoVersion' = 'vto'): VtoRecord | VtoVersionRecord {
  const id = kind === 'vto' ? `vto-${team.teamId}` : `vto-${team.teamId}-version-${versionNumber}`;
  const record = baseRecord(id, kind, team.teamId, versionNumber);
  const common = { ...record, kind, teamId: team.teamId, ...clone(content), versionNumber, effectiveDate: '2026-07-01', changeSummary: versionNumber === 1 ? 'Initial team V/TO.' : 'Quarterly planning refresh.', savedBy: team.escalationUserIds[0] ?? 'system' };
  return kind === 'vto' ? common as VtoRecord : { ...common, vtoId: `vto-${team.teamId}` } as VtoVersionRecord;
}

function issueAge(issue: IssueRecord, settings: IssueAgeSettings, at = Date.now()): IssueRecord {
  const end = issue.solvedAt ? new Date(issue.solvedAt).getTime() : at;
  const created = new Date(issue.createdAt).getTime();
  const ageInDays = Number.isFinite(created) ? Math.max(0, Math.floor((end - created) / DAY)) : 0;
  return { ...issue, ageInDays, ageBand: issueAgeBand(ageInDays, settings), meetingBand: issueMeetingBand(issue.meetingsPassed ?? 0, issue.status) };
}

function emptyDashboard(teamId: string): DashboardSummary {
  return {
    teamId,
    rocks: { total: 0, onTrack: 0, offTrack: 0, complete: 0 },
    todos: { total: 0, done: 0, open: 0, notDone: 0 },
    issues: { total: 0, open: 0, inIds: 0, solved: 0, neutral: 0, green: 0, yellow: 0, orange: 0, red: 0 },
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
    dashboard.issues[issue.meetingBand ?? issueMeetingBand(issue.meetingsPassed ?? 0, issue.status)] += 1;
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

function elapsedSeconds(startedAt: string | undefined, endedAt: string) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

function finalizeMeetingTiming(meeting: MeetingRecord, endedAt: string) {
  const section = meeting.activeSection;
  const sectionStartedAt = meeting.activeSectionStartedAt ?? meeting.startedAt;
  if (section && sectionStartedAt) {
    const duration = elapsedSeconds(sectionStartedAt, endedAt);
    meeting.sectionDurations = { ...(meeting.sectionDurations ?? {}), [section]: (meeting.sectionDurations?.[section] ?? 0) + duration };
  }
  meeting.durationSeconds = elapsedSeconds(meeting.startedAt, endedAt);
  meeting.activeSectionStartedAt = undefined;
}

function assertText(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new RepositoryError('VALIDATION', `${field} is required.`);
}

function normalizedTextArray(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Array.isArray(value)) throw new RepositoryError('VALIDATION', `${field} must be a list.`);
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (items.length < minimum || items.length > maximum || items.some((item) => !item)) throw new RepositoryError('VALIDATION', `${field} must contain between ${minimum} and ${maximum} non-empty entries.`);
  return items;
}

function normalizeVtoInput(input: SaveVtoInput): SaveVtoInput {
  if (!input || typeof input !== 'object') throw new RepositoryError('VALIDATION', 'V/TO content is required.');
  const strategy = input.marketingStrategy ?? {} as SaveVtoInput['marketingStrategy'];
  const picture = input.threeYearPicture ?? {} as SaveVtoInput['threeYearPicture'];
  const plan = input.oneYearPlan ?? {} as SaveVtoInput['oneYearPlan'];
  const coreValues = normalizedTextArray(input.coreValues, 'Core Values', 3, 7);
  const uniques = normalizedTextArray(strategy?.uniques, 'Three Uniques', 3, 3);
  const measurables = normalizedTextArray(plan?.measurables, 'One-Year Measurables', 1, 7);
  const goals = normalizedTextArray(plan?.goals, 'One-Year Goals', 1, 7);
  assertText(input.coreFocusPurpose, 'Core Focus purpose');
  assertText(input.coreFocusNiche, 'Core Focus niche');
  assertText(input.tenYearTarget, '10-Year Target');
  assertText(strategy?.targetMarket, 'Target Market');
  assertText(strategy?.provenProcess, 'Proven Process');
  assertText(strategy?.guarantee, 'Guarantee');
  assertText(picture?.targetDate, '3-Year Picture target date');
  assertDate(picture.targetDate, '3-Year Picture target date');
  assertText(picture?.revenue, '3-Year Picture revenue');
  assertText(picture?.profit, '3-Year Picture profit');
  assertText(picture?.headcount, '3-Year Picture headcount');
  assertText(picture?.description, '3-Year Picture description');
  if (!Number.isInteger(plan?.year) || plan.year < 2000 || plan.year > 9999) throw new RepositoryError('VALIDATION', 'One-Year Plan year must be a four-digit year.');
  assertText(plan.revenue, 'One-Year Plan revenue');
  assertText(plan.profit, 'One-Year Plan profit');
  assertText(input.effectiveDate, 'V/TO effective date');
  assertDate(input.effectiveDate, 'V/TO effective date');
  assertText(input.changeSummary, 'V/TO change summary');
  if (!Array.isArray(input.quarterlyRockIds) || input.quarterlyRockIds.length > 7 || input.quarterlyRockIds.some((id) => typeof id !== 'string' || !id.trim())) throw new RepositoryError('VALIDATION', 'Quarterly Rocks must contain no more than seven valid Rock IDs.');
  if (!Array.isArray(input.issueIds) || input.issueIds.length > 50 || input.issueIds.some((id) => typeof id !== 'string' || !id.trim())) throw new RepositoryError('VALIDATION', 'Issues List must contain valid Issue IDs.');
  return {
    coreValues,
    coreFocusPurpose: input.coreFocusPurpose.trim(),
    coreFocusNiche: input.coreFocusNiche.trim(),
    tenYearTarget: input.tenYearTarget.trim(),
    marketingStrategy: { targetMarket: strategy.targetMarket.trim(), uniques, provenProcess: strategy.provenProcess.trim(), guarantee: strategy.guarantee.trim() },
    threeYearPicture: { targetDate: picture.targetDate.trim(), revenue: picture.revenue.trim(), profit: picture.profit.trim(), headcount: picture.headcount.trim(), description: picture.description.trim() },
    oneYearPlan: { year: plan.year, revenue: plan.revenue.trim(), profit: plan.profit.trim(), measurables, goals },
    quarterlyRockIds: [...new Set(input.quarterlyRockIds.map((id) => id.trim()))],
    issueIds: [...new Set(input.issueIds.map((id) => id.trim()))],
    effectiveDate: input.effectiveDate.trim(),
    changeSummary: input.changeSummary.trim(),
  };
}

function normalizeDate(value: string, field: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || new Date(`${normalized}T12:00:00Z`).toISOString().slice(0, 10) !== normalized) throw new Error('Invalid date.');
  } catch {
    throw new RepositoryError('VALIDATION', `${field} must be a valid date.`);
  }
  return normalized;
}

function assertDate(value: string, field: string) {
  normalizeDate(value, field);
}

function assertMeetingCadence(value: MeetingCadence | undefined) {
  if (value !== undefined && value !== 'weekly' && value !== 'monthly') throw new RepositoryError('VALIDATION', 'Meeting cadence must be weekly or monthly.');
}

const weekdayOffsets: Record<string, number> = { sunday: 6, monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5 };

function assertMeetingConfiguration(cadence: MeetingCadence, meetingDay: string, meetingTime: string) {
  assertText(meetingDay, cadence === 'monthly' ? 'Meeting date' : 'Meeting day');
  assertText(meetingTime, 'Meeting time');
  const normalizedDay = meetingDay.trim().toLowerCase();
  if (cadence === 'monthly' && !/^(?:[1-9]|[12]\d|3[01])$/.test(normalizedDay)) throw new RepositoryError('VALIDATION', 'Monthly meeting date must be a day number from 1 to 31.');
  if (cadence === 'weekly' && weekdayOffsets[normalizedDay] === undefined) throw new RepositoryError('VALIDATION', 'Weekly meeting day must be Sunday through Saturday.');
}

function validateMeetingSections(sections: readonly MeetingSectionConfig[] | undefined) {
  if (sections === undefined) return normalizeMeetingSections();
  if (!Array.isArray(sections) || sections.length !== DEFAULT_MEETING_SECTIONS.length) throw new RepositoryError('VALIDATION', 'L10 configuration must include each supported section exactly once.');
  const supportedIds = new Set(DEFAULT_MEETING_SECTIONS.map((section) => section.id));
  const seen = new Set<MeetingSectionConfig['id']>();
  for (const section of sections) {
    if (!section || !supportedIds.has(section.id) || seen.has(section.id)) throw new RepositoryError('VALIDATION', 'L10 configuration must include each supported section exactly once.');
    if (typeof section.label !== 'string' || !section.label.trim()) throw new RepositoryError('VALIDATION', 'Every L10 section needs a label.');
    if (typeof section.enabled !== 'boolean') throw new RepositoryError('VALIDATION', 'Every L10 section must specify whether it is enabled.');
    if (!Number.isInteger(section.duration) || section.duration < 1 || section.duration > 180) throw new RepositoryError('VALIDATION', 'Meeting section durations must be whole minutes between 1 and 180.');
    seen.add(section.id);
  }
  if (!DEFAULT_MEETING_SECTIONS.every((section) => seen.has(section.id))) throw new RepositoryError('VALIDATION', 'L10 configuration must include each supported section exactly once.');
  if (!sections.some((section) => section.id === 'ids' && section.enabled) || !sections.some((section) => section.id === 'conclude' && section.enabled)) throw new RepositoryError('VALIDATION', 'IDS and Conclude must remain enabled for every L10.');
  return sections.map((section) => ({ id: section.id, label: section.label.trim(), enabled: section.enabled, duration: section.duration }));
}

function assertFutureMeetingSchedule(scheduledDate: string, scheduledTime: string) {
  const timestamp = meetingScheduledAt({ scheduledDate, scheduledTime });
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new RepositoryError('VALIDATION', 'A rescheduled meeting must be in the future with a valid time.');
}

function meetingDateFor(team: Pick<TeamRecord, 'meetingCadence' | 'meetingDay'>, value: string | Date = new Date()) {
  const current = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(current.getTime())) return new Date().toISOString().slice(0, 10);
  if ((team.meetingCadence ?? 'weekly') === 'monthly') {
    const requestedDay = Number.parseInt(team.meetingDay.trim(), 10);
    if (Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= 31) {
      const lastDay = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
      current.setUTCDate(Math.min(requestedDay, lastDay));
    }
    return current.toISOString().slice(0, 10);
  }
  const weekStart = new Date(`${weekStartDateFor(current)}T12:00:00Z`);
  const offset = weekdayOffsets[team.meetingDay.trim().toLowerCase()];
  weekStart.setUTCDate(weekStart.getUTCDate() + (offset ?? 0));
  return weekStart.toISOString().slice(0, 10);
}

function meetingDateLabel(scheduledDate: string) {
  return new Date(`${scheduledDate}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(', ', ' · ');
}

function normalizedMeeting(team: TeamRecord | undefined, meeting: MeetingRecord): MeetingRecord {
  const fallbackTeam = team ?? { meetingCadence: 'weekly' as const, meetingDay: 'Monday', meetingTime: '9:00 AM' };
  let scheduledDate = meeting.scheduledDate;
  try {
    if (!scheduledDate) scheduledDate = meetingDateFor(fallbackTeam, meeting.weekStartDate ?? new Date());
    assertDate(scheduledDate, 'Meeting date');
  } catch {
    scheduledDate = meetingDateFor(fallbackTeam, meeting.weekStartDate ?? new Date());
  }
  const scheduledTime = meeting.scheduledTime?.trim() || fallbackTeam.meetingTime || '9:00 AM';
  return {
    ...meeting,
    scheduledDate,
    scheduledTime,
    recurrenceDate: meeting.recurrenceDate ?? scheduledDate,
    dateLabel: meetingDateLabel(scheduledDate),
    weekStartDate: weekStartDateFor(scheduledDate),
    sectionNotes: Object.fromEntries(Object.entries(meeting.sectionNotes ?? {}).map(([section, note]) => [section, sanitizeRichText(note)])),
    sectionDurations: meeting.sectionDurations ?? {},
    attendeeRatings: meeting.attendeeRatings ?? [],
    idsIssueIds: meeting.idsIssueIds ?? [],
    idsAddedIssueIds: meeting.idsAddedIssueIds ?? [],
    createdTodoIds: meeting.createdTodoIds ?? [],
    idsNotes: meeting.idsNotes ?? [],
    version: meeting.version ?? 1,
  };
}

function historicalTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function appendHistoricalNote(current: string | undefined, at: string, note: string) {
  const timestamp = sanitizeRichText(`<p><strong>[${historicalTimestamp(at)}]</strong></p>`);
  const entry = `${timestamp}${sanitizeRichText(note)}`;
  const previous = sanitizeRichText(current);
  return previous ? `${previous}${entry}` : entry;
}

function meetingHeadlinesFor(headlines: HeadlineRecord[], meeting: MeetingRecord) {
  return headlines.filter((headline) => headline.teamId === meeting.teamId && (!headline.meetingId || headline.meetingId === meeting.id));
}

function milestoneCountsFor(rockId: string, tasks: RockTaskRecord[]) {
  const milestones = tasks.filter((task) => task.rockId === rockId);
  const completed = milestones.filter((task) => task.status === 'done').length;
  return { completed, remaining: milestones.length - completed };
}

function meetingRecap(team: TeamRecord, meeting: MeetingRecord, rocks: RockRecord[], tasks: RockTaskRecord[], todos: TodoRecord[], issues: IssueRecord[], manualNotes: string, metrics: ScorecardMetricRecord[] = [], results: ScorecardResultRecord[] = [], headlines: HeadlineRecord[] = []) {
  const ids = meeting.idsIssueIds.map((id) => issues.find((issue) => issue.id === id)).filter((issue): issue is IssueRecord => Boolean(issue));
  const lines = [`${team.name} L10 recap · ${meeting.dateLabel} · week of ${meeting.weekStartDate}`, ''];
  lines.push(`Facilitator ID: ${meeting.facilitatorId}`);
  if (meeting.durationSeconds !== undefined) lines.push(`Meeting duration: ${Math.floor(meeting.durationSeconds / 60)}m ${meeting.durationSeconds % 60}s`);
  if (meeting.attendeeRatings?.length) lines.push(`Meeting rating: ${meeting.lastRating}/10 average · Attendee ratings: ${meeting.attendeeRatings.map((entry) => `${entry.attendeeId} ${entry.rating}/10`).join('; ')}`);
  lines.push('');
  for (const [section, note] of Object.entries(meeting.sectionNotes)) {
    const plainNote = richTextToPlainText(note);
    if (plainNote) lines.push(`${section}: ${plainNote}`);
  }
  if (meetingSectionsFor(team).some((section) => section.id === 'scorecard')) {
    const weekly = metrics.filter((metric) => metric.teamId === team.teamId).map((metric) => ({ metric, result: results.find((result) => result.metricId === metric.id && result.weekStartDate === meeting.weekStartDate) }));
    const offTrack = weekly.filter(({ result }) => result?.status === 'off-track').map(({ metric, result }) => `${metric.label} (${result?.actual ?? 'Not entered'})`);
    const missing = weekly.filter(({ result }) => !result).map(({ metric }) => metric.label);
    lines.push(`Scorecard: ${offTrack.length ? `off-track — ${offTrack.join(', ')}` : missing.length ? `not entered — ${missing.join(', ')}` : 'all visible measurables on track.'}`);
  }
  lines.push(`Rock Review: ${rocks.length ? rocks.map((rock) => { const milestones = milestoneCountsFor(rock.id, tasks); return `${rock.title} (${milestones.completed} completed · ${milestones.remaining} remaining · ${rock.status})`; }).join('; ') : 'no Rocks recorded.'}`);
  const meetingHeadlines = meetingHeadlinesFor(headlines, meeting);
  lines.push(`Headlines: ${meetingHeadlines.length ? meetingHeadlines.map((headline) => headline.title).join('; ') : 'none recorded.'}`);
  lines.push(`To-Do Review: ${todos.length ? todos.map((todo) => `${todo.title} — ${todo.status} · due ${todo.dueDate}`).join('; ') : 'no To-Dos recorded.'}`);
  lines.push(`IDS: ${ids.length ? ids.map((issue) => `${issue.title} — ${issue.status}${issue.idsNote ? ` · ${richTextToPlainText(issue.idsNote).split('\n').at(-1)}` : ''}`).join('; ') : 'no Issues entered into IDS.'}`);
  const actions = meeting.actionSummary ?? meetingActionSummary(meeting, issues);
  lines.push(`Actions: ${actions.todosCreated} To-Dos created · ${actions.issuesReviewedInIds} Issues reviewed in IDS · ${actions.issuesAddedToIds} Issues added to IDS · ${actions.issuesSolved} Issues solved.`);
  if (meeting.createdTodoIds.length) lines.push(`Created To-Dos: ${meeting.createdTodoIds.map((id) => todos.find((todo) => todo.id === id)?.title ?? id).join('; ')}`);
  if (meeting.idsNotes.length) lines.push(`Meeting IDS notes: ${meeting.idsNotes.map((note) => richTextToPlainText(note.note)).join(' | ')}`);
  if (manualNotes.trim()) lines.push(`Facilitator notes: ${manualNotes.trim()}`);
  return lines.join('\n');
}

function meetingSummaryContext(team: TeamRecord, meeting: MeetingRecord, rocks: RockRecord[], tasks: RockTaskRecord[], todos: TodoRecord[], issues: IssueRecord[], metrics: ScorecardMetricRecord[], results: ScorecardResultRecord[], headlines: Array<{ title: string; type: 'win' | 'concern'; detail: string }> = []): MeetingSummaryContext {
  return {
    meetingId: meeting.id,
    teamId: team.teamId,
    label: meeting.label,
    scheduledDate: meeting.scheduledDate,
    scheduledTime: meeting.scheduledTime,
    facilitatorId: meeting.facilitatorId,
    startedAt: meeting.startedAt,
    closedAt: meeting.closedAt ?? meeting.updatedAt,
    durationSeconds: meeting.durationSeconds,
    sectionDurations: clone(meeting.sectionDurations ?? {}),
    attendeeIds: [...meeting.attendeeIds],
    attendeeRatings: meeting.attendeeRatings ? clone(meeting.attendeeRatings) : undefined,
    recap: meeting.recap,
    sectionNotes: clone(meeting.sectionNotes),
    idsNotes: clone(meeting.idsNotes),
    actionSummary: meeting.actionSummary ? clone(meeting.actionSummary) : undefined,
    rocks: rocks.map(({ id, title, status, dueDate }) => { const milestones = milestoneCountsFor(id, tasks); return { id, title, status, completedMilestones: milestones.completed, remainingMilestones: milestones.remaining, dueDate }; }),
    todos: todos.map(({ id, title, status, ownerId, dueDate }) => ({ id, title, status, ownerId, dueDate })),
    issues: issues.map(({ id, title, status, idsNote }) => ({ id, title, status, idsNote })),
    headlines: headlines.map(({ title, type, detail }) => ({ title, type, detail })),
    scorecard: metrics.map((metric) => {
      const result = results.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === meeting.weekStartDate);
      return { label: metric.label, target: metric.target, actual: result?.actual, status: result?.status };
    }),
  };
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
    meetingCadence: input.meetingCadence ?? 'weekly',
    meetingDay: input.meetingDay ?? 'Monday',
    meetingTime: input.meetingTime ?? '9:00 AM',
    accent: input.accent ?? '#4c8f86',
    initials: input.initials ?? input.shortName.slice(0, 2).toUpperCase(),
    meetingSections: clone(normalizeMeetingSections(input.meetingSections)),
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

function makeRock(input: { id: string; teamId: string; quarterId?: string; title: string; ownerId: string; status?: RockRecord['status']; dueDate?: string; priority?: RockRecord['priority'] }): RockRecord {
  return { ...baseRecord(input.id, 'rock', input.teamId), kind: 'rock', teamId: input.teamId, quarterId: input.quarterId ?? '2026-q3', title: input.title, description: '', notes: '', ownerId: input.ownerId, status: input.status ?? 'on-track', dueDate: input.dueDate ?? '2026-09-30', priority: input.priority ?? 'medium' };
}

function makeTodo(input: { id: string; teamId: string; quarterId?: string; title: string; ownerId: string; status?: TodoRecord['status']; dueDate?: string; linkedRockTaskId?: string; sourceIssueId?: string }): TodoRecord {
  return { ...baseRecord(input.id, 'todo', input.teamId), kind: 'todo', teamId: input.teamId, quarterId: input.quarterId ?? '2026-q3', title: input.title, notes: '', ownerId: input.ownerId, dueDate: input.dueDate ?? '2026-09-05', status: input.status ?? 'open', origin: 'Team workspace', linkedRockTaskId: input.linkedRockTaskId, sourceIssueId: input.sourceIssueId, checklist: [], carryForwardCount: 0, flagged: false };
}

function makeScorecardMetric(input: { id: string; teamId: string; label: string; target: string; unit: string; ownerId: string }): ScorecardMetricRecord {
  return { ...baseRecord(input.id, 'scorecardMetric', input.teamId), kind: 'scorecardMetric', teamId: input.teamId, label: input.label, target: input.target, unit: input.unit, ownerId: input.ownerId };
}

function makeScorecardResult(input: { id: string; metricId: string; teamId: string; weekStartDate: string; actual: string; status: ScorecardResultRecord['status']; priorActual?: string }): ScorecardResultRecord {
  return { ...baseRecord(input.id, 'scorecardResult', input.teamId), kind: 'scorecardResult', teamId: input.teamId, metricId: input.metricId, weekStartDate: input.weekStartDate, actual: input.actual, status: input.status, ...scorecardTrendFor(input.actual, input.priorActual) };
}

function makeIssue(input: { id: string; teamId: string; quarterId?: string; title: string; raisedById: string; ageInDays: number; horizon?: IssueRecord['horizon']; assignmentState?: IssueRecord['assignmentState']; currentTeamId?: string | null; status?: IssueRecord['status']; ownerId?: string }): IssueRecord {
  const record = baseRecord(input.id, 'issue', input.teamId);
  const createdAt = daysAgo(input.ageInDays);
  const status = input.status ?? 'open';
  return { ...record, kind: 'issue', teamId: input.teamId, quarterId: input.quarterId ?? '2026-q3', sourceTeamId: input.teamId, currentTeamId: input.currentTeamId === undefined ? input.teamId : input.currentTeamId, title: input.title, detail: '', priority: 1, status, horizon: input.horizon ?? 'short-term', assignmentState: input.assignmentState ?? 'assigned', raisedById: input.raisedById, ownerId: input.ownerId ?? input.raisedById, ageInDays: input.ageInDays, ageBand: issueAgeBand(input.ageInDays), meetingsPassed: 0, meetingBand: issueMeetingBand(0, status), escalationState: 'not-scheduled', escalationLevel: 0, createdAt, updatedAt: createdAt, updatedBy: input.raisedById, version: 1 };
}

function makeHeadline(input: { id: string; teamId: string; quarterId?: string; meetingId?: string; authorId: string; type: HeadlineRecord['type']; title: string; detail: string; issueId?: string; createdAt?: string }): HeadlineRecord {
  const record = baseRecord(input.id, 'headline');
  const createdAt = input.createdAt ?? record.createdAt;
  return { ...record, kind: 'headline', teamId: input.teamId, quarterId: input.quarterId, meetingId: input.meetingId, authorId: input.authorId, type: input.type, title: input.title, detail: input.detail, issueId: input.issueId, createdAt, updatedAt: createdAt, updatedBy: input.authorId };
}

function meetingActionSummary(meeting: MeetingRecord, issues: IssueRecord[]): MeetingActionSummary {
  return {
    todosCreated: meeting.createdTodoIds.length,
    issuesReviewedInIds: meeting.idsIssueIds.length,
    issuesAddedToIds: meeting.idsAddedIssueIds.length,
    issuesSolved: meeting.idsIssueIds.filter((issueId) => issues.find((issue) => issue.id === issueId)?.status === 'solved').length,
  };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly environmentId: EnvironmentId;
  protected quarters: QuarterRecord[];
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
  protected headlines: HeadlineRecord[];
  protected meetings: MeetingRecord[];
  protected summaryJobs: MeetingSummaryJobRecord[];
  protected metrics: ScorecardMetricRecord[];
  protected scorecardResults: ScorecardResultRecord[];
  protected vtos: VtoRecord[];
  protected vtoVersions: VtoVersionRecord[];
  protected audit: AuditEventRecord[];
  protected settings: IssueAgeSettings;
  protected settingsVersion = 1;

  constructor(environmentId: EnvironmentId = 'live') {
    this.environmentId = environmentId;
    this.quarters = defaultQuarterRecords();
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
      makeRock({ id: 'rock-project-kickoff', teamId: 'projects', title: 'Standardise the implementation kickoff', ownerId: 'marcus-lee', priority: 'high' }),
      makeRock({ id: 'rock-cyber-readiness', teamId: 'cybersecurity', title: 'Close the security evidence gaps', ownerId: 'priya-shah', status: 'off-track', priority: 'high' }),
      makeRock({ id: 'rock-service-health', teamId: 'service-development', title: 'Release the service health playbook', ownerId: 'maria-ortiz', priority: 'medium' }),
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
    this.vtos = [];
    this.vtoVersions = [];
    for (const team of this.teams.filter((candidate) => candidate.nodeType === 'operational')) {
      const content = emptyVtoContent(team.name);
      content.quarterlyRockIds = this.rocks.filter((rock) => rock.teamId === team.teamId && rock.quarterId === '2026-q3').map((rock) => rock.id);
      content.issueIds = this.issues.filter((issue) => issue.teamId === team.teamId && issue.assignmentState !== 'redirected').map((issue) => issue.id);
      const firstVersion = makeVto(team, content, 1, 'vtoVersion') as VtoVersionRecord;
      const current = makeVto(team, content, 2, 'vto') as VtoRecord;
      const secondVersion = makeVto(team, content, 2, 'vtoVersion') as VtoVersionRecord;
      this.vtos.push(current);
      this.vtoVersions.push(firstVersion, secondVersion);
    }
    this.transfers = [{
      ...baseRecord('transfer-projects-leadership', 'issueTransfer'), kind: 'issueTransfer', issueId: 'issue-transfer-pending', sourceTeamId: 'projects', destinationTeamId: 'leadership', requestedById: 'marcus-lee', requestedAt: daysAgo(2), status: 'pending', note: 'Confirm the right receiving team.', sourceIssueVersion: 1, version: 1,
    }];
    this.notifications = [{
      ...baseRecord('notification-ava-transfer', 'notification'), kind: 'notification', recipientUserId: 'ava-khan', type: 'issue-transfer-requested', title: 'Issue transferred to Leadership', message: 'Projects sent an Issue to Leadership. Accept or reject the handoff before the next L10.', issueId: 'issue-transfer-pending', transferId: 'transfer-projects-leadership', teamId: 'leadership',
    }];
    this.messages = [{
      ...baseRecord('message-projects-kickoff', 'message'), kind: 'message', fromTeamId: 'projects', toTeamId: 'leadership', senderId: 'marcus-lee', subject: 'Security review needed for the next kickoff', body: 'Projects has a proposed kickoff change that needs a security owner before the customer session.', status: 'unread', updatedBy: 'marcus-lee',
    }];
    this.headlines = [
      makeHeadline({ id: 'headline-win', teamId: 'leadership', authorId: 'ava-khan', type: 'win', title: 'The onboarding pilot has a clear first customer', detail: 'Projects and Service Delivery agreed on the first customer to take through the pilot.', createdAt: daysAgo(1) }),
      makeHeadline({ id: 'headline-risk', teamId: 'cybersecurity', authorId: 'priya-shah', type: 'concern', title: 'A customer assurance request needs an owner', detail: 'The request is time-sensitive and needs a named owner before the customer session.', issueId: 'issue-cyber-owners', createdAt: daysAgo(2) }),
    ];
    this.meetings = this.teams.filter((team) => team.nodeType === 'operational').map((team) => {
      const issueIds = this.issues.filter((issue) => issue.teamId === team.teamId && issue.horizon === 'short-term' && issue.assignmentState !== 'redirected').map((issue) => issue.id);
      const sections = meetingSectionsFor(team);
      const scheduledDate = meetingDateFor(team);
      return { ...baseRecord(`meeting-${team.teamId}-current`, 'meeting', team.teamId), kind: 'meeting', teamId: team.teamId, label: `${team.shortName} L10`, dateLabel: meetingDateLabel(scheduledDate), scheduledDate, scheduledTime: team.meetingTime, weekStartDate: weekStartDateFor(scheduledDate), status: 'upcoming', facilitatorId: team.escalationUserIds[0] ?? 'ava-khan', attendeeIds: this.memberships.filter((membership) => membership.teamId === team.teamId && membership.active).map((membership) => membership.userId), lastRating: 0, agendaProgress: 0, agendaTotal: sections.length, idsSolved: 0, idsTotal: issueIds.length, recap: '', sectionNotes: {}, idsIssueIds: [], idsAddedIssueIds: [], createdTodoIds: [], idsNotes: [] } satisfies MeetingRecord;
    });
    this.summaryJobs = [];
    const currentWeekStartDate = weekStartDateFor(new Date());
    const previousWeekStartDate = weekStartDateFor(new Date(new Date(currentWeekStartDate).getTime() - 7 * DAY));
    this.metrics = [
      makeScorecardMetric({ id: 'metric-leadership-pipeline', teamId: 'leadership', label: 'Qualified pipeline created', target: '18', unit: 'opportunities', ownerId: 'ava-khan' }),
      makeScorecardMetric({ id: 'metric-project-kickoffs', teamId: 'projects', label: 'Projects kicked off on time', target: '90%', unit: 'on-time', ownerId: 'marcus-lee' }),
      makeScorecardMetric({ id: 'metric-service-health', teamId: 'service-development', label: 'Customer health checks', target: '15', unit: 'checks', ownerId: 'maria-ortiz' }),
      makeScorecardMetric({ id: 'metric-service-incidents', teamId: 'service-delivery', label: 'Critical incidents', target: '< 2', unit: 'incidents', ownerId: 'jon-bell' }),
      makeScorecardMetric({ id: 'metric-cyber-evidence', teamId: 'cybersecurity', label: 'Evidence requests assigned', target: '100%', unit: 'assigned', ownerId: 'priya-shah' }),
    ];
    this.scorecardResults = [
      makeScorecardResult({ id: 'result-metric-leadership-pipeline-previous', metricId: 'metric-leadership-pipeline', teamId: 'leadership', weekStartDate: previousWeekStartDate, actual: '18', status: 'on-track' }),
      makeScorecardResult({ id: 'result-metric-leadership-pipeline-current', metricId: 'metric-leadership-pipeline', teamId: 'leadership', weekStartDate: currentWeekStartDate, actual: '21', status: 'on-track', priorActual: '18' }),
      makeScorecardResult({ id: 'result-metric-project-kickoffs-previous', metricId: 'metric-project-kickoffs', teamId: 'projects', weekStartDate: previousWeekStartDate, actual: '88%', status: 'off-track' }),
      makeScorecardResult({ id: 'result-metric-project-kickoffs-current', metricId: 'metric-project-kickoffs', teamId: 'projects', weekStartDate: currentWeekStartDate, actual: '94%', status: 'on-track', priorActual: '88%' }),
      makeScorecardResult({ id: 'result-metric-service-health-previous', metricId: 'metric-service-health', teamId: 'service-development', weekStartDate: previousWeekStartDate, actual: '13', status: 'off-track' }),
      makeScorecardResult({ id: 'result-metric-service-health-current', metricId: 'metric-service-health', teamId: 'service-development', weekStartDate: currentWeekStartDate, actual: '17', status: 'on-track', priorActual: '13' }),
      makeScorecardResult({ id: 'result-metric-service-incidents-previous', metricId: 'metric-service-incidents', teamId: 'service-delivery', weekStartDate: previousWeekStartDate, actual: '1', status: 'on-track' }),
      makeScorecardResult({ id: 'result-metric-service-incidents-current', metricId: 'metric-service-incidents', teamId: 'service-delivery', weekStartDate: currentWeekStartDate, actual: '1', status: 'on-track', priorActual: '1' }),
      makeScorecardResult({ id: 'result-metric-cyber-evidence-current', metricId: 'metric-cyber-evidence', teamId: 'cybersecurity', weekStartDate: currentWeekStartDate, actual: '72%', status: 'off-track', priorActual: '80%' }),
    ];
    this.settings = clone(DEFAULT_ISSUE_AGE_SETTINGS);
    this.audit = [{
      ...baseRecord('audit-seed', 'auditEvent'), kind: 'auditEvent', actorId: 'ava-khan', action: 'Created workspace hierarchy', target: ORG_ID, detail: 'Seeded the Leadership, Professional Services, and Managed Services structure.', eventType: 'team',
    }];
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    this.refreshDerivedState();
  }

  protected refreshDerivedState() {
    this.teams = this.teams.map((team) => ({ ...team, meetingCadence: team.meetingCadence ?? 'weekly', meetingSections: team.meetingSections?.length ? team.meetingSections : clone(DEFAULT_MEETING_SECTIONS), escalationUserIds: team.escalationUserIds ?? [] }));
    this.rocks = this.rocks.map((rock) => ({ ...rock, notes: sanitizeRichText(rock.notes) }));
    this.todos = this.todos.map((todo) => ({
      ...todo,
      quarterId: todo.quarterId ?? quarterIdForDate(todo.dueDate, this.quarters),
      notes: sanitizeTodoNotes(todo.notes),
      checklist: Array.isArray(todo.checklist)
        ? todo.checklist
          .map((item, index) => ({
            id: item.id || `checklist-${todo.id}-${index + 1}`,
            text: typeof item.text === 'string' ? item.text.trim() : '',
            completed: item.completed === true,
            supporterId: item.supporterId && this.user(item.supporterId) && this.membership(todo.teamId, item.supporterId) ? item.supporterId : todo.ownerId,
            createdAt: item.createdAt || todo.createdAt,
            updatedAt: item.updatedAt || todo.updatedAt,
          }))
          .filter((item) => item.text)
        : [],
      carryForwardCount: todo.carryForwardCount ?? 0,
      flagged: todo.flagged ?? false,
    }));
    this.issues = this.issues.map((issue) => ({ ...issue, quarterId: issue.quarterId ?? quarterIdForDate(issue.createdAt, this.quarters), detail: sanitizeRichText(issue.detail), idsNote: issue.idsNote ? sanitizeRichText(issue.idsNote) : undefined, meetingsPassed: issue.meetingsPassed ?? 0, meetingBand: issueMeetingBand(issue.meetingsPassed ?? 0, issue.status), escalationState: issue.escalationState ?? 'not-scheduled', escalationLevel: issue.escalationLevel ?? 0 }));
    this.headlines = this.headlines.map((headline) => ({ ...headline, quarterId: headline.quarterId ?? quarterIdForDate(headline.createdAt, this.quarters), title: typeof headline.title === 'string' ? headline.title.trim() : '', detail: typeof headline.detail === 'string' ? sanitizeRichText(headline.detail) : '' })).filter((headline) => headline.teamId && headline.title && (headline.type === 'win' || headline.type === 'concern'));
    this.meetings = this.meetings.map((meeting) => normalizedMeeting(this.team(meeting.teamId) ?? undefined, { ...meeting, quarterId: meeting.quarterId ?? quarterIdForDate(meeting.scheduledDate, this.quarters), sectionNotes: Object.fromEntries(Object.entries(meeting.sectionNotes ?? {}).map(([section, note]) => [section, sanitizeRichText(note)])), idsIssueIds: meeting.idsIssueIds ?? [], idsAddedIssueIds: meeting.idsAddedIssueIds ?? [], createdTodoIds: meeting.createdTodoIds ?? [], idsNotes: (meeting.idsNotes ?? []).map((note) => ({ ...note, note: sanitizeRichText(note.note) })), agendaTotal: meetingSectionsFor(this.team(meeting.teamId) ?? { meetingSections: DEFAULT_MEETING_SECTIONS }).length }));
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

  protected requireChecklistSupporter(teamId: string, userId: string) {
    if (!this.user(userId) || !this.membership(teamId, userId)) throw new RepositoryError('VALIDATION', 'Checklist supporter must be an active member of the To-Do team.');
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
    return this.visibleTeamIds(userId).has(teamId);
  }

  protected canManageMeetingSummary(teamId: string, userId: string) {
    const membership = this.membership(teamId, userId);
    return Boolean(membership && canWriteTeam(membership.role));
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

  protected auditTarget(entityType: AuditEntityType, entityId: string): WorkspaceRecord & { teamId: string } {
    const target = entityType === 'rock'
      ? this.rocks.find((rock) => rock.id === entityId)
      : entityType === 'todo'
        ? this.todos.find((todo) => todo.id === entityId)
        : entityType === 'issue'
          ? this.activeIssue(entityId)
          : undefined;
    if (!target) throw new RepositoryError('NOT_FOUND', `${entityType[0].toUpperCase()}${entityType.slice(1)} not found.`);
    return target;
  }

  protected auditEventTypes(entityType: AuditEntityType): AuditEventRecord['eventType'][] {
    return entityType === 'issue' ? ['issue', 'transfer', 'meeting'] : [entityType];
  }

  protected getDescendantIds(teamId: string): string[] {
    const children = this.teams.filter((team) => team.parentTeamId === teamId && team.active).map((team) => team.teamId);
    return children.flatMap((child) => [child, ...this.getDescendantIds(child)]);
  }

  protected visibleTeamIds(userId: string) {
    const memberships = this.memberships.filter((membership) => membership.userId === userId && membership.active);
    const teamIds = new Set(memberships.flatMap((membership) => [membership.teamId, ...(membership.role === 'TeamLead' || membership.role === 'OrgAdmin' ? this.getDescendantIds(membership.teamId) : [])]));
    if (memberships.some((membership) => membership.teamId === 'leadership')) this.teams.filter((team) => team.active).forEach((team) => teamIds.add(team.teamId));
    return teamIds;
  }

  protected resolveQuarterId(requestedQuarterId: string | undefined, associatedDate: string | Date = new Date()) {
    const resolved = requestedQuarterId ?? quarterIdForDate(associatedDate, this.quarters);
    if (!resolved || !this.quarters.some((quarter) => quarter.id === resolved)) throw new RepositoryError('VALIDATION', 'Choose a valid quarter.');
    return resolved;
  }

  protected createUpcomingMeeting(team: TeamRecord, scheduledDate: string, template?: MeetingRecord, idsIssueIds: string[] = []): MeetingRecord {
    const sections = meetingSectionsFor(team);
    return {
      ...baseRecord(generatedId('meeting'), 'meeting', team.teamId),
      kind: 'meeting',
      teamId: team.teamId,
      quarterId: quarterIdForDate(scheduledDate, this.quarters),
      label: `${team.shortName} L10`,
      dateLabel: meetingDateLabel(scheduledDate),
      scheduledDate,
      scheduledTime: team.meetingTime,
      recurrenceDate: scheduledDate,
      weekStartDate: weekStartDateFor(scheduledDate),
      status: 'upcoming',
      facilitatorId: team.escalationUserIds[0] ?? template?.facilitatorId ?? 'ava-khan',
      attendeeIds: [...(template?.attendeeIds ?? this.memberships.filter((membership) => membership.teamId === team.teamId && membership.active).map((membership) => membership.userId))],
      lastRating: template?.lastRating ?? 0,
      agendaProgress: 0,
      agendaTotal: sections.length,
      idsSolved: 0,
      idsTotal: idsIssueIds.length,
      recap: '',
      sectionNotes: {},
      idsIssueIds: [...idsIssueIds],
      idsAddedIssueIds: [],
      createdTodoIds: [],
      idsNotes: [],
    };
  }

  protected ensureUpcomingMeetingWindow(team: TeamRecord, carriedIssueIds: string[] = [], template?: MeetingRecord) {
    const now = Date.now();
    const upcoming = () => this.meetings.filter((meeting) => meeting.teamId === team.teamId && meeting.status === 'upcoming' && (!Number.isFinite(meetingScheduledAt(meeting)) || meetingScheduledAt(meeting) >= now)).sort((left, right) => `${left.scheduledDate}T${left.scheduledTime}`.localeCompare(`${right.scheduledDate}T${right.scheduledTime}`));
    let openMeetings = upcoming();
    const first = openMeetings[0];
    if (first && carriedIssueIds.length) {
      first.idsIssueIds = [...carriedIssueIds];
      first.idsTotal = carriedIssueIds.length;
    }
    const cadenceDates = this.meetings.filter((meeting) => meeting.teamId === team.teamId).map((meeting) => meeting.recurrenceDate ?? meeting.scheduledDate).filter((date): date is string => Boolean(date)).sort();
    let cursor = cadenceDates.at(-1) ?? template?.recurrenceDate ?? template?.scheduledDate ?? meetingDateFor(team);
    while (openMeetings.length < 4) {
      const nextDate = nextConfiguredMeetingDateAfter(team, cursor, cursor);
      cursor = nextDate;
      if (this.meetings.some((meeting) => meeting.teamId === team.teamId && (meeting.recurrenceDate ?? meeting.scheduledDate) === nextDate)) {
        openMeetings = upcoming();
        continue;
      }
      this.meetings.push(this.createUpcomingMeeting(team, nextDate, template ?? openMeetings.at(-1), carriedIssueIds));
      openMeetings = upcoming();
    }
  }

  protected maintainMeetingWindows() {
    this.teams.filter((team) => team.active && team.nodeType === 'operational').forEach((team) => this.ensureUpcomingMeetingWindow(team));
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
    return clone([...this.quarters, ...this.teams, ...this.users, ...this.memberships, ...this.rocks, ...this.tasks, ...this.todos, ...this.issues, ...this.transfers, ...this.notifications, ...this.messages, ...this.headlines, ...this.meetings, ...this.summaryJobs, ...this.metrics, ...this.scorecardResults, ...this.vtos, ...this.vtoVersions, ...this.audit, settings].map((record) => ({ ...record, environmentId: this.environmentId })));
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
    const teamIds = this.visibleTeamIds(userId);
    return {
      user: clone(user),
      memberships: clone(memberships.map(({ teamId, role, active }) => ({ teamId, role, active }))),
      leadershipVisible,
      platformAdmin: canAdministerPlatform(user.platformCapabilities) || memberships.some((membership) => membership.teamId === 'leadership' && membership.role === 'OrgAdmin'),
      teams: clone(this.teams.filter((team) => teamIds.has(team.teamId) && team.active).map(({ teamId, name, shortName, parentTeamId, nodeType, active }) => ({ teamId, name, shortName, parentTeamId, nodeType, active }))),
      currentEnvironment: this.environmentId,
    };
  }

  async getTeamDashboard(teamId: string, userId?: string) {
    if (!this.team(teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (userId) this.requireRead(teamId, userId);
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    return dashboardFor(teamId, this.rocks.filter((rock) => rock.teamId === teamId), this.todos.filter((todo) => todo.teamId === teamId), this.issues.filter((issue) => issue.teamId === teamId));
  }

  async getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace> {
    this.requireUser(userId);
    this.requireRead(teamId, userId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const rocks = this.rocks.filter((rock) => rock.teamId === teamId);
    const tasks = this.tasks.filter((task) => task.teamId === teamId);
    const todos = this.todos.filter((todo) => todo.teamId === teamId);
    const issues = this.issues.filter((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected');
    const transfers = this.transfers.filter((transfer) => transfer.sourceTeamId === teamId || transfer.destinationTeamId === teamId);
    const notifications = this.notifications.filter((notification) => notification.recipientUserId === userId && (!notification.teamId || notification.teamId === teamId));
    const messages = this.messages.filter((message) => message.fromTeamId === teamId || message.toTeamId === teamId);
    const meetings = this.meetings.filter((meeting) => meeting.teamId === teamId);
    const metrics = this.metrics.filter((metric) => metric.teamId === teamId);
    const scorecardResults = this.scorecardResults.filter((result) => result.teamId === teamId);
    const headlines = this.headlines.filter((headline) => headline.teamId === teamId);
    const vto = this.vtos.find((candidate) => candidate.teamId === teamId) ?? null;
    const vtoVersions = this.vtoVersions.filter((candidate) => candidate.teamId === teamId);
    return { environmentId: this.environmentId, team: clone(team), membership: clone(this.membership(teamId, userId) ? { teamId, role: this.membership(teamId, userId)!.role, active: true } : null), dashboard: dashboardFor(teamId, rocks, todos, issues), rocks: clone(rocks), tasks: clone(tasks), todos: clone(todos), issues: clone(issues), transfers: clone(transfers), notifications: clone(notifications), messages: clone(messages), meetings: clone(meetings), metrics: clone(metrics), scorecardResults: clone(scorecardResults), headlines: clone(headlines), vto: clone(vto), vtoVersions: clone(vtoVersions), etag: etagFor([...rocks, ...tasks, ...todos, ...issues, ...transfers, ...messages, ...meetings, ...metrics, ...scorecardResults, ...headlines, ...(vto ? [vto] : []), ...vtoVersions]) };
  }

  async getVto(teamId: string, userId: string): Promise<VtoDocument> {
    this.requireUser(userId);
    this.requireRead(teamId, userId);
    return clone({ current: this.vtos.find((vto) => vto.teamId === teamId) ?? null, versions: this.vtoVersions.filter((version) => version.teamId === teamId).sort((left, right) => right.versionNumber - left.versionNumber) });
  }

  async createHistoricalMeeting(input: CreateHistoricalMeetingInput, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own L10 meetings.');
    const scheduledDate = normalizeDate(input.scheduledDate, 'Meeting date');
    const scheduledTime = typeof input.scheduledTime === 'string' ? input.scheduledTime.trim() : '';
    if (!scheduledTime || !Number.isFinite(meetingScheduledAt({ scheduledDate, scheduledTime }))) throw new RepositoryError('VALIDATION', 'Meeting time must be a valid time.');
    if (scheduledDate > new Date().toISOString().slice(0, 10)) throw new RepositoryError('VALIDATION', 'A historical meeting must be today or earlier.');
    if (meetingScheduledAt({ scheduledDate, scheduledTime }) > Date.now()) throw new RepositoryError('VALIDATION', 'A historical meeting must have a time in the past.');
    const quarterId = this.resolveQuarterId(input.quarterId, scheduledDate);
    if (input.quarterId && quarterIdForDate(scheduledDate, this.quarters) !== input.quarterId) throw new RepositoryError('VALIDATION', 'The meeting date must fall within the selected quarter.');
    if (this.meetings.some((meeting) => meeting.teamId === input.teamId && meeting.scheduledDate === scheduledDate && meeting.scheduledTime === scheduledTime)) throw new RepositoryError('CONFLICT', 'A meeting already exists for that team, date, and time.');
    if (!Array.isArray(input.attendeeIds) || input.attendeeIds.length === 0) throw new RepositoryError('VALIDATION', 'Record at least one attendee.');
    const activeMemberIds = new Set(this.memberships.filter((membership) => membership.teamId === input.teamId && membership.active && this.user(membership.userId)).map((membership) => membership.userId));
    if (!activeMemberIds.has(input.facilitatorId)) throw new RepositoryError('VALIDATION', 'Facilitator must be an active member of the team.');
    if (new Set(input.attendeeIds).size !== input.attendeeIds.length || input.attendeeIds.some((userId) => !activeMemberIds.has(userId))) throw new RepositoryError('VALIDATION', 'Every attendee must be a unique active member of the team.');
    const rating = input.rating ?? 0;
    if (rating !== 0 && !isValidMeetingRating(rating)) throw new RepositoryError('VALIDATION', 'Meeting rating must be 0 or a half-point value from 0.5 to 10.');
    if (input.recap !== undefined && typeof input.recap !== 'string') throw new RepositoryError('VALIDATION', 'Meeting recap must be text.');
    if (input.idsNote !== undefined && typeof input.idsNote !== 'string') throw new RepositoryError('VALIDATION', 'IDS notes must be text.');
    const timestamp = nowIso();
    const scheduledAt = meetingScheduledAt({ scheduledDate, scheduledTime });
    const closedAt = new Date(Math.min(scheduledAt, Date.now())).toISOString();
    const meeting: MeetingRecord = {
      ...baseRecord(generatedId('meeting'), 'meeting', input.teamId),
      kind: 'meeting', teamId: input.teamId, quarterId, label: `${team.shortName} L10`, dateLabel: meetingDateLabel(scheduledDate), scheduledDate, scheduledTime, recurrenceDate: undefined, weekStartDate: weekStartDateFor(scheduledDate), status: 'closed', facilitatorId: input.facilitatorId, attendeeIds: [...input.attendeeIds], lastRating: rating, agendaProgress: meetingSectionsFor(team).length, agendaTotal: meetingSectionsFor(team).length, idsSolved: 0, idsTotal: 0, recap: sanitizeRichText(input.recap), startedAt: new Date(Math.max(0, scheduledAt - meetingSectionsFor(team).reduce((total, section) => total + section.duration, 0) * 60_000)).toISOString(), closedAt, durationSeconds: undefined, sectionNotes: input.idsNote?.trim() ? { ids: sanitizeRichText(input.idsNote) } : {}, idsIssueIds: [], idsAddedIssueIds: [], createdTodoIds: [], idsNotes: [], aiSummaryStatus: 'not-generated', aiSummarySource: 'legacy', createdAt: timestamp, updatedAt: timestamp, updatedBy: actorId, version: 1,
    };
    this.meetings.push(meeting);
    this.recordAudit(actorId, 'Recorded historical L10 meeting', meeting.id, `${team.name} · ${meeting.dateLabel}.`, 'meeting');
    return clone(meeting);
  }

  async getWorkspaceSnapshot(userId: string, quarterId?: string): Promise<WorkspaceSnapshot> {
    const session = await this.getSessionContext(userId);
    if (!session) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const teamIds = new Set(session.teams.map((team) => team.teamId));
    const teams = this.teams.filter((team) => team.active && teamIds.has(team.teamId));
    const memberships = this.memberships.filter((membership) => membership.active && teamIds.has(membership.teamId));
    const rocks = this.rocks.filter((rock) => teamIds.has(rock.teamId));
    const tasks = this.tasks.filter((task) => teamIds.has(task.teamId));
    const todos = this.todos.filter((todo) => teamIds.has(todo.teamId));
    const issues = this.issues.filter((issue) => teamIds.has(issue.teamId) && issue.assignmentState !== 'redirected');
    const transfers = this.transfers.filter((transfer) => teamIds.has(transfer.sourceTeamId) || teamIds.has(transfer.destinationTeamId));
    const messages = this.messages.filter((message) => teamIds.has(message.fromTeamId) || teamIds.has(message.toTeamId));
    const headlines = this.headlines.filter((headline) => teamIds.has(headline.teamId));
    const meetings = this.meetings.filter((meeting) => teamIds.has(meeting.teamId));
    const metrics = this.metrics.filter((metric) => teamIds.has(metric.teamId));
    const scorecardResults = this.scorecardResults.filter((result) => teamIds.has(result.teamId));
    const vtos = this.vtos.filter((vto) => teamIds.has(vto.teamId));
    const vtoVersions = this.vtoVersions.filter((version) => teamIds.has(version.teamId));
    const notifications = this.notifications.filter((notification) => notification.recipientUserId === userId);
    const quarters = this.quarters.map((quarter) => quarterSummary(quarter));
    const selectedId = quarterId ?? currentQuarterId(quarters);
    const selectedQuarter = quarters.find((quarter) => quarter.id === selectedId);
    if (!selectedQuarter) throw new RepositoryError('VALIDATION', 'The selected quarter does not exist.');
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
      metrics: clone(metrics),
      scorecardResults: clone(scorecardResults),
      headlines: clone(headlines),
      audit: clone(this.audit),
      quarters: clone(quarters),
      vtos: clone(vtos),
      vtoVersions: clone(vtoVersions),
      quarter: clone(selectedQuarter),
      etag: etagFor([...this.quarters, ...teams, ...memberships, ...rocks, ...tasks, ...todos, ...issues, ...transfers, ...messages, ...headlines, ...meetings, ...notifications, ...metrics, ...scorecardResults, ...vtos, ...vtoVersions, ...this.audit]),
    };
  }

  async getMeetingReview(userId: string, query: MeetingReviewQuery = {}): Promise<MeetingReviewPage> {
    this.requireUser(userId);
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const visibleTeamIds = this.visibleTeamIds(userId);
    if (query.teamId && !visibleTeamIds.has(query.teamId)) throw new RepositoryError('FORBIDDEN', 'You do not have access to this team’s meeting history.');
    const from = query.from ? normalizeDate(query.from, 'From date') : undefined;
    const to = query.to ? normalizeDate(query.to, 'To date') : undefined;
    if (from && to && from > to) throw new RepositoryError('VALIDATION', 'From date must be on or before the To date.');
    const requestedFilter = query.filter ?? query.status;
    const allItems = this.meetings
      .filter((meeting) => visibleTeamIds.has(meeting.teamId) && (!query.teamId || meeting.teamId === query.teamId))
      .map((meeting) => {
        const team = this.team(meeting.teamId);
        if (!team) return null;
        return { meeting: clone(meeting), team: { teamId: team.teamId, name: team.name, shortName: team.shortName, parentTeamId: team.parentTeamId }, reviewStatus: meetingReviewStatus(meeting, team) };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter(({ meeting, reviewStatus }) => (!from || meeting.scheduledDate >= from) && (!to || meeting.scheduledDate <= to) && (
          requestedFilter === 'attention' ? reviewStatus === 'missed' || reviewStatus === 'overdue'
          : requestedFilter === 'completed' ? reviewStatus === 'closed'
            : requestedFilter === 'skipped' ? reviewStatus === 'skipped'
              : requestedFilter === 'all' || !requestedFilter ? true
                : reviewStatus === requestedFilter
      ))
      .sort((left, right) => meetingScheduledAt(right.meeting) - meetingScheduledAt(left.meeting));
    const attentionCount = this.meetings
      .filter((meeting) => visibleTeamIds.has(meeting.teamId))
      .filter((meeting) => {
        const team = this.team(meeting.teamId);
        const status = team ? meetingReviewStatus(meeting, team) : meeting.status;
        return status === 'missed' || status === 'overdue';
      }).length;
    const rawOffset = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    if (!Number.isInteger(rawOffset) || rawOffset < 0) throw new RepositoryError('VALIDATION', 'Meeting history cursor is invalid.');
    const pageSize = 50;
    const items = allItems.slice(rawOffset, rawOffset + pageSize);
    return clone({ items, attentionCount, nextCursor: rawOffset + pageSize < allItems.length ? String(rawOffset + pageSize) : undefined });
  }

  async getMeeting(teamId: string, meetingId: string, userId: string): Promise<MeetingRecord> {
    this.requireRead(teamId, userId);
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const meeting = this.meetings.find((candidate) => candidate.teamId === teamId && candidate.id === meetingId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    return clone(meeting);
  }

  async getMeetingSummaryJob(teamId: string, meetingId: string, userId: string): Promise<MeetingSummaryJobRecord | null> {
    this.requireRead(teamId, userId);
    const job = this.summaryJobs.find((candidate) => candidate.teamId === teamId && candidate.meetingId === meetingId);
    return clone(job ?? null);
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
          issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, neutral: directIssues.filter((issue) => issue.meetingBand === 'neutral').length, green: directIssues.filter((issue) => issue.meetingBand === 'green').length, yellow: directIssues.filter((issue) => issue.meetingBand === 'yellow').length, orange: directIssues.filter((issue) => issue.meetingBand === 'orange').length, red: directIssues.filter((issue) => issue.meetingBand === 'red').length },
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
    return clone(issueAge({ ...issue, detail: sanitizeRichText(issue.detail) }, this.settings));
  }

  async getAuditTrail(entityType: AuditEntityType, entityId: string, userId: string) {
    const target = this.auditTarget(entityType, entityId);
    this.requireRead(target.teamId, userId);
    const eventTypes = new Set(this.auditEventTypes(entityType));
    return clone(this.audit
      .filter((event) => event.target === entityId && eventTypes.has(event.eventType))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }

  async updateRockStatus(rockId: string, status: RockRecord['status'], actorId: string, expectedVersion?: number) {
    const rock = this.rocks.find((item) => item.id === rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertExpectedVersion(rock.version, expectedVersion);
    if (!['on-track', 'off-track', 'complete'].includes(status)) throw new RepositoryError('VALIDATION', 'Invalid Rock status.');
    rock.status = status;
    rock.updatedAt = nowIso();
    rock.updatedBy = actorId;
    rock.version += 1;
    this.recordAudit(actorId, 'Updated Rock status', rock.id, `${rock.title} marked ${status}.`, 'rock');
    return clone(rock);
  }

  async updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number) {
    const rock = this.rocks.find((item) => item.id === rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertExpectedVersion(rock.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'Rock title');
    if (input.ownerId !== undefined && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Rock owner not found.');
    if (input.priority !== undefined && !['high', 'medium', 'low'].includes(input.priority)) throw new RepositoryError('VALIDATION', 'Invalid Rock priority.');
    const allowedInput: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>> = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.notes !== undefined ? { notes: sanitizeRichText(input.notes) } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    Object.assign(rock, allowedInput, { updatedAt: nowIso(), updatedBy: actorId, version: rock.version + 1 });
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
    const normalizedDueDate = input.dueDate === undefined ? undefined : normalizeDate(input.dueDate, 'Due date');
    const normalizedInput = normalizedDueDate === undefined ? input : { ...input, dueDate: normalizedDueDate };
    const isLaterDate = normalizedDueDate !== undefined && normalizedDueDate > todo.dueDate;
    const isRollover = todo.status !== 'done' && isLaterDate;
    const timestamp = nowIso();
    const nextInput = isRollover ? { ...normalizedInput, status: 'open' as const } : normalizedInput;
    if (isRollover) {
      todo.carryForwardCount += 1;
      todo.flagged = todo.carryForwardCount > 3;
    }
    const sanitizedInput = { ...nextInput, ...(nextInput.notes !== undefined ? { notes: sanitizeTodoNotes(nextInput.notes) } : {}) };
    Object.assign(todo, sanitizedInput, { updatedAt: timestamp, updatedBy: actorId, version: todo.version + 1 });
    if (todo.linkedRockTaskId) {
      const task = this.tasks.find((item) => item.id === todo.linkedRockTaskId);
      if (task) {
        if (task.teamId !== todo.teamId) throw new RepositoryError('VALIDATION', 'Linked Rock Task must belong to the same team.');
        if (isRollover) task.status = 'open';
        else if (normalizedInput.status !== undefined) task.status = normalizedInput.status === 'done' ? 'done' : 'open';
        if (normalizedInput.ownerId !== undefined) task.assigneeId = normalizedInput.ownerId;
        if (normalizedDueDate !== undefined) task.dueDate = normalizedDueDate;
        task.updatedAt = timestamp;
        task.updatedBy = actorId;
        task.version += 1;
      }
    }
    if (isRollover && todo.flagged && !todo.convertedIssueId) {
      const issue: IssueRecord = makeIssue({ id: `issue-todo-rollover-${todo.id}`, teamId: todo.teamId, title: `Repeated To-Do: ${todo.title}`, raisedById: actorId, ageInDays: 0, ownerId: todo.ownerId });
      issue.detail = `This To-Do was moved forward ${todo.carryForwardCount} times. Review the commitment in IDS and decide what must change.`;
      issue.priority = 2;
      issue.sourceTodoId = todo.id;
      issue.updatedBy = actorId;
      this.issues.unshift(issue);
      todo.convertedIssueId = issue.id;
      this.recordAudit(actorId, 'Converted repeated To-Do to Issue', issue.id, `${todo.title} moved forward ${todo.carryForwardCount} times.`, 'issue');
    } else if (isRollover) {
      this.recordAudit(actorId, 'Moved To-Do forward', todo.id, `${todo.title} moved to ${todo.dueDate} (${todo.carryForwardCount} times).`, 'todo');
    } else {
      this.recordAudit(actorId, 'Updated To-Do', todo.id, `Updated ${todo.title}.`, 'todo');
    }
    return clone(todo);
  }

  async addTodoChecklistItem(todoId: string, text: string, supporterId: string | undefined, actorId: string, expectedVersion?: number) {
    const todo = this.todos.find((item) => item.id === todoId);
    if (!todo) throw new RepositoryError('NOT_FOUND', 'To-Do not found.');
    this.requireWrite(todo.teamId, actorId);
    assertExpectedVersion(todo.version, expectedVersion);
    assertText(text, 'Checklist item');
    const resolvedSupporterId = supporterId ?? todo.ownerId;
    this.requireChecklistSupporter(todo.teamId, resolvedSupporterId);
    const timestamp = nowIso();
    const item: TodoChecklistItem = { id: generatedId('checklist'), text: text.trim(), completed: false, supporterId: resolvedSupporterId, createdAt: timestamp, updatedAt: timestamp };
    todo.checklist = [...(todo.checklist ?? []), item];
    todo.updatedAt = timestamp;
    todo.updatedBy = actorId;
    todo.version += 1;
    this.recordAudit(actorId, 'Added To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return clone(todo);
  }

  async updateTodoChecklistItem(todoId: string, itemId: string, input: UpdateTodoChecklistItemInput, actorId: string, expectedVersion?: number) {
    const todo = this.todos.find((item) => item.id === todoId);
    if (!todo) throw new RepositoryError('NOT_FOUND', 'To-Do not found.');
    this.requireWrite(todo.teamId, actorId);
    assertExpectedVersion(todo.version, expectedVersion);
    const item = (todo.checklist ?? []).find((candidate) => candidate.id === itemId);
    if (!item) throw new RepositoryError('NOT_FOUND', 'Checklist item not found.');
    if (input.text !== undefined) assertText(input.text, 'Checklist item');
    if (input.completed !== undefined && typeof input.completed !== 'boolean') throw new RepositoryError('VALIDATION', 'Checklist completion must be true or false.');
    if (input.supporterId !== undefined) this.requireChecklistSupporter(todo.teamId, input.supporterId);
    const timestamp = nowIso();
    Object.assign(item, { ...input, text: input.text?.trim() ?? item.text, updatedAt: timestamp });
    todo.updatedAt = timestamp;
    todo.updatedBy = actorId;
    todo.version += 1;
    this.recordAudit(actorId, 'Updated To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return clone(todo);
  }

  async deleteTodoChecklistItem(todoId: string, itemId: string, actorId: string, expectedVersion?: number) {
    const todo = this.todos.find((item) => item.id === todoId);
    if (!todo) throw new RepositoryError('NOT_FOUND', 'To-Do not found.');
    this.requireWrite(todo.teamId, actorId);
    assertExpectedVersion(todo.version, expectedVersion);
    const item = (todo.checklist ?? []).find((candidate) => candidate.id === itemId);
    if (!item) throw new RepositoryError('NOT_FOUND', 'Checklist item not found.');
    const timestamp = nowIso();
    todo.checklist = todo.checklist.filter((candidate) => candidate.id !== itemId);
    todo.updatedAt = timestamp;
    todo.updatedBy = actorId;
    todo.version += 1;
    this.recordAudit(actorId, 'Removed To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return clone(todo);
  }

  /* Scorecard definitions and results are team-owned records. */
  async createScorecardMetric(input: { teamId: string; label: string; target: string; unit: string; ownerId: string }, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only teams cannot own measurables.');
    assertText(input.label, 'Measurable label');
    assertText(input.target, 'Measurable target');
    assertText(input.unit, 'Measurable unit');
    if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Measurable owner not found.');
    if (!this.membership(input.teamId, input.ownerId)) throw new RepositoryError('VALIDATION', 'Measurable owner must be an active member of the team.');
    const metric: ScorecardMetricRecord = makeScorecardMetric({ id: generatedId('metric'), teamId: input.teamId, label: input.label.trim(), target: input.target.trim(), unit: input.unit.trim(), ownerId: input.ownerId });
    metric.updatedBy = actorId;
    this.metrics.push(metric);
    this.recordAudit(actorId, 'Created Scorecard measurable', metric.id, metric.label, 'team');
    return clone(metric);
  }

  async updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetricRecord, 'label' | 'target' | 'unit' | 'ownerId'>>, actorId: string, expectedVersion?: number) {
    const metric = this.metrics.find((item) => item.id === metricId);
    if (!metric) throw new RepositoryError('NOT_FOUND', 'Measurable not found.');
    this.requireWrite(metric.teamId, actorId);
    assertExpectedVersion(metric.version, expectedVersion);
    if (input.label !== undefined) assertText(input.label, 'Measurable label');
    if (input.target !== undefined) assertText(input.target, 'Measurable target');
    if (input.unit !== undefined) assertText(input.unit, 'Measurable unit');
    if (input.ownerId !== undefined) {
      if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Measurable owner not found.');
      if (!this.membership(metric.teamId, input.ownerId)) throw new RepositoryError('VALIDATION', 'Measurable owner must be an active member of the team.');
    }
    Object.assign(metric, { ...input, label: input.label?.trim() ?? metric.label, target: input.target?.trim() ?? metric.target, unit: input.unit?.trim() ?? metric.unit, updatedAt: nowIso(), updatedBy: actorId, version: metric.version + 1 });
    this.recordAudit(actorId, 'Updated Scorecard measurable', metric.id, metric.label, 'team');
    return clone(metric);
  }

  async upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResultRecord, 'actual' | 'status'>, actorId: string, expectedVersion?: number) {
    const metric = this.metrics.find((item) => item.id === metricId);
    if (!metric) throw new RepositoryError('NOT_FOUND', 'Measurable not found.');
    this.requireWrite(metric.teamId, actorId);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate) || weekStartDateFor(weekStartDate) !== weekStartDate) throw new RepositoryError('VALIDATION', 'Week start must be a valid Monday date.');
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('VALIDATION', 'Week start must be a valid Monday date.');
    }
    assertText(input.actual, 'Actual value');
    if (!['on-track', 'off-track'].includes(input.status)) throw new RepositoryError('VALIDATION', 'Invalid measurable status.');
    const result = this.scorecardResults.find((item) => item.metricId === metricId && item.weekStartDate === weekStartDate);
    const priorWeek = weekStartDateFor(new Date(new Date(`${weekStartDate}T12:00:00Z`).getTime() - 7 * DAY));
    const prior = this.scorecardResults.find((item) => item.metricId === metricId && item.weekStartDate === priorWeek);
    const trend = scorecardTrendFor(input.actual, prior?.actual);
    const timestamp = nowIso();
    if (result) {
      assertExpectedVersion(result.version, expectedVersion);
      Object.assign(result, { actual: input.actual.trim(), status: input.status, ...trend, updatedAt: timestamp, updatedBy: actorId, version: result.version + 1 });
    } else {
      if (expectedVersion !== undefined) throw new RepositoryError('CONFLICT', 'This weekly result does not exist yet. Refresh and try again.');
      const created: ScorecardResultRecord = makeScorecardResult({ id: `result-${metricId}-${weekStartDate}`, metricId, teamId: metric.teamId, weekStartDate, actual: input.actual.trim(), status: input.status, priorActual: prior?.actual });
      created.updatedBy = actorId;
      this.scorecardResults.push(created);
      this.recordAudit(actorId, 'Updated Scorecard result', created.id, `${metric.label} · ${weekStartDate}`, 'team');
      return clone(created);
    }
    this.recordAudit(actorId, 'Updated Scorecard result', result.id, `${metric.label} · ${weekStartDate}`, 'team');
    return clone(result);
  }

  private createIssueRecord(input: CreateIssueInput, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own Issues.');
    assertText(input.title, 'Issue title');
    if (!this.user(input.raisedById)) throw new RepositoryError('FORBIDDEN', 'Issue creator is not an active organization user.');
    if (input.ownerId && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Issue owner not found.');
    const quarterId = this.resolveQuarterId(input.quarterId);
    const priority = input.priority ?? 1;
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new RepositoryError('VALIDATION', 'Issue priority must be between 1 and 5.');
    const issueId = input.id ?? generatedId('issue');
    if (this.issues.some((candidate) => candidate.id === issueId)) throw new RepositoryError('CONFLICT', 'An Issue with this identity already exists.');
    const issue = makeIssue({ id: issueId, teamId: input.teamId, title: input.title.trim(), raisedById: input.raisedById, ageInDays: 0, horizon: input.horizon, ownerId: input.ownerId ?? actorId });
    issue.quarterId = quarterId;
    issue.detail = sanitizeRichText(input.detail);
    issue.priority = priority;
    issue.linkedRockId = input.linkedRockId;
    issue.linkedScorecardMetricId = input.linkedScorecardMetricId;
    issue.linkedScorecardWeekStartDate = input.linkedScorecardWeekStartDate;
    issue.idsNote = input.idsNote ? sanitizeRichText(input.idsNote) : undefined;
    issue.updatedBy = actorId;
    this.issues.push(issue);
    this.recordAudit(actorId, 'Created Issue', issue.id, issue.title, 'issue');
    return issue;
  }

  async createIssue(input: CreateIssueInput, actorId: string) {
    return clone(this.createIssueRecord(input, actorId));
  }

  async createHeadline(input: CreateHeadlineInput, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own Headlines.');
    if (input.type !== 'win' && input.type !== 'concern') throw new RepositoryError('VALIDATION', 'Headline type must be win or concern.');
    assertText(input.title, 'Headline title');
    if (input.meetingId) {
      const meeting = this.meetings.find((candidate) => candidate.id === input.meetingId && candidate.teamId === input.teamId);
      if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
      if (meeting.status === 'closed' || meeting.status === 'skipped') throw new RepositoryError('CONFLICT', 'Headlines can only be added to an upcoming or in-progress meeting.');
    }
    if (input.issueId) {
      const issue = this.activeIssue(input.issueId);
      if (!issue || issue.teamId !== input.teamId) throw new RepositoryError('VALIDATION', 'Linked Headline Issue must belong to the same team.');
    }
    const headline = makeHeadline({
      id: generatedId('headline'),
      teamId: input.teamId,
      meetingId: input.meetingId,
      authorId: actorId,
      type: input.type,
      title: input.title.trim(),
      detail: typeof input.detail === 'string' ? sanitizeRichText(input.detail) : '',
      issueId: input.issueId,
    });
    headline.quarterId = input.meetingId ? this.meetings.find((meeting) => meeting.id === input.meetingId)?.quarterId : this.resolveQuarterId(undefined);
    this.headlines.push(headline);
    this.recordAudit(actorId, 'Created Headline', headline.id, headline.title, 'team');
    return clone(headline);
  }

  async createIssueFromScorecard(metricId: string, weekStartDate: string, actorId: string, expectedVersion?: number) {
    const metric = this.metrics.find((candidate) => candidate.id === metricId);
    if (!metric) throw new RepositoryError('NOT_FOUND', 'Scorecard measurable not found.');
    this.requireWrite(metric.teamId, actorId);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate) || weekStartDateFor(weekStartDate) !== weekStartDate) throw new RepositoryError('VALIDATION', 'Week start must be a valid Monday date.');
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      throw new RepositoryError('VALIDATION', 'Week start must be a valid Monday date.');
    }
    const result = this.scorecardResults.find((candidate) => candidate.metricId === metricId && candidate.weekStartDate === weekStartDate);
    if (!result || result.status !== 'off-track') throw new RepositoryError('VALIDATION', 'Only an off-track Scorecard result can become an Issue.');
    assertExpectedVersion(result.version, expectedVersion);
    const existing = this.issues.find((issue) => issue.teamId === metric.teamId && issue.assignmentState !== 'redirected' && issue.linkedScorecardMetricId === metricId && issue.linkedScorecardWeekStartDate === weekStartDate);
    if (existing) return clone(existing);
    return clone(this.createIssueRecord({
      id: `issue-scorecard-${metricId}-${weekStartDate}`,
      teamId: metric.teamId,
      title: `Scorecard: ${metric.label}`,
      detail: `${metric.label} is ${result.actual} against a target of ${metric.target} ${metric.unit} for the week of ${weekStartDate}.`,
      priority: 1,
      horizon: 'short-term',
      raisedById: actorId,
      ownerId: metric.ownerId,
      linkedScorecardMetricId: metricId,
      linkedScorecardWeekStartDate: weekStartDate,
      quarterId: quarterIdForDate(weekStartDate, this.quarters),
    }, actorId));
  }

  async createIssueFromRock(rockId: string, actorId: string, expectedVersion?: number) {
    const rock = this.rocks.find((candidate) => candidate.id === rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    this.requireWrite(rock.teamId, actorId);
    assertExpectedVersion(rock.version, expectedVersion);
    if (rock.status !== 'off-track') throw new RepositoryError('VALIDATION', 'Only an off-track Rock can become an Issue.');
    const existing = this.issues.find((issue) => issue.assignmentState !== 'redirected' && issue.linkedRockId === rockId);
    if (existing) return clone(existing);
    const priority = rock.priority === 'high' ? 1 : rock.priority === 'medium' ? 3 : 5;
    return clone(this.createIssueRecord({
      id: `issue-rock-${rockId}`,
      teamId: rock.teamId,
      title: `Off-track Rock: ${rock.title}`,
      detail: rock.description || (() => { const milestones = milestoneCountsFor(rock.id, this.tasks); return `The Rock has ${milestones.remaining} milestone${milestones.remaining === 1 ? '' : 's'} remaining and is marked off-track.`; })(),
      priority,
      horizon: 'short-term',
      raisedById: actorId,
      ownerId: rock.ownerId,
      linkedRockId: rockId,
      quarterId: rock.quarterId,
    }, actorId));
  }

  async updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (input.title !== undefined) assertText(input.title, 'Issue title');
    if (input.ownerId !== undefined && !this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Issue owner not found.');
    if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5)) throw new RepositoryError('VALIDATION', 'Issue priority must be between 1 and 5.');
    if (input.horizon !== undefined && !['short-term', 'long-term'].includes(input.horizon)) throw new RepositoryError('VALIDATION', 'Invalid Issue horizon.');
    const allowedInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.detail !== undefined ? { detail: sanitizeRichText(input.detail) } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.idsNote !== undefined ? { idsNote: sanitizeRichText(input.idsNote) } : {}),
    };
    Object.assign(issue, allowedInput, { updatedAt: nowIso(), updatedBy: actorId, version: issue.version + 1 });
    this.recordAudit(actorId, 'Updated Issue', issue.id, `Updated ${issue.title}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number) {
    assertText(note, 'IDS note');
    const cleanNote = sanitizeRichText(note);
    if (!richTextToPlainText(cleanNote)) throw new RepositoryError('VALIDATION', 'IDS note is required.');
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    if (meeting.teamId !== issue.teamId) throw new RepositoryError('FORBIDDEN', 'The Issue and meeting must belong to the same team.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'Closed meetings cannot receive new IDS notes.');
    if (!meeting.idsIssueIds.includes(issueId) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    const entry: MeetingIssueNoteRecord = { id: generatedId('meeting-note'), meetingId, issueId, authorId: actorId, note: cleanNote, createdAt: timestamp };
    meeting.idsNotes.push(entry);
    if (!meeting.idsIssueIds.includes(issueId)) {
      meeting.idsIssueIds.push(issueId);
      if (!meeting.idsAddedIssueIds.includes(issueId)) meeting.idsAddedIssueIds.push(issueId);
    }
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, cleanNote);
    if (issue.status === 'open') issue.status = 'in-ids';
    issue.updatedAt = timestamp;
    issue.updatedBy = actorId;
    issue.version += 1;
    this.recordAudit(actorId, 'Added meeting IDS note', issue.id, `Added an IDS note from ${meeting.label}.`, 'meeting');
    return { issue: clone(issueAge(issue, this.settings)), meeting: clone(meeting) };
  }

  async updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'Closed meetings cannot receive notes.');
    if (!['segue', 'scorecard', 'rock-review', 'headlines', 'todo-review', 'ids', 'conclude'].includes(section)) throw new RepositoryError('VALIDATION', 'Invalid meeting section.');
    if (typeof note !== 'string') throw new RepositoryError('VALIDATION', 'Meeting note must be a string.');
    const cleanNote = sanitizeRichText(note);
    const normalizedNote = richTextToPlainText(cleanNote) ? cleanNote.trim() : '';
    const sectionNotes = { ...meeting.sectionNotes };
    if (normalizedNote) sectionNotes[section] = normalizedNote;
    else delete sectionNotes[section];
    const timestamp = nowIso();
    meeting.sectionNotes = sectionNotes;
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.recordAudit(actorId, 'Updated meeting section notes', meeting.id, `${team.name} · ${section}.`, 'meeting');
    return clone(meeting);
  }

  async setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!team || !meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status === 'closed' || meeting.status === 'skipped') throw new RepositoryError('CONFLICT', 'Closed meetings cannot change their IDS selection.');
    if (!Array.isArray(issueIds) || issueIds.some((issueId) => typeof issueId !== 'string')) throw new RepositoryError('VALIDATION', 'IDS selection must be a list of Issue IDs.');
    if (issueIds.length > MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const requested = new Set<string>();
    for (const issueId of issueIds) {
      if (requested.has(issueId)) throw new RepositoryError('VALIDATION', 'IDS selection cannot contain duplicates.');
      requested.add(issueId);
      const issue = this.activeIssue(issueId);
      if (!issue || issue.teamId !== teamId || issue.horizon !== 'short-term' || issue.status === 'solved') throw new RepositoryError('VALIDATION', 'Every selected Issue must be an active short-term Issue for this team.');
    }
    if (issueIds.length === meeting.idsIssueIds.length && issueIds.every((issueId, index) => issueId === meeting.idsIssueIds[index])) return clone(meeting);
    const timestamp = nowIso();
    const previous = new Set(meeting.idsIssueIds);
    meeting.idsIssueIds = [...issueIds];
    meeting.idsAddedIssueIds = [...new Set([...meeting.idsAddedIssueIds, ...issueIds.filter((issueId) => !previous.has(issueId))])];
    meeting.idsTotal = issueIds.length;
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    for (const issueId of issueIds) {
      const issue = this.activeIssue(issueId);
      if (issue && issue.status !== 'in-ids') {
        issue.status = 'in-ids';
        issue.updatedAt = timestamp;
        issue.updatedBy = actorId;
        issue.version += 1;
      }
    }
    this.recordAudit(actorId, 'Selected IDS Issues', meeting.id, `${team.name} selected ${issueIds.length} Issues for IDS.`, 'meeting');
    return clone(meeting);
  }

  async reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'Closed meetings cannot reorder Issues.');
    if (!Array.isArray(issueIds) || issueIds.some((issueId) => typeof issueId !== 'string')) throw new RepositoryError('VALIDATION', 'Issue order must be a list of Issue IDs.');
    if (issueIds.length > MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const requested = new Set<string>();
    for (const issueId of issueIds) {
      if (requested.has(issueId)) throw new RepositoryError('VALIDATION', 'Issue order cannot contain duplicates.');
      requested.add(issueId);
      if (!meeting.idsIssueIds.includes(issueId)) throw new RepositoryError('VALIDATION', 'Issue order can only contain Issues already in this meeting.');
      const issue = this.activeIssue(issueId);
      if (!issue || issue.teamId !== teamId) throw new RepositoryError('VALIDATION', 'Every ordered Issue must belong to this team.');
    }
    const nextOrder = [...issueIds, ...meeting.idsIssueIds.filter((issueId) => !requested.has(issueId))];
    if (nextOrder.every((issueId, index) => issueId === meeting.idsIssueIds[index])) return clone(meeting);
    const timestamp = nowIso();
    meeting.idsIssueIds = nextOrder;
    meeting.idsTotal = nextOrder.length;
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.recordAudit(actorId, 'Reordered IDS Issues', meeting.id, `${team.name} IDS order updated.`, 'meeting');
    return clone(meeting);
  }

  async transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!team || !meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status !== 'in-progress') throw new RepositoryError('CONFLICT', 'Start the meeting before moving between timed sections.');
    const sections = meetingSectionsFor(team);
    if (!sections.some((section) => section.id === fromSection) || !sections.some((section) => section.id === toSection)) throw new RepositoryError('VALIDATION', 'Choose valid sections for this meeting.');
    if (fromSection === toSection) return clone(meeting);
    const timestamp = nowIso();
    const activeSection = meeting.activeSection ?? fromSection;
    const sectionStartedAt = meeting.activeSectionStartedAt ?? meeting.startedAt;
    const duration = activeSection && sectionStartedAt ? elapsedSeconds(sectionStartedAt, timestamp) : 0;
    meeting.sectionDurations = { ...(meeting.sectionDurations ?? {}), [activeSection]: (meeting.sectionDurations?.[activeSection] ?? 0) + duration };
    meeting.activeSection = toSection;
    meeting.activeSectionStartedAt = timestamp;
    const nextIndex = sections.findIndex((section) => section.id === toSection);
    meeting.agendaProgress = nextIndex >= 0 ? nextIndex + 1 : meeting.agendaProgress;
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.recordAudit(actorId, 'Moved L10 section', meeting.id, `${fromSection} → ${toSection}.`, 'meeting');
    return clone(meeting);
  }

  async parkIssue(issueId: string, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (issue.status === 'solved') return clone(issueAge(issue, this.settings));
    if (issue.horizon !== 'short-term') throw new RepositoryError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    const meeting = this.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    issue.status = 'parked';
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, 'Parked for a future IDS conversation.');
    issue.updatedAt = timestamp;
    issue.updatedBy = actorId;
    issue.version += 1;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = timestamp;
      meeting.updatedBy = actorId;
      meeting.version += 1;
    }
    this.recordAudit(actorId, 'Parked Issue', issue.id, `Parked ${issue.title} for a future IDS conversation.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async startIssue(issueId: string, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    assertExpectedVersion(issue.version, expectedVersion);
    if (issue.horizon !== 'short-term') throw new RepositoryError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    if (issue.assignmentState === 'pending-transfer') throw new RepositoryError('CONFLICT', 'A pending transfer must be decided before IDS starts.');
    const meeting = this.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    issue.status = 'in-ids';
    issue.updatedAt = nowIso();
    issue.updatedBy = actorId;
    issue.version += 1;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = issue.updatedAt;
      meeting.updatedBy = actorId;
      meeting.version += 1;
    }
    this.recordAudit(actorId, 'Started IDS', issue.id, `Started IDS for ${issue.title}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async solveIssue(issueId: string, input: SolveIssueInput, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    if (issue.status === 'solved') return clone(issueAge(issue, this.settings));
    assertExpectedVersion(issue.version, expectedVersion);
    if (issue.assignmentState === 'pending-transfer') throw new RepositoryError('CONFLICT', 'A pending transfer must be decided before the Issue is solved.');
    if (typeof input.createFollowUpTodo !== 'boolean') throw new RepositoryError('VALIDATION', 'Choose whether to create a follow-up To-Do.');
    if (input.resolutionNote !== undefined && typeof input.resolutionNote !== 'string') throw new RepositoryError('VALIDATION', 'Resolution note must be a string.');
    const meeting = this.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new RepositoryError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    issue.status = 'solved';
    issue.solvedAt = timestamp;
    issue.updatedAt = issue.solvedAt;
    issue.updatedBy = actorId;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = issue.updatedAt;
      meeting.updatedBy = actorId;
      meeting.version += 1;
    }
    const followUpId = `todo-follow-up-${issue.id}`;
    let followUpCreated = false;
    if (input.createFollowUpTodo && !this.todos.some((todo) => todo.id === followUpId)) {
      const followUp = makeTodo({ id: followUpId, teamId: issue.teamId, quarterId: issue.quarterId, title: `Follow up on the solution: ${issue.title}`, ownerId: actorId, dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), sourceIssueId: issue.id });
      followUp.origin = `IDS · ${issue.title}`;
      followUp.updatedBy = actorId;
      this.todos.push(followUp);
      followUpCreated = true;
      if (meeting) {
        meeting.createdTodoIds.push(followUp.id);
        meeting.updatedAt = followUp.updatedAt;
        meeting.updatedBy = actorId;
        meeting.version += 1;
      }
    }
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, `Resolved. Follow-up To-Do ${input.createFollowUpTodo ? 'created' : 'not created'}.${input.resolutionNote?.trim() ? ` ${input.resolutionNote.trim()}` : ''}`);
    issue.updatedAt = timestamp;
    issue.updatedBy = actorId;
    issue.version += 1;
    this.recordAudit(actorId, 'Solved Issue', issue.id, `Solved ${issue.title}; follow-up To-Do ${followUpCreated ? 'created' : 'not created'}.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async reopenIssue(issueId: string, actorId: string, expectedVersion?: number) {
    const issue = this.activeIssue(issueId);
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    this.requireWrite(issue.teamId, actorId);
    if (issue.status !== 'solved') return clone(issueAge(issue, this.settings));
    assertExpectedVersion(issue.version, expectedVersion);
    const timestamp = nowIso();
    issue.status = 'open';
    delete issue.solvedAt;
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, 'Reopened for another IDS conversation.');
    issue.updatedAt = timestamp;
    issue.updatedBy = actorId;
    issue.version += 1;
    this.recordAudit(actorId, 'Reopened Issue', issue.id, `Reopened ${issue.title} for another IDS conversation.`, 'issue');
    return clone(issueAge(issue, this.settings));
  }

  async createRock(input: { teamId: string; quarterId?: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own Rocks.');
    assertText(input.title, 'Rock title');
    if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'Rock owner not found.');
    const quarterId = this.resolveQuarterId(input.quarterId, input.dueDate ?? new Date());
    const quarter = this.quarters.find((candidate) => candidate.id === quarterId)!;
    const dueDate = normalizeDate(input.dueDate ?? quarter.endDate, 'Rock due date');
    if (input.quarterId && quarterIdForDate(dueDate, this.quarters) !== input.quarterId) throw new RepositoryError('VALIDATION', 'The Rock due date must fall within the selected quarter.');
    const rock = makeRock({ id: generatedId('rock'), teamId: input.teamId, quarterId, title: input.title.trim(), ownerId: input.ownerId, priority: input.priority, dueDate });
    rock.description = input.description?.trim() ?? '';
    rock.notes = sanitizeRichText(input.notes);
    rock.updatedBy = actorId;
    this.rocks.push(rock);
    this.recordAudit(actorId, 'Created Rock', rock.id, rock.title, 'rock');
    return clone(rock);
  }

  async createTodo(input: CreateTodoInput, actorId: string) {
    this.requireWrite(input.teamId, actorId);
    const team = this.team(input.teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own To-Dos.');
    assertText(input.title, 'To-Do title');
    if (!this.user(input.ownerId)) throw new RepositoryError('VALIDATION', 'To-Do owner not found.');
    const dueDate = normalizeDate(input.dueDate, 'Due date');
    const quarterId = this.resolveQuarterId(input.quarterId, dueDate);
    if (input.quarterId && quarterIdForDate(dueDate, this.quarters) !== input.quarterId) throw new RepositoryError('VALIDATION', 'The To-Do due date must fall within the selected quarter.');
    if (input.linkedRockTaskId) {
      const linkedTask = this.tasks.find((task) => task.id === input.linkedRockTaskId);
      if (!linkedTask) throw new RepositoryError('NOT_FOUND', 'Linked Rock Task not found.');
      if (linkedTask.teamId !== input.teamId) throw new RepositoryError('VALIDATION', 'Linked Rock Task must belong to the same team.');
      if (linkedTask.linkedTodoId) throw new RepositoryError('CONFLICT', 'This Rock Task already has a linked To-Do.');
    }
    if (input.sourceIssueId) {
      const sourceIssue = this.activeIssue(input.sourceIssueId);
      if (!sourceIssue) throw new RepositoryError('NOT_FOUND', 'Source Issue not found.');
      if ((sourceIssue.currentTeamId ?? sourceIssue.teamId) !== input.teamId) throw new RepositoryError('VALIDATION', 'Source Issue must belong to the same team.');
    }
    const todo = makeTodo({ id: generatedId('todo'), teamId: input.teamId, quarterId, title: input.title.trim(), ownerId: input.ownerId, dueDate, linkedRockTaskId: input.linkedRockTaskId, sourceIssueId: input.sourceIssueId });
    todo.notes = sanitizeTodoNotes(input.notes);
    todo.updatedBy = actorId;
    this.todos.push(todo);
    this.recordAudit(actorId, 'Created To-Do', todo.id, todo.title, 'todo');
    return clone(todo);
  }

  async saveVto(teamId: string, input: SaveVtoInput, actorId: string, expectedVersion?: number) {
    const membership = this.membership(teamId, actorId);
    if (!membership || !canManageTeam(membership.role)) throw new RepositoryError('FORBIDDEN', 'Only a TeamLead or OrgAdmin can edit the team V/TO.');
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new RepositoryError('VALIDATION', 'Grouping-only nodes cannot own a V/TO.');
    const normalized = normalizeVtoInput(input);
    for (const rockId of normalized.quarterlyRockIds) {
      const rock = this.rocks.find((candidate) => candidate.id === rockId);
      if (!rock || rock.teamId !== teamId) throw new RepositoryError('VALIDATION', 'Every V/TO Quarterly Rock must belong to this team.');
    }
    for (const issueId of normalized.issueIds) {
      const issue = this.activeIssue(issueId);
      if (!issue || issue.teamId !== teamId) throw new RepositoryError('VALIDATION', 'Every V/TO Issue must belong to this team.');
    }
    const current = this.vtos.find((candidate) => candidate.teamId === teamId);
    if (current) assertExpectedVersion(current.version, expectedVersion);
    else if (expectedVersion !== undefined) throw new RepositoryError('CONFLICT', 'This team V/TO does not exist yet. Refresh and try again.');
    const timestamp = nowIso();
    const versionNumber = (current?.versionNumber ?? this.vtoVersions.filter((version) => version.teamId === teamId).reduce((highest, version) => Math.max(highest, version.versionNumber), 0)) + 1;
    const vtoId = `vto-${teamId}`;
    const next: VtoRecord = {
      ...(current ? clone(current) : baseRecord(vtoId, 'vto', teamId)),
      kind: 'vto', teamId, ...clone(normalized), versionNumber, savedBy: actorId, updatedAt: timestamp, updatedBy: actorId, version: current ? current.version + 1 : 1,
    };
    const snapshot: VtoVersionRecord = {
      ...baseRecord(`${vtoId}-version-${versionNumber}`, 'vtoVersion', teamId, versionNumber),
      kind: 'vtoVersion', teamId, vtoId, ...clone(normalized), versionNumber, savedBy: actorId,
    };
    if (current) this.vtos = this.vtos.map((candidate) => candidate.teamId === teamId ? next : candidate);
    else this.vtos.push(next);
    this.vtoVersions.push(snapshot);
    this.recordAudit(actorId, 'Updated team V/TO', vtoId, `${team.name} V/TO version ${versionNumber} saved.`, 'vto');
    return clone(next);
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
    const allowedInput: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>> = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.assignedAt !== undefined ? { assignedAt: input.assignedAt } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    Object.assign(task, allowedInput, { updatedAt: nowIso(), updatedBy: actorId, version: task.version + 1 });
    this.syncTaskTodo(task, actorId);
    this.recordAudit(actorId, 'Updated Rock Task', task.id, task.title, 'rock');
    return clone(task);
  }

  async deleteRockTask(taskId: string, actorId: string, expectedVersion?: number): Promise<DeleteRockTaskResult> {
    const task = this.taskFor(taskId, actorId);
    assertExpectedVersion(task.version, expectedVersion);
    const rock = this.rocks.find((candidate) => candidate.id === task.rockId);
    if (!rock) throw new RepositoryError('NOT_FOUND', 'Rock not found.');
    const linkedTodo = task.linkedTodoId ? this.todos.find((todo) => todo.id === task.linkedTodoId) : undefined;
    if (linkedTodo) {
      delete linkedTodo.linkedRockTaskId;
      linkedTodo.origin = 'Team workspace · former Rock Task';
      linkedTodo.updatedAt = nowIso();
      linkedTodo.updatedBy = actorId;
      linkedTodo.version += 1;
    }
    this.tasks = this.tasks.filter((candidate) => candidate.id !== taskId);
    rock.updatedAt = nowIso();
    rock.updatedBy = actorId;
    rock.version += 1;
    this.recordAudit(actorId, 'Deleted Rock Task', task.id, `${task.title} removed from ${rock.title}.`, 'rock');
    return { deletedTaskId: task.id, rockId: rock.id, rockVersion: rock.version };
  }

  async convertRockTaskToTodo(taskId: string, actorId: string) {
    const task = this.taskFor(taskId, actorId);
    if (task.linkedTodoId) {
      const existing = this.todos.find((todo) => todo.id === task.linkedTodoId);
      if (existing) return { task: clone(task), todo: clone(existing) };
    }
    const rock = this.rocks.find((candidate) => candidate.id === task.rockId);
    const todo = await this.createTodo({ teamId: task.teamId, quarterId: rock?.quarterId, title: task.title, notes: task.notes, ownerId: task.assigneeId, dueDate: task.dueDate }, actorId);
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

  async createIssueFromMessage(input: { messageId: string; title: string; detail: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string) {
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
    const issue = await this.createIssue({ teamId: message.toTeamId, quarterId: this.resolveQuarterId(undefined), title: input.title, detail: input.detail, priority: input.priority, horizon: input.horizon, ownerId: input.ownerId ?? actorId, raisedById: actorId }, actorId);
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
    const meetingStartedAt = meeting.startedAt ?? `${meeting.scheduledDate}T00:00:00.000Z`;
    const startTime = new Date(meetingStartedAt).getTime();
    const issues = this.issues.filter((issue) => {
      const createdAt = new Date(issue.createdAt).getTime();
      return issue.teamId === team.teamId
        && issue.assignmentState !== 'redirected'
        && issue.status !== 'solved'
        && (Number.isNaN(startTime) || Number.isNaN(createdAt) || createdAt <= startTime);
    });
    for (const issue of issues) {
      issue.meetingsPassed += 1;
      issue.meetingBand = issueMeetingBand(issue.meetingsPassed, issue.status);
      issue.updatedAt = at;
      issue.updatedBy = 'system';
      issue.version += 1;
      if (issue.meetingsPassed >= 4 && issue.escalationState !== 'escalated') {
        const recipient = team.escalationUserIds[issue.escalationLevel] ?? team.escalationUserIds[0];
        issue.escalationState = 'escalated';
        issue.escalationDueAt = undefined;
        if (recipient) {
          issue.escalatedToUserId = recipient;
          issue.escalationLevel += 1;
          this.notify(recipient, { type: 'issue-escalation', title: 'Issue escalated', message: `${issue.title} has remained unsolved through four L10 meetings for ${team.name}.`, issueId: issue.id, teamId: team.teamId });
        }
      }
    }
  }

  async startMeeting(teamId: string, meetingId: string, actorId: string, expectedVersion?: number, facilitatorId?: string) {
    const membership = this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    if (meeting.status === 'closed' || meeting.status === 'skipped') throw new RepositoryError('CONFLICT', 'Closed or skipped meetings cannot be started.');
    const selectedFacilitatorId = facilitatorId ?? meeting.facilitatorId ?? actorId;
    const isTeamMember = this.memberships.some((membership) => membership.teamId === teamId && membership.userId === selectedFacilitatorId && membership.active);
    if (!this.user(selectedFacilitatorId) || !isTeamMember) throw new RepositoryError('VALIDATION', 'The facilitator must be an active member of this team.');
    if (meeting.status === 'in-progress') {
      // A start/resume request from another screen is safe to repeat when the
      // meeting is already live and the facilitator is unchanged.
      if (meeting.facilitatorId === selectedFacilitatorId) return clone(meeting);
      assertExpectedVersion(meeting.version, expectedVersion);
      if (!canManageTeam(membership.role)) throw new RepositoryError('FORBIDDEN', 'Only a TeamLead or OrgAdmin can change the meeting facilitator.');
      const timestamp = nowIso();
      const previousFacilitatorId = meeting.facilitatorId;
      meeting.facilitatorId = selectedFacilitatorId;
      if (!meeting.attendeeIds.includes(selectedFacilitatorId)) meeting.attendeeIds = [...meeting.attendeeIds, selectedFacilitatorId];
      meeting.updatedAt = timestamp;
      meeting.updatedBy = actorId;
      meeting.version += 1;
      this.recordAudit(actorId, 'Changed L10 facilitator', meeting.id, `${previousFacilitatorId ?? 'No facilitator'} → ${selectedFacilitatorId}.`, 'meeting');
      return clone(meeting);
    }
    assertExpectedVersion(meeting.version, expectedVersion);
    const timestamp = nowIso();
    meeting.status = 'in-progress';
    meeting.startedAt = meeting.startedAt ?? timestamp;
    meeting.facilitatorId = selectedFacilitatorId;
    if (!meeting.attendeeIds.includes(selectedFacilitatorId)) meeting.attendeeIds = [...meeting.attendeeIds, selectedFacilitatorId];
    meeting.activeSection = meeting.activeSection ?? meetingSectionsFor(team)[0]?.id ?? 'conclude';
    meeting.activeSectionStartedAt = meeting.activeSectionStartedAt ?? timestamp;
    meeting.sectionDurations = meeting.sectionDurations ?? {};
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.recordAudit(actorId, 'Started L10 meeting', meeting.id, `${team.name} L10 started.`, 'meeting');
    return clone(meeting);
  }

  async updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status !== 'upcoming') throw new RepositoryError('CONFLICT', 'Only open upcoming meetings can be rescheduled.');
    const scheduledDate = normalizeDate(input.scheduledDate, 'Meeting date');
    assertText(input.scheduledTime, 'Meeting time');
    const scheduledTime = input.scheduledTime.trim();
    assertFutureMeetingSchedule(scheduledDate, scheduledTime);
    if (this.meetings.some((candidate) => candidate.id !== meeting.id && candidate.teamId === teamId && candidate.status === 'upcoming' && candidate.scheduledDate === scheduledDate && candidate.scheduledTime === scheduledTime)) throw new RepositoryError('CONFLICT', 'Another upcoming meeting already uses that date and time.');
    const timestamp = nowIso();
    Object.assign(meeting, {
      scheduledDate,
      scheduledTime,
      dateLabel: meetingDateLabel(scheduledDate),
      weekStartDate: weekStartDateFor(scheduledDate),
      updatedAt: timestamp,
      updatedBy: actorId,
      version: meeting.version + 1,
    });
    this.recordAudit(actorId, 'Updated meeting schedule', meeting.id, `Moved ${team.name} L10 to ${meeting.dateLabel} at ${scheduledTime}.`, 'meeting');
    return clone(meeting);
  }

  async closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number, attendeeRatings?: MeetingAttendeeRating[]) {
    const membership = this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status === 'closed') throw new RepositoryError('CONFLICT', 'This meeting is already closed.');
    if (meeting.status === 'skipped') throw new RepositoryError('CONFLICT', 'Skipped meetings cannot be closed.');
    const timestamp = nowIso();
    const sections = meetingSectionsFor(team);
    const teamRocks = this.rocks.filter((rock) => rock.teamId === teamId);
    const teamTasks = this.tasks.filter((task) => task.teamId === teamId);
    const teamTodos = this.todos.filter((todo) => todo.teamId === teamId);
    const teamIssues = this.issues.filter((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected');
    const ratings = attendeeRatings ?? [];
    if (attendeeRatings !== undefined && (!Array.isArray(attendeeRatings) || ratings.some((entry) => !entry || typeof entry.attendeeId !== 'string' || !isValidMeetingRating(entry.rating)))) throw new RepositoryError('VALIDATION', 'Each attendee rating must be a number from 0.5 to 10 in 0.5 increments.');
    if (attendeeRatings === undefined && (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 10)) throw new RepositoryError('VALIDATION', 'Meeting rating must be between 0 and 10.');
    if (attendeeRatings !== undefined && ratings.length !== meeting.attendeeIds.length) throw new RepositoryError('VALIDATION', 'Enter a rating for each recorded attendee before closing the meeting.');
    if (attendeeRatings !== undefined && !canManageTeam(membership.role) && actorId !== meeting.facilitatorId) throw new RepositoryError('FORBIDDEN', 'Only the meeting facilitator or a TeamLead can submit attendee ratings.');
    const attendeeIds = new Set(meeting.attendeeIds);
    if (new Set(ratings.map((entry) => entry.attendeeId)).size !== ratings.length || ratings.some((entry) => !attendeeIds.has(entry.attendeeId))) throw new RepositoryError('VALIDATION', 'Ratings must be supplied once for each recorded attendee.');
    finalizeMeetingTiming(meeting, timestamp);
    meeting.status = 'closed';
    meeting.closedAt = timestamp;
    meeting.agendaProgress = sections.length;
    meeting.agendaTotal = sections.length;
    meeting.idsTotal = meeting.idsIssueIds.length;
    meeting.idsSolved = meeting.idsIssueIds.filter((issueId) => teamIssues.find((issue) => issue.id === issueId)?.status === 'solved').length;
    meeting.lastRating = averageMeetingRating(ratings) ?? Math.min(10, Math.max(0, rating));
    if (attendeeRatings !== undefined) meeting.attendeeRatings = ratings.map((entry) => ({ ...entry }));
    meeting.actionSummary = meetingActionSummary(meeting, teamIssues);
    meeting.recap = meetingRecap(team, meeting, teamRocks, teamTasks, teamTodos, teamIssues, recap, this.metrics, this.scorecardResults, this.headlines);
    meeting.aiSummaryStatus = 'queued';
    meeting.aiSummaryRequestedAt = timestamp;
    meeting.aiSummarySource = 'close';
    meeting.aiSummaryJobId = meeting.aiSummaryJobId ?? `summary-${meeting.id}`;
    meeting.aiSummaryError = undefined;
    meeting.updatedAt = timestamp;
    meeting.updatedBy = actorId;
    meeting.version += 1;
    this.advanceIssueEscalations(team, meeting, timestamp);
    const carriedIssueIds = meeting.idsIssueIds.filter((issueId) => this.activeIssue(issueId)?.status !== 'solved');
    const contextSnapshot = meetingSummaryContext(team, meeting, teamRocks, teamTasks, teamTodos, teamIssues, this.metrics, this.scorecardResults, meetingHeadlinesFor(this.headlines, meeting));
    const existingJob = this.summaryJobs.find((job) => job.id === meeting.aiSummaryJobId);
    if (!existingJob) {
      this.summaryJobs.push({
        ...baseRecord(meeting.aiSummaryJobId, 'meetingSummaryJob', teamId),
        kind: 'meetingSummaryJob', teamId, meetingId: meeting.id, status: 'queued', attempt: 1, source: 'close', contextSnapshot, requestedAt: timestamp, updatedBy: actorId, environmentId: this.environmentId,
      });
    }
    this.ensureUpcomingMeetingWindow(team, carriedIssueIds, meeting);
    this.recordAudit(actorId, 'Closed L10 meeting', meeting.id, recap || 'Meeting closed without a recap.', 'meeting');
    return clone(meeting);
  }

  async skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note: string, actorId: string, expectedVersion?: number) {
    this.requireWrite(teamId, actorId);
    const team = this.team(teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status !== 'upcoming') throw new RepositoryError('CONFLICT', 'Only meetings that have not started can be skipped.');
    if (!['public-holiday', 'annual-leave', 'other'].includes(reason)) throw new RepositoryError('VALIDATION', 'Choose a valid skip reason.');
    const timestamp = nowIso();
    Object.assign(meeting, {
      status: 'skipped', skipReason: reason, skipNote: note.trim() || undefined, skippedAt: timestamp, skippedById: actorId, updatedAt: timestamp, updatedBy: actorId, version: meeting.version + 1,
    });
    this.ensureUpcomingMeetingWindow(team);
    this.recordAudit(actorId, 'Skipped L10 meeting', meeting.id, `${team.name} meeting skipped: ${reason}${note.trim() ? ` · ${note.trim()}` : ''}.`, 'meeting');
    return clone(meeting);
  }

  async requestMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number) {
    if (!this.canManageMeetingSummary(teamId, actorId)) throw new RepositoryError('FORBIDDEN', 'You do not have permission to generate this meeting summary.');
    const team = this.team(teamId);
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!team || !meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status !== 'closed') throw new RepositoryError('CONFLICT', 'AI summaries are available after a meeting is closed.');
    if (meeting.aiSummaryStatus === 'queued' || meeting.aiSummaryStatus === 'generating') return clone(meeting);
    const timestamp = nowIso();
    const existingJob = this.summaryJobs.find((job) => job.id === meeting.aiSummaryJobId);
    const source = existingJob?.source ?? meeting.aiSummarySource ?? (meeting.aiSummaryRequestedAt ? 'close' : 'legacy');
    const rocks = this.rocks.filter((rock) => rock.teamId === teamId);
    const tasks = this.tasks.filter((task) => task.teamId === teamId);
    const todos = this.todos.filter((todo) => todo.teamId === teamId);
    const issues = this.issues.filter((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected');
    const contextSnapshot = existingJob?.contextSnapshot ?? meetingSummaryContext(team, meeting, rocks, tasks, todos, issues, this.metrics, this.scorecardResults, meetingHeadlinesFor(this.headlines, meeting));
    const jobId = meeting.aiSummaryJobId ?? `summary-${meeting.id}`;
    const currentJob = this.summaryJobs.find((job) => job.id === jobId);
    const attempt = (currentJob?.attempt ?? 0) + 1;
    if (currentJob) {
      Object.assign(currentJob, { status: 'queued' as const, attempt, source, contextSnapshot, requestedAt: timestamp, startedAt: undefined, completedAt: undefined, lastError: undefined, updatedAt: timestamp, updatedBy: actorId, version: currentJob.version + 1 });
    } else {
      this.summaryJobs.push({ ...baseRecord(jobId, 'meetingSummaryJob', teamId), kind: 'meetingSummaryJob', teamId, meetingId: meeting.id, status: 'queued', attempt, source, contextSnapshot, requestedAt: timestamp, updatedBy: actorId, environmentId: this.environmentId });
    }
    Object.assign(meeting, { aiSummaryStatus: 'queued' as const, aiSummaryRequestedAt: timestamp, aiSummarySource: source, aiSummaryJobId: jobId, aiSummaryError: undefined, updatedAt: timestamp, updatedBy: actorId, version: meeting.version + 1 });
    this.recordAudit(actorId, 'Queued meeting AI summary', meeting.id, `${team.name} summary generation queued (${source}).`, 'meeting');
    return clone(meeting);
  }

  async cancelMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number) {
    if (!this.canManageMeetingSummary(teamId, actorId)) throw new RepositoryError('FORBIDDEN', 'You do not have permission to cancel this meeting summary.');
    const team = this.team(teamId);
    const meeting = this.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!team || !meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    assertExpectedVersion(meeting.version, expectedVersion);
    if (meeting.status !== 'closed') throw new RepositoryError('CONFLICT', 'AI summaries are available after a meeting is closed.');
    if (meeting.aiSummaryStatus === 'cancelled') return clone(meeting);
    if (meeting.aiSummaryStatus !== 'queued' && meeting.aiSummaryStatus !== 'generating') throw new RepositoryError('CONFLICT', 'Only a queued or generating AI summary can be cancelled.');

    const job = this.summaryJobs.find((candidate) => candidate.id === meeting.aiSummaryJobId);
    if (job && job.status !== 'queued' && job.status !== 'generating') throw new RepositoryError('CONFLICT', 'The AI summary job is no longer active. Refresh and try again.');
    const timestamp = nowIso();
    const cancellationMessage = 'AI recap generation was cancelled by the meeting editor.';
    if (job) Object.assign(job, { status: 'cancelled' as const, completedAt: timestamp, lastError: cancellationMessage, updatedAt: timestamp, updatedBy: actorId, version: job.version + 1 });
    Object.assign(meeting, { aiSummaryStatus: 'cancelled' as const, aiSummaryError: cancellationMessage, updatedAt: timestamp, updatedBy: actorId, version: meeting.version + 1 });
    this.recordAudit(actorId, 'Cancelled meeting AI summary', meeting.id, `${team.name} summary generation was cancelled.`, 'meeting');
    return clone(meeting);
  }

  async updateMeetingSummaryDispatch(jobId: string, status: 'generating' | 'failed', error: string | undefined, actorId: string) {
    const job = this.summaryJobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new RepositoryError('NOT_FOUND', 'Meeting summary job not found.');
    if (job.status === 'ready' || job.status === 'cancelled') return clone(job);
    const timestamp = nowIso();
    Object.assign(job, { status, startedAt: status === 'generating' ? (job.startedAt ?? timestamp) : job.startedAt, completedAt: status === 'failed' ? timestamp : undefined, lastError: error?.trim() || undefined, updatedAt: timestamp, updatedBy: actorId, version: job.version + 1 });
    const meeting = this.meetings.find((candidate) => candidate.id === job.meetingId && candidate.teamId === job.teamId);
    if (meeting) {
      Object.assign(meeting, { aiSummaryStatus: status, aiSummaryError: error?.trim() || undefined, updatedAt: timestamp, updatedBy: actorId, version: meeting.version + 1 });
      this.recordAudit(actorId, status === 'failed' ? 'Meeting AI summary failed' : 'Meeting AI summary started', meeting.id, error?.trim() || `${job.source} summary is being generated.`, 'meeting');
    }
    return clone(job);
  }

  async completeMeetingSummary(jobId: string, status: 'ready' | 'failed', summary: MeetingAiSummary | undefined, error: string | undefined, attempt?: number) {
    const job = this.summaryJobs.find((candidate) => candidate.id === jobId);
    if (!job) throw new RepositoryError('NOT_FOUND', 'Meeting summary job not found.');
    if (attempt !== undefined && job.attempt !== attempt) throw new RepositoryError('CONFLICT', 'This AI summary callback belongs to an older attempt.');
    const meeting = this.meetings.find((candidate) => candidate.id === job.meetingId && candidate.teamId === job.teamId);
    if (!meeting) throw new RepositoryError('NOT_FOUND', 'Meeting not found.');
    if (job.status === 'ready' || job.status === 'failed' || job.status === 'cancelled') throw new RepositoryError('CONFLICT', 'This AI summary job has already completed.');
    if (status === 'ready' && (!summary || typeof summary.executiveSummary !== 'string' || !summary.executiveSummary.trim() || !Array.isArray(summary.decisions) || !Array.isArray(summary.commitments) || !Array.isArray(summary.risks) || !Array.isArray(summary.nextFocus))) throw new RepositoryError('VALIDATION', 'A ready AI summary must include all structured sections.');
    const timestamp = nowIso();
    const normalizedSummary = status === 'ready' && summary ? { ...clone(summary), executiveSummary: summary.executiveSummary.trim(), decisions: summary.decisions.map((item) => String(item).trim()).filter(Boolean), commitments: summary.commitments.map((item) => String(item).trim()).filter(Boolean), risks: summary.risks.map((item) => String(item).trim()).filter(Boolean), nextFocus: summary.nextFocus.map((item) => String(item).trim()).filter(Boolean), generatedAt: summary.generatedAt || timestamp, source: job.source } : undefined;
    Object.assign(job, { status, completedAt: timestamp, lastError: error?.trim() || undefined, updatedAt: timestamp, updatedBy: 'ai-worker', version: job.version + 1 });
    Object.assign(meeting, { aiSummaryStatus: status, aiSummary: normalizedSummary, aiSummaryGeneratedAt: normalizedSummary?.generatedAt, aiSummaryError: error?.trim() || undefined, aiSummarySource: job.source, updatedAt: timestamp, updatedBy: 'ai-worker', version: meeting.version + 1 });
    this.recordAudit('ai-worker', status === 'ready' ? 'Stored meeting AI summary' : 'Meeting AI summary failed', meeting.id, status === 'ready' ? 'AI summary stored from the signed worker callback.' : (error?.trim() || 'The AI worker reported a failed summary.'), 'meeting');
    return clone(meeting);
  }

  async getAdminSnapshot(actorId: string): Promise<AdminSnapshot> {
    this.requireAdmin(actorId);
    return { teams: clone(this.teams), users: clone(this.users), memberships: clone(this.memberships), settings: { ...clone(this.settings), version: this.settingsVersion }, audit: clone(this.audit), etag: etagFor([...this.teams, ...this.users, ...this.memberships, ...this.audit]) };
  }

  async createTeam(input: CreateTeamInput, actorId: string) {
    this.requireAdmin(actorId);
    assertText(input.name, 'Team name');
    assertText(input.shortName, 'Team short name');
    const meetingCadence = input.meetingCadence ?? 'weekly';
    assertMeetingCadence(meetingCadence);
    assertMeetingConfiguration(meetingCadence, input.meetingDay ?? 'Monday', input.meetingTime ?? '9:00 AM');
    const meetingSections = validateMeetingSections(input.meetingSections);
    if (!input.parentTeamId && this.teams.some((team) => team.active)) throw new RepositoryError('VALIDATION', 'New teams must be placed under the Leadership Team.');
    if (input.parentTeamId && !this.team(input.parentTeamId)) throw new RepositoryError('NOT_FOUND', 'Parent team not found.');
    let teamId = input.teamId || idFor('team', input.shortName);
    if (this.teams.some((team) => team.teamId === teamId)) teamId = `${teamId}-${Date.now()}`;
    const team = makeTeam({ ...input, meetingSections, teamId, name: input.name, shortName: input.shortName, parentTeamId: input.parentTeamId, nodeType: input.nodeType });
    this.teams.push(team);
    if (team.nodeType === 'operational') {
      const sections = meetingSectionsFor(team);
      const scheduledDate = meetingDateFor(team);
      this.meetings.push({
        ...baseRecord(`meeting-${team.teamId}-current`, 'meeting', team.teamId),
        kind: 'meeting', teamId: team.teamId, label: `${team.shortName} L10`, dateLabel: meetingDateLabel(scheduledDate), scheduledDate, scheduledTime: team.meetingTime, status: 'upcoming',
        recurrenceDate: scheduledDate,
        weekStartDate: weekStartDateFor(scheduledDate),
        facilitatorId: team.escalationUserIds[0] ?? actorId, attendeeIds: [], lastRating: 0, agendaProgress: 0,
        agendaTotal: sections.length, idsSolved: 0, idsTotal: 0, recap: '', sectionNotes: {}, idsIssueIds: [], idsAddedIssueIds: [], createdTodoIds: [], idsNotes: [],
      });
      this.ensureUpcomingMeetingWindow(team);
    }
    this.recordAudit(actorId, 'Created team', teamId, `Created ${team.name} as a ${team.nodeType} node.`, 'team');
    return clone(team);
  }

  async updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number) {
    this.requireAdmin(actorId);
    const team = this.teams.find((item) => item.teamId === teamId);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    assertExpectedVersion(team.version, expectedVersion);
    if (input.parentTeamId === teamId) throw new RepositoryError('VALIDATION', 'A team cannot be its own parent.');
    if (teamId === 'leadership' && input.parentTeamId !== undefined && input.parentTeamId !== null) throw new RepositoryError('VALIDATION', 'Leadership Team must remain the hierarchy root.');
    if (teamId !== 'leadership' && input.parentTeamId === null) throw new RepositoryError('VALIDATION', 'Operational teams must remain under the Leadership Team hierarchy.');
    if (input.parentTeamId && !this.team(input.parentTeamId)) throw new RepositoryError('NOT_FOUND', 'Parent team not found.');
    const meetingCadence = input.meetingCadence ?? team.meetingCadence ?? 'weekly';
    assertMeetingCadence(meetingCadence);
    assertMeetingConfiguration(meetingCadence, input.meetingDay ?? team.meetingDay ?? 'Monday', input.meetingTime ?? team.meetingTime ?? '9:00 AM');
    const meetingSections = input.meetingSections === undefined ? undefined : validateMeetingSections(input.meetingSections);
    if (team.nodeType === 'operational' && input.nodeType === 'grouping' && (this.rocks.some((rock) => rock.teamId === teamId) || this.todos.some((todo) => todo.teamId === teamId) || this.issues.some((issue) => issue.teamId === teamId && issue.assignmentState !== 'redirected'))) {
      throw new RepositoryError('VALIDATION', 'Resolve active work before changing this node to grouping-only.');
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
    Object.assign(team, input, { meetingSections: meetingSections ? clone(meetingSections) : team.meetingSections, escalationUserIds: input.escalationUserIds ? [...input.escalationUserIds] : team.escalationUserIds, updatedAt: nowIso(), updatedBy: actorId, version: team.version + 1 });
    this.recordAudit(actorId, 'Updated team', teamId, `Updated ${team.name}.`, 'team');
    return clone(team);
  }

  async createUser(input: CreateUserInput, actorId: string) {
    this.requireAdmin(actorId);
    assertText(input.name, 'Name');
    assertText(input.email, 'Email');
    if (this.users.some((user) => user.email.toLowerCase() === input.email.toLowerCase())) throw new RepositoryError('CONFLICT', 'A user with that email already exists.');
    const requestedIdentityId = input.identityId?.trim();
    const identityId = requestedIdentityId ? normalizeObjectId(requestedIdentityId) : undefined;
    if (requestedIdentityId && !identityId) throw new RepositoryError('VALIDATION', 'identityId must be a valid Entra object ID.');
    let userId = identityId ?? idFor('user', input.email.split('@')[0]);
    if (this.users.some((user) => user.id === userId)) {
      if (identityId) throw new RepositoryError('CONFLICT', 'A user with that Entra identity already exists.');
      userId = `${userId}-${Date.now()}`;
    }
    const user = makeUser({ id: userId, name: input.name, email: input.email, accent: input.accent, platformAdmin: input.platformAdmin });
    this.users.push(user);
    this.recordAudit(actorId, identityId ? 'Created Entra-linked user' : 'Created local user', user.id, `Created the ${identityId ? 'Entra-linked' : 'local'} profile for ${user.name}.`, 'admin');
    return clone(user);
  }

  async updateUser(userId: string, input: UpdateUserInput, actorId: string, expectedVersion?: number) {
    this.requireAdmin(actorId);
    const user = this.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) throw new RepositoryError('NOT_FOUND', 'User not found.');
    if (input.name === undefined && input.email === undefined && input.platformAdmin === undefined) throw new RepositoryError('VALIDATION', 'At least one user field is required.');
    assertExpectedVersion(user.version, expectedVersion);
    if (input.name !== undefined) assertText(input.name, 'Name');
    if (input.email !== undefined) {
      assertText(input.email, 'Email');
      if (this.users.some((candidate) => candidate.id !== user.id && candidate.email.toLowerCase() === input.email!.trim().toLowerCase())) throw new RepositoryError('CONFLICT', 'A user with that email already exists.');
    }
    if (input.platformAdmin !== undefined && typeof input.platformAdmin !== 'boolean') throw new RepositoryError('VALIDATION', 'platformAdmin must be a boolean.');
    if (input.identityId !== undefined) {
      const identityId = normalizeObjectId(input.identityId);
      if (!identityId) throw new RepositoryError('VALIDATION', 'identityId must be a valid Entra object ID.');
      if (identityId !== user.id) throw new RepositoryError('CONFLICT', 'The email must belong to the same Entra identity as this user.');
    }
    const name = input.name?.trim() ?? user.name;
    const email = input.email?.trim() ?? user.email;
    const platformCapabilities: UserProfile['platformCapabilities'] = input.platformAdmin === undefined
      ? user.platformCapabilities
      : input.platformAdmin ? ['PlatformAdmin'] : [];
    Object.assign(user, {
      name,
      email,
      platformCapabilities,
      initials: input.name !== undefined ? name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : user.initials,
      updatedAt: nowIso(),
      updatedBy: actorId,
      version: user.version + 1,
    });
    this.recordAudit(actorId, 'Updated user', user.id, `Updated the profile for ${user.name}.`, 'admin');
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
    const connectionString = process.env.COSMOS_CONNECTION_STRING;
    const database = environmentId === 'live' ? (process.env.COSMOS_LIVE_DATABASE ?? process.env.COSMOS_DATABASE) : process.env.COSMOS_TEST_DATABASE;
    const containerName = environmentId === 'live' ? (process.env.COSMOS_LIVE_CONTAINER ?? process.env.COSMOS_CONTAINER) : process.env.COSMOS_TEST_CONTAINER;
    if (process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true') return null;
    if (!connectionString || !database || !containerName) return null;
    const client = new CosmosClient(connectionString);
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
      this.quarters = ofKind<QuarterRecord>('quarter');
      if (!this.quarters.length) this.quarters = defaultQuarterRecords();
      this.teams = ofKind<TeamRecord>('team');
      this.users = ofKind<UserProfile>('user');
      this.memberships = ofKind<TeamMembership>('teamMembership');
      this.rocks = ofKind<RockRecord>('rock').map((rock) => {
        const next = { ...rock } as RockRecord & { progress?: unknown };
        delete next.progress;
        return next;
      });
      this.tasks = ofKind<RockTaskRecord>('rockTask');
      this.todos = ofKind<TodoRecord>('todo');
      this.issues = ofKind<IssueRecord>('issue');
      this.transfers = ofKind<IssueTransferRecord>('issueTransfer');
      this.notifications = ofKind<NotificationRecord>('notification');
      this.messages = ofKind<TeamMessageRecord>('message');
      this.headlines = ofKind<HeadlineRecord>('headline');
      this.meetings = ofKind<MeetingRecord>('meeting');
      this.summaryJobs = ofKind<MeetingSummaryJobRecord>('meetingSummaryJob');
      this.metrics = ofKind<ScorecardMetricRecord>('scorecardMetric');
      this.scorecardResults = ofKind<ScorecardResultRecord>('scorecardResult');
      this.vtos = ofKind<VtoRecord>('vto');
      this.vtoVersions = ofKind<VtoVersionRecord>('vtoVersion');
      this.audit = ofKind<AuditEventRecord>('auditEvent');
      this.settingsRecord = ofKind<IssueAgeSettingsRecord>('issueAgeSettings')[0];
      this.settings = this.settingsRecord ? { agingDays: this.settingsRecord.agingDays, staleDays: this.settingsRecord.staleDays, criticalDays: this.settingsRecord.criticalDays, version: this.settingsRecord.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
      this.settingsVersion = this.settingsRecord?.version ?? 1;
      this.refreshDerivedState();
      const meetingIdsBeforeWindow = new Set(this.meetings.map((meeting) => meeting.id));
      this.maintainMeetingWindows();
      const generatedMeetings = this.meetings.filter((meeting) => !meetingIdsBeforeWindow.has(meeting.id));
      if (generatedMeetings.length) await this.persistRecords(generatedMeetings);
      this.loaded = true;
    })();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private allRecords(): WorkspaceRecord[] {
    const records: WorkspaceRecord[] = [...this.quarters, ...this.teams, ...this.users, ...this.memberships, ...this.rocks, ...this.tasks, ...this.todos, ...this.issues, ...this.transfers, ...this.notifications, ...this.messages, ...this.headlines, ...this.meetings, ...this.summaryJobs, ...this.metrics, ...this.scorecardResults, ...this.vtos, ...this.vtoVersions, ...this.audit];
    if (this.settingsRecord) records.push(this.settingsRecord);
    return records;
  }

  private async maintainMeetingWindowsAndPersist() {
    await this.ensureLoaded();
    const existingMeetingIds = new Set(this.meetings.map((meeting) => meeting.id));
    this.maintainMeetingWindows();
    const generatedMeetings = this.meetings.filter((meeting) => !existingMeetingIds.has(meeting.id));
    if (!generatedMeetings.length) return;
    try {
      await this.persistRecords(generatedMeetings);
    } catch (error) {
      this.loaded = false;
      throw error;
    }
  }

  private async refreshMeetingRecord(teamId: string, meetingId: string) {
    const fresh = (await this.teamRecords<MeetingRecord>(teamId, 'meeting')).find((meeting) => meeting.id === meetingId);
    if (!fresh) return;
    const team = this.teams.find((candidate) => candidate.teamId === teamId);
    const normalized = normalizedMeeting(team, fresh);
    const index = this.meetings.findIndex((meeting) => meeting.id === meetingId && meeting.teamId === teamId);
    if (index >= 0) this.meetings[index] = normalized;
    else this.meetings.push(normalized);
  }

  private recordKey(record: WorkspaceRecord) {
    return `${record.pk}:${record.id}`;
  }

  private payload(record: WorkspaceRecord) {
    const payload = { ...record, environmentId: this.environmentId } as WorkspaceRecord & { _etag?: string; progress?: unknown };
    delete payload.cosmosEtag;
    delete payload._etag;
    if (record.kind === 'rock') delete payload.progress;
    return payload;
  }

  /** Keep Cosmos concurrency tokens inside the repository boundary. */
  private publicValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => this.publicValue(item)) as T;
    if (value && typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (key !== 'cosmosEtag' && key !== 'category' && key !== 'progress') output[key] = this.publicValue(item);
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

  private async deleteSingle(record: WorkspaceRecord) {
    try {
      await this.container.item(record.id, record.pk).delete(record.cosmosEtag ? { accessCondition: { type: 'IfMatch', condition: record.cosmosEtag } } : undefined);
    } catch (error) {
      const statusCode = (error as { statusCode?: number; code?: number }).statusCode ?? (error as { code?: number }).code;
      if (statusCode === 404 || statusCode === 412) throw new RepositoryError('CONFLICT', 'The record changed or was deleted elsewhere. Refresh and try again.');
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
        if (failed.statusCode === 409) throw new RepositoryError('CONFLICT', 'One or more records already exist. Refresh and try again.');
        throw new CosmosBatchError(failed.statusCode, 'Cosmos rejected the transactional workspace update.');
      }
      response.result?.forEach((item, index) => {
        if (item.eTag) records[index].cosmosEtag = item.eTag;
      });
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if ((error as { code?: number }).code === 412) throw new RepositoryError('CONFLICT', 'One or more records changed elsewhere. Refresh and try again.');
      const statusCode = (error as { statusCode?: number; code?: number }).statusCode ?? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : undefined);
      if (statusCode === 400 || statusCode === 405) throw new CosmosBatchError(statusCode, 'Cosmos rejected the transactional workspace update.');
      throw error;
    }
  }

  private async persistRecords(records: WorkspaceRecord[]) {
    const byPartition = new Map<string, WorkspaceRecord[]>();
    for (const record of records) byPartition.set(record.pk, [...(byPartition.get(record.pk) ?? []), record]);
    for (const partitionRecords of byPartition.values()) {
      if (partitionRecords.length > 1 && partitionRecords.length <= 100) {
        try {
          await this.writeBatch(partitionRecords);
        } catch (error) {
          // Some existing Cosmos containers reject transactional batches even
          // though ordinary item writes are supported. New records have no
          // ETag yet, so retrying those rejected creates individually is safe;
          // concurrency failures still surface to the caller.
          if (error instanceof CosmosBatchError && (error.statusCode === 400 || error.statusCode === 405) && partitionRecords.every((record) => !record.cosmosEtag)) {
            for (const record of partitionRecords) await this.writeSingle(record);
          } else {
            throw error;
          }
        }
      } else for (const record of partitionRecords) await this.writeSingle(record);
    }
  }

  private syncSettingsRecord(actorId: string) {
    if (!this.settingsRecord) this.settingsRecord = { ...baseRecord('issue-age-settings', 'issueAgeSettings'), kind: 'issueAgeSettings', agingDays: this.settings.agingDays, staleDays: this.settings.staleDays, criticalDays: this.settings.criticalDays };
    Object.assign(this.settingsRecord, { agingDays: this.settings.agingDays, staleDays: this.settings.staleDays, criticalDays: this.settings.criticalDays, version: this.settings.version ?? this.settingsVersion, updatedAt: nowIso(), updatedBy: actorId, environmentId: this.environmentId });
  }

  private async withMutation<T>(actorId: string, mutation: () => Promise<T>): Promise<T> {
    await this.maintainMeetingWindowsAndPersist();
    const beforeRecords = new Map(this.allRecords().map((record) => [this.recordKey(record), record]));
    const before = new Map([...beforeRecords].map(([key, record]) => [key, JSON.stringify(this.payload(record))]));
    const settingsBefore = JSON.stringify(this.settings);
    try {
      const result = await mutation();
      if (settingsBefore !== JSON.stringify(this.settings)) this.syncSettingsRecord(actorId);
      const afterRecords = this.allRecords();
      const changed = afterRecords.filter((record) => before.get(this.recordKey(record)) !== JSON.stringify(this.payload(record)));
      const afterKeys = new Set(afterRecords.map((record) => this.recordKey(record)));
      const deleted = [...beforeRecords.values()].filter((record) => !afterKeys.has(this.recordKey(record)));
      await this.persistRecords(changed);
      for (const record of deleted) await this.deleteSingle(record);
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
    const descendants = (teamId: string): string[] => teams.filter((team) => team.parentTeamId === teamId).flatMap((child) => [child.teamId, ...descendants(child.teamId)]);
    const teamIds = leadershipVisible ? teams.map((team) => team.teamId) : ownMemberships.flatMap((membership) => [membership.teamId, ...(membership.role === 'TeamLead' || membership.role === 'OrgAdmin' ? descendants(membership.teamId) : [])]);
    return this.publicValue({ user: clone(user), memberships: clone(ownMemberships.map(({ teamId, role, active }) => ({ teamId, role, active }))), leadershipVisible, platformAdmin: canAdministerPlatform(user.platformCapabilities) || ownMemberships.some((membership) => membership.teamId === 'leadership' && membership.role === 'OrgAdmin'), teams: clone(teams.filter((team) => teamIds.includes(team.teamId) && team.active).map(({ teamId, name, shortName, parentTeamId, nodeType, active }) => ({ teamId, name, shortName, parentTeamId, nodeType, active }))), currentEnvironment: this.environmentId } satisfies SessionContext);
  }

  private async ageSettings() {
    const records = await this.orgRecords<IssueAgeSettingsRecord>('issueAgeSettings');
    const record = records[0];
    return record ? { agingDays: record.agingDays, staleDays: record.staleDays, criticalDays: record.criticalDays, version: record.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
  }

  async getTeamDashboard(teamId: string, userId?: string) {
    await this.maintainMeetingWindowsAndPersist();
    if (!this.team(teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    if (userId) this.requireRead(teamId, userId);
    const settings = await this.ageSettings();
    const [rocks, todos, issues] = await Promise.all([this.teamRecords<RockRecord>(teamId, 'rock'), this.teamRecords<TodoRecord>(teamId, 'todo'), this.teamRecords<IssueRecord>(teamId, 'issue')]);
    return dashboardFor(teamId, rocks.map((rock) => ({ ...rock, notes: sanitizeRichText(rock.notes) })), todos, issues.map((issue) => issueAge({ ...issue, detail: sanitizeRichText(issue.detail) }, settings)));
  }

  async getTeamWorkspace(teamId: string, userId: string): Promise<TeamWorkspace> {
    await this.maintainMeetingWindowsAndPersist();
    if (!this.team(teamId)) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    this.requireRead(teamId, userId);
    const [team, membership, rocks, tasks, todos, issues, transfers, notifications, messages, meetings, metrics, scorecardResults, headlines, settings, vto, vtoVersions] = await Promise.all([
      this.orgRecords<TeamRecord>('team').then((items) => items.find((item) => item.teamId === teamId && item.active) ?? null),
      this.getTeamMembership(teamId, userId),
      this.teamRecords<RockRecord>(teamId, 'rock'), this.teamRecords<RockTaskRecord>(teamId, 'rockTask'), this.teamRecords<TodoRecord>(teamId, 'todo'), this.teamRecords<IssueRecord>(teamId, 'issue'), this.orgRecords<IssueTransferRecord>('issueTransfer'), this.orgRecords<NotificationRecord>('notification'),
      this.orgRecords<TeamMessageRecord>('message'), this.teamRecords<MeetingRecord>(teamId, 'meeting'), this.teamRecords<ScorecardMetricRecord>(teamId, 'scorecardMetric'), this.teamRecords<ScorecardResultRecord>(teamId, 'scorecardResult'),
      this.orgRecords<HeadlineRecord>('headline'), this.ageSettings(),
      this.teamRecords<VtoRecord>(teamId, 'vto').then((items) => items[0] ?? null), this.teamRecords<VtoVersionRecord>(teamId, 'vtoVersion'),
    ]);
    if (!team) throw new RepositoryError('NOT_FOUND', 'Team not found.');
    const teamRocks = rocks.map((rock) => ({ ...rock, notes: sanitizeRichText(rock.notes) }));
    const teamIssues = issues.filter((issue) => issue.assignmentState !== 'redirected').map((issue) => issueAge({ ...issue, detail: sanitizeRichText(issue.detail), idsNote: issue.idsNote ? sanitizeRichText(issue.idsNote) : undefined }, settings));
    const teamTransfers = transfers.filter((transfer) => transfer.sourceTeamId === teamId || transfer.destinationTeamId === teamId);
    const teamNotifications = notifications.filter((notification) => notification.recipientUserId === userId && (!notification.teamId || notification.teamId === teamId));
    const teamMessages = messages.filter((message) => message.fromTeamId === teamId || message.toTeamId === teamId);
    const teamHeadlines = headlines.filter((headline) => headline.teamId === teamId).map((headline) => ({ ...headline, detail: sanitizeRichText(headline.detail) }));
    const normalizedMeetings = meetings.map((meeting) => normalizedMeeting(team, meeting));
    return this.publicValue({ environmentId: this.environmentId, team: clone(team), membership: membership ? { teamId, role: membership.role, active: membership.active } : null, dashboard: dashboardFor(teamId, teamRocks, todos, teamIssues), rocks: clone(teamRocks), tasks: clone(tasks), todos: clone(todos), issues: clone(teamIssues), transfers: clone(teamTransfers), notifications: clone(teamNotifications), messages: clone(teamMessages), meetings: clone(normalizedMeetings), metrics: clone(metrics), scorecardResults: clone(scorecardResults), headlines: clone(teamHeadlines), vto: clone(vto), vtoVersions: clone(vtoVersions), etag: etagFor([...teamRocks, ...tasks, ...todos, ...teamIssues, ...teamTransfers, ...teamMessages, ...normalizedMeetings, ...metrics, ...scorecardResults, ...teamHeadlines, ...(vto ? [vto] : []), ...vtoVersions]) });
  }

  async getVto(teamId: string, userId: string) {
    await this.ensureLoaded();
    return this.publicValue(await super.getVto(teamId, userId));
  }

  async getWorkspaceSnapshot(userId: string, quarterId?: string): Promise<WorkspaceSnapshot> {
    const session = await this.getSessionContext(userId);
    if (!session) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    const teamWorkspaces = await Promise.all(session.teams.map((team) => this.getTeamWorkspace(team.teamId, userId)));
    const unique = <T extends WorkspaceRecord>(items: T[]) => [...new Map(items.map((item) => [`${item.pk}:${item.id}`, item])).values()];
    const users = await this.orgRecords<UserProfile>('user');
    const memberships = await this.orgRecords<TeamMembership>('teamMembership');
    const settings = await this.ageSettings();
    const [headlines, audit] = await Promise.all([
      this.orgRecords<HeadlineRecord>('headline'),
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
    const metrics = unique(teamWorkspaces.flatMap((workspace) => workspace.metrics));
    const vtos = unique(teamWorkspaces.flatMap((workspace) => workspace.vto ? [workspace.vto] : []));
    const vtoVersions = unique(teamWorkspaces.flatMap((workspace) => workspace.vtoVersions));
    const visibleTeamIds = new Set(teams.map((team) => team.teamId));
    const scorecardResults = unique(teamWorkspaces.flatMap((workspace) => workspace.scorecardResults));
    const quarters = this.quarters.map((quarter) => quarterSummary(quarter));
    const selectedQuarter = quarters.find((quarter) => quarter.id === (quarterId ?? currentQuarterId(quarters)));
    if (!selectedQuarter) throw new RepositoryError('VALIDATION', 'The selected quarter does not exist.');
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
      metrics: clone(metrics.filter((metric) => visibleTeamIds.has(metric.teamId))),
      scorecardResults: clone(scorecardResults.filter((result) => visibleTeamIds.has(result.teamId))),
      headlines: clone(headlines.filter((headline) => visibleTeamIds.has(headline.teamId ?? ''))),
      audit: clone(audit),
      quarters: clone(quarters),
      vtos: clone(vtos.filter((vto) => visibleTeamIds.has(vto.teamId))),
      vtoVersions: clone(vtoVersions.filter((version) => visibleTeamIds.has(version.teamId))),
      quarter: clone(selectedQuarter),
      etag: etagFor([...this.quarters, ...teams, ...users, ...memberships, ...rocks, ...tasks, ...todos, ...issues, ...transfers, ...notifications, ...messages, ...meetings, ...metrics, ...scorecardResults, ...headlines, ...vtos, ...vtoVersions, ...audit]),
    });
  }

  async getMeetingReview(userId: string, query: MeetingReviewQuery = {}) {
    await this.maintainMeetingWindowsAndPersist();
    return this.publicValue(await super.getMeetingReview(userId, query));
  }

  async saveVto(teamId: string, input: SaveVtoInput, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.saveVto(teamId, input, actorId, expectedVersion)); }
  async createHistoricalMeeting(input: CreateHistoricalMeetingInput, actorId: string) { return this.withMutation(actorId, () => super.createHistoricalMeeting(input, actorId)); }

  async getMeeting(teamId: string, meetingId: string, userId: string) {
    await this.maintainMeetingWindowsAndPersist();
    this.requireRead(teamId, userId);
    await this.refreshMeetingRecord(teamId, meetingId);
    return this.publicValue(await super.getMeeting(teamId, meetingId, userId));
  }

  async getMeetingSummaryJob(teamId: string, meetingId: string, userId: string) {
    await this.maintainMeetingWindowsAndPersist();
    return this.publicValue(await super.getMeetingSummaryJob(teamId, meetingId, userId));
  }

  async getCompanyOverview(userId: string) {
    const context = await this.getSessionContext(userId);
    if (!context?.leadershipVisible) throw new RepositoryError('FORBIDDEN', 'Leadership membership is required for company visibility.');
    const teams = await this.getTeams();
    const groups = await Promise.all(teams.map(async (team) => Promise.all([this.teamRecords<RockRecord>(team.teamId, 'rock'), this.teamRecords<TodoRecord>(team.teamId, 'todo'), this.teamRecords<IssueRecord>(team.teamId, 'issue')])));
    const rocks = groups.flatMap((group) => group[0]).map((rock) => ({ ...rock, notes: sanitizeRichText(rock.notes) }));
    const todos = groups.flatMap((group) => group[1]);
    const issues = groups.flatMap((group) => group[2]).map((issue) => ({ ...issue, detail: sanitizeRichText(issue.detail) }));
    const settings = await this.ageSettings();
    const activeIssues = issues.filter((issue) => issue.assignmentState !== 'redirected').map((issue) => issueAge(issue, settings));
    const descendants = (teamId: string): string[] => teams.filter((team) => team.parentTeamId === teamId).flatMap((child) => [child.teamId, ...descendants(child.teamId)]);
    const rollups = teams.map((team) => {
      const childIds = descendants(team.teamId);
      const directRocks = rocks.filter((rock) => rock.teamId === team.teamId);
      const directTodos = todos.filter((todo) => todo.teamId === team.teamId);
      const directIssues = activeIssues.filter((issue) => issue.teamId === team.teamId);
      return { teamId: team.teamId, direct: { rocks: { total: directRocks.length, onTrack: directRocks.filter((rock) => rock.status === 'on-track').length, offTrack: directRocks.filter((rock) => rock.status === 'off-track').length, complete: directRocks.filter((rock) => rock.status === 'complete').length }, todos: { total: directTodos.length, open: directTodos.filter((todo) => todo.status === 'open').length, done: directTodos.filter((todo) => todo.status === 'done').length, notDone: directTodos.filter((todo) => todo.status === 'not-done').length }, issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, neutral: directIssues.filter((issue) => issue.meetingBand === 'neutral').length, green: directIssues.filter((issue) => issue.meetingBand === 'green').length, yellow: directIssues.filter((issue) => issue.meetingBand === 'yellow').length, orange: directIssues.filter((issue) => issue.meetingBand === 'orange').length, red: directIssues.filter((issue) => issue.meetingBand === 'red').length } }, descendants: { rocks: rocks.filter((rock) => childIds.includes(rock.teamId)).length, todos: todos.filter((todo) => childIds.includes(todo.teamId)).length, issues: activeIssues.filter((issue) => childIds.includes(issue.teamId)).length } };
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
  async updateRock(rockId: string, input: Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateRock(rockId, input, actorId, expectedVersion)); }
  async updateTodoStatus(todoId: string, status: TodoRecord['status'], actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTodoStatus(todoId, status, actorId, expectedVersion)); }
  async updateTodo(todoId: string, input: Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTodo(todoId, input, actorId, expectedVersion)); }
  async addTodoChecklistItem(todoId: string, text: string, supporterId: string | undefined, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.addTodoChecklistItem(todoId, text, supporterId, actorId, expectedVersion)); }
  async updateTodoChecklistItem(todoId: string, itemId: string, input: UpdateTodoChecklistItemInput, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTodoChecklistItem(todoId, itemId, input, actorId, expectedVersion)); }
  async deleteTodoChecklistItem(todoId: string, itemId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.deleteTodoChecklistItem(todoId, itemId, actorId, expectedVersion)); }
  async createScorecardMetric(input: { teamId: string; label: string; target: string; unit: string; ownerId: string }, actorId: string) { return this.withMutation(actorId, () => super.createScorecardMetric(input, actorId)); }
  async updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetricRecord, 'label' | 'target' | 'unit' | 'ownerId'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateScorecardMetric(metricId, input, actorId, expectedVersion)); }
  async upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResultRecord, 'actual' | 'status'>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.upsertScorecardResult(metricId, weekStartDate, input, actorId, expectedVersion)); }
  async createIssue(input: CreateIssueInput, actorId: string) { return this.withMutation(actorId, () => super.createIssue(input, actorId)); }
  async createHeadline(input: CreateHeadlineInput, actorId: string) { return this.withMutation(actorId, () => super.createHeadline(input, actorId)); }
  async createIssueFromScorecard(metricId: string, weekStartDate: string, actorId: string, expectedVersion?: number) {
    try {
      return await this.withMutation(actorId, () => super.createIssueFromScorecard(metricId, weekStartDate, actorId, expectedVersion));
    } catch (error) {
      // The conversion ID is deterministic. If another API instance won the
      // create race, return its Issue so a retried action remains idempotent.
      // Preserve a genuine source-record ETag conflict when the result also
      // changed while the create was being attempted.
      if (error instanceof RepositoryError && error.code === 'CONFLICT') {
        await this.ensureLoaded();
        const result = this.scorecardResults.find((candidate) => candidate.metricId === metricId && candidate.weekStartDate === weekStartDate);
        const existing = this.issues.find((issue) => issue.teamId === result?.teamId && issue.assignmentState !== 'redirected' && issue.linkedScorecardMetricId === metricId && issue.linkedScorecardWeekStartDate === weekStartDate);
        if (existing && (expectedVersion === undefined || result?.version === expectedVersion)) return clone(issueAge(existing, this.settings));
      }
      throw error;
    }
  }
  async createIssueFromRock(rockId: string, actorId: string, expectedVersion?: number) {
    try {
      return await this.withMutation(actorId, () => super.createIssueFromRock(rockId, actorId, expectedVersion));
    } catch (error) {
      if (error instanceof RepositoryError && error.code === 'CONFLICT') {
        await this.ensureLoaded();
        const rock = this.rocks.find((candidate) => candidate.id === rockId);
        const existing = this.issues.find((issue) => issue.teamId === rock?.teamId && issue.assignmentState !== 'redirected' && issue.linkedRockId === rockId);
        if (existing && (expectedVersion === undefined || rock?.version === expectedVersion)) return clone(issueAge(existing, this.settings));
      }
      throw error;
    }
  }
  async updateIssue(issueId: string, input: Partial<Pick<IssueRecord, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateIssue(issueId, input, actorId, expectedVersion)); }
  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.addMeetingIssueNote(issueId, meetingId, note, actorId, expectedVersion)); }
  async updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateMeetingSectionNote(teamId, meetingId, section, note, actorId, expectedVersion)); }
  async setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.setMeetingIssueSelection(teamId, meetingId, issueIds, actorId, expectedVersion)); }
  async reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.reorderMeetingIssues(teamId, meetingId, issueIds, actorId, expectedVersion)); }
  async transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.transitionMeetingSection(teamId, meetingId, fromSection, toSection, actorId, expectedVersion)); }
  async startMeeting(teamId: string, meetingId: string, actorId: string, expectedVersion?: number, facilitatorId?: string) {
    // The meeting can be displayed on a control screen and a live screen at
    // the same time. Read the current occurrence before checking its ETag so
    // a stale process-local cache does not turn a harmless resume into a
    // false "changed elsewhere" conflict.
    await this.maintainMeetingWindowsAndPersist();
    this.requireWrite(teamId, actorId);
    await this.refreshMeetingRecord(teamId, meetingId);
    try {
      return await this.withMutation(actorId, () => super.startMeeting(teamId, meetingId, actorId, expectedVersion, facilitatorId));
    } catch (error) {
      // Two screens can submit the first start at nearly the same time. If
      // this write lost that race, accept the already-live record when the
      // request did not ask to replace its facilitator.
      if (error instanceof RepositoryError && error.code === 'CONFLICT') {
        try {
          await this.maintainMeetingWindowsAndPersist();
          await this.refreshMeetingRecord(teamId, meetingId);
          const current = this.meetings.find((meeting) => meeting.id === meetingId && meeting.teamId === teamId);
          if (current?.status === 'in-progress' && current.facilitatorId && (!facilitatorId || current.facilitatorId === facilitatorId)) return this.publicValue(clone(current));
        } catch {
          // Preserve the original conflict if the recovery read is not
          // available.
        }
      }
      throw error;
    }
  }
  async updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateMeetingSchedule(teamId, meetingId, input, actorId, expectedVersion)); }
  async skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.skipMeeting(teamId, meetingId, reason, note, actorId, expectedVersion)); }
  async requestMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.requestMeetingSummary(teamId, meetingId, actorId, expectedVersion)); }
  async cancelMeetingSummary(teamId: string, meetingId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.cancelMeetingSummary(teamId, meetingId, actorId, expectedVersion)); }
  async updateMeetingSummaryDispatch(jobId: string, status: 'generating' | 'failed', error: string | undefined, actorId: string) { return this.withMutation(actorId, () => super.updateMeetingSummaryDispatch(jobId, status, error, actorId)); }
  async completeMeetingSummary(jobId: string, status: 'ready' | 'failed', summary: MeetingAiSummary | undefined, error: string | undefined, attempt?: number) { return this.withMutation('ai-worker', () => super.completeMeetingSummary(jobId, status, summary, error, attempt)); }
  async startIssue(issueId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.startIssue(issueId, actorId, expectedVersion)); }
  async parkIssue(issueId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.parkIssue(issueId, actorId, expectedVersion)); }
  async solveIssue(issueId: string, input: SolveIssueInput, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.solveIssue(issueId, input, actorId, expectedVersion)); }
  async reopenIssue(issueId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.reopenIssue(issueId, actorId, expectedVersion)); }
  async createRock(input: { teamId: string; quarterId?: string; title: string; description?: string; notes?: string; ownerId: string; dueDate?: string; priority?: RockRecord['priority'] }, actorId: string) { return this.withMutation(actorId, () => super.createRock(input, actorId)); }
  async createTodo(input: CreateTodoInput, actorId: string) { return this.withMutation(actorId, () => super.createTodo(input, actorId)); }
  async createRockTask(input: { rockId: string; title: string; notes?: string; assigneeId: string; assignedAt: string; startDate: string; dueDate: string }, actorId: string) { return this.withMutation(actorId, () => super.createRockTask(input, actorId)); }
  async updateRockTask(taskId: string, input: Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateRockTask(taskId, input, actorId, expectedVersion)); }
  async deleteRockTask(taskId: string, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.deleteRockTask(taskId, actorId, expectedVersion)); }
  async convertRockTaskToTodo(taskId: string, actorId: string) { return this.withMutation(actorId, () => super.convertRockTaskToTodo(taskId, actorId)); }
  async getIssue(issueId: string, userId: string) {
    const context = await this.getSessionContext(userId);
    if (!context) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    const candidateTeams = context.leadershipVisible ? (await this.getTeams()).map((team) => team.teamId) : context.teams.map((team) => team.teamId);
    const records = (await Promise.all(candidateTeams.map((teamId) => this.teamRecords<IssueRecord>(teamId, 'issue')))).flat();
    const issue = records.find((item) => item.id === issueId && item.assignmentState !== 'redirected');
    if (!issue) throw new RepositoryError('NOT_FOUND', 'Issue not found.');
    return this.publicValue(issueAge({ ...issue, detail: sanitizeRichText(issue.detail) }, await this.ageSettings()));
  }
  async getAuditTrail(entityType: AuditEntityType, entityId: string, userId: string) {
    await this.ensureLoaded();
    const target = this.auditTarget(entityType, entityId);
    this.requireRead(target.teamId, userId);
    const eventTypes = new Set(this.auditEventTypes(entityType));
    const events = await this.query<AuditEventRecord>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = @kind AND c.target = @target', [
      { name: '@pk', value: 'org' },
      { name: '@kind', value: 'auditEvent' },
      { name: '@target', value: entityId },
    ], 'org');
    return this.publicValue(clone(events
      .filter((event) => eventTypes.has(event.eventType))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))));
  }
  async getIssueTransfer(transferId: string) { const records = await this.orgRecords<IssueTransferRecord>('issueTransfer'); const transfer = records.find((item) => item.id === transferId); if (!transfer) throw new RepositoryError('NOT_FOUND', 'Issue transfer not found.'); return this.publicValue(transfer); }
  async requestIssueTransfer(input: { issueId: string; destinationTeamId: string; requestedById: string; note?: string; idempotencyKey?: string }) { return this.withMutation(input.requestedById, () => super.requestIssueTransfer(input)); }
  async acceptIssueTransfer(transferId: string, decidedById: string, expectedVersion?: number) { return this.withMutation(decidedById, () => super.acceptIssueTransfer(transferId, decidedById, expectedVersion)); }
  async rejectIssueTransfer(transferId: string, decidedById: string, message: string, expectedVersion?: number) { return this.withMutation(decidedById, () => super.rejectIssueTransfer(transferId, decidedById, message, expectedVersion)); }
  async cancelIssueTransfer(transferId: string, cancelledById: string, expectedVersion?: number) { return this.withMutation(cancelledById, () => super.cancelIssueTransfer(transferId, cancelledById, expectedVersion)); }
  async sendTeamMessage(input: { fromTeamId: string; toTeamId: string; subject: string; body: string; senderId: string }) { return this.withMutation(input.senderId, () => super.sendTeamMessage(input)); }
  async markMessageRead(messageId: string, userId: string, expectedVersion?: number) { return this.withMutation(userId, () => super.markMessageRead(messageId, userId, expectedVersion)); }
  async createIssueFromMessage(input: { messageId: string; title: string; detail: string; priority?: number; horizon?: IssueRecord['horizon']; ownerId?: string }, actorId: string) { return this.withMutation(actorId, () => super.createIssueFromMessage(input, actorId)); }
  async closeMeeting(teamId: string, meetingId: string, recap: string, rating: number, actorId: string, expectedVersion?: number, attendeeRatings?: MeetingAttendeeRating[]) { return this.withMutation(actorId, () => super.closeMeeting(teamId, meetingId, recap, rating, actorId, expectedVersion, attendeeRatings)); }
  async getAdminSnapshot(actorId: string): Promise<AdminSnapshot> {
    const actor = await this.getUser(actorId);
    if (!actor) throw new RepositoryError('FORBIDDEN', 'The user is not active in this organization.');
    if (!canAdministerPlatform(actor.platformCapabilities) && (await this.getLeadershipMembership(actorId))?.role !== 'OrgAdmin') throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required.');
    const [teams, users, memberships, settingsRecords, audit] = await Promise.all([this.getTeams(), this.orgRecords<UserProfile>('user'), this.orgRecords<TeamMembership>('teamMembership'), this.orgRecords<IssueAgeSettingsRecord>('issueAgeSettings'), this.orgRecords<AuditEventRecord>('auditEvent')]);
    const settingsRecord = settingsRecords[0];
    const settings = settingsRecord ? { agingDays: settingsRecord.agingDays, staleDays: settingsRecord.staleDays, criticalDays: settingsRecord.criticalDays, version: settingsRecord.version } : clone(DEFAULT_ISSUE_AGE_SETTINGS);
    return this.publicValue({ teams, users: clone(users.filter((user) => user.active)), memberships: clone(memberships.filter((membership) => membership.active)), settings, audit: clone(audit), etag: etagFor([...teams, ...users, ...memberships, ...audit, ...(settingsRecord ? [settingsRecord] : [])]) });
  }
  async createTeam(input: CreateTeamInput, actorId: string) { return this.withMutation(actorId, () => super.createTeam(input, actorId)); }
  async updateTeam(teamId: string, input: Partial<Pick<TeamRecord, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds' | 'active'>>, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateTeam(teamId, input, actorId, expectedVersion)); }
  async createUser(input: CreateUserInput, actorId: string) { return this.withMutation(actorId, () => super.createUser(input, actorId)); }
  async updateUser(userId: string, input: UpdateUserInput, actorId: string, expectedVersion?: number) { return this.withMutation(actorId, () => super.updateUser(userId, input, actorId, expectedVersion)); }
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
