import { defaultAgeBand, initialWorkspace, testWorkspace } from './data';
import { averageMeetingRating, defaultMeetingSections, isValidMeetingRating, meetingDateFor, meetingDateLabel, meetingReviewStatus, meetingScheduledAt, meetingSectionConfigsFor, meetingSectionsFor, nextConfiguredMeetingDateAfter, normalizeMeeting, issueMeetingBand, quarterIdForDate, quarterIdForRecord, rockMilestoneCounts, scorecardTrendFor, weekStartDateFor } from './types';
import { richTextToPlainText, sanitizeRichText, sanitizeTodoNotes } from './richText';
import type {
  CompanyOverview,
  AuditEntityType,
  AuditEvent,
  EnvironmentAccess,
  EnvironmentId,
  EnvironmentSession,
  Headline,
  Issue,
  IssueAgeBand,
  IssueAgeSettings,
  IssueHorizon,
  IssueMeetingBand,
  IssueTransfer,
  IssueTransferStatus,
  IssueStatus,
  MeetingActionSummary,
  MeetingAttendeeRating,
  MeetingAiSummary,
  MeetingReviewItem,
  MeetingReviewQuery,
  MeetingReviewPage,
  MeetingSkipReason,
  HistoricalMeetingInput,
  Notification,
  TeamMessage,
  MeetingSection,
  MeetingSectionConfig,
  Rock,
  RockStatus,
  RockTask,
  RockTaskStatus,
  ScorecardMetric,
  ScorecardResult,
  Team,
  TeamMembership,
  TeamNodeType,
  TeamRole,
  Todo,
  TodoChecklistItem,
  TodoStatus,
  User,
  Vto,
  VtoSaveInput,
  VtoVersion,
  Workspace,
} from './types';

const DAY = 24 * 60 * 60 * 1000;
const MAX_IDS_ISSUES = 5;
const weekdayNames = new Set(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const meetingSectionIds = new Set<MeetingSection>(['segue', 'scorecard', 'rock-review', 'headlines', 'todo-review', 'ids', 'conclude']);

export class WorkspaceApiError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

export interface SolveIssueInput {
  createFollowUpTodo: boolean;
  resolutionNote?: string;
}

export interface WorkspaceApi {
  getEnvironmentSession(): Promise<EnvironmentSession>;
  selectEnvironment(environment: EnvironmentId): Promise<EnvironmentSession>;
  getEnvironmentAccess(): Promise<EnvironmentAccess[]>;
  updateEnvironmentAccess(userId: string, testAllowed: boolean): Promise<EnvironmentAccess[]>;
  getWorkspace(quarterId?: string): Promise<Workspace>;
  getAuditTrail(entityType: AuditEntityType, entityId: string): Promise<AuditEvent[]>;
  getCompanyOverview(): Promise<CompanyOverview>;
  updateRockStatus(rockId: string, status: RockStatus, expectedVersion?: number): Promise<Workspace>;
  updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, expectedVersion?: number): Promise<Workspace>;
  addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string; quarterId?: string }): Promise<Workspace>;
  addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>): Promise<Workspace>;
  updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number): Promise<Workspace>;
  deleteRockTask(taskId: string, expectedVersion?: number): Promise<Workspace>;
  convertRockTaskToTodo(taskId: string): Promise<Workspace>;
  updateTodoStatus(todoId: string, status: TodoStatus, expectedVersion?: number): Promise<Workspace>;
  updateTodo(todoId: string, input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, expectedVersion?: number): Promise<Workspace>;
  addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string; sourceIssueId?: string; quarterId?: string }): Promise<Workspace>;
  addTodoChecklistItem(todoId: string, text: string, supporterId?: string, expectedVersion?: number): Promise<Workspace>;
  updateTodoChecklistItem(todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>, expectedVersion?: number): Promise<Workspace>;
  deleteTodoChecklistItem(todoId: string, itemId: string, expectedVersion?: number): Promise<Workspace>;
  createScorecardMetric(input: Pick<ScorecardMetric, 'teamId' | 'label' | 'target' | 'unit' | 'ownerId'>): Promise<Workspace>;
  updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetric, 'label' | 'target' | 'unit' | 'ownerId'>>, expectedVersion?: number): Promise<Workspace>;
  upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResult, 'actual' | 'status'>, expectedVersion?: number): Promise<Workspace>;
  createIssueFromScorecard(metricId: string, weekStartDate: string, expectedVersion?: number): Promise<Workspace>;
  createIssueFromRock(rockId: string, expectedVersion?: number): Promise<Workspace>;
  startIssue(issueId: string, expectedVersion?: number): Promise<Workspace>;
  parkIssue(issueId: string, expectedVersion?: number): Promise<Workspace>;
  solveIssue(issueId: string, input: SolveIssueInput, expectedVersion?: number): Promise<Workspace>;
  reopenIssue(issueId: string, expectedVersion?: number): Promise<Workspace>;
  createHeadline(input: Pick<Headline, 'teamId' | 'type' | 'title' | 'detail'> & { meetingId?: string; issueId?: string }): Promise<Workspace>;
  addIssue(input: Pick<Issue, 'title' | 'detail' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; quarterId?: string; linkedRockId?: string; linkedScorecardMetricId?: string; linkedScorecardWeekStartDate?: string; idsNote?: string }): Promise<Workspace>;
  updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number): Promise<Workspace>;
  addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number): Promise<Workspace>;
  updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, expectedVersion?: number): Promise<Workspace>;
  setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number): Promise<Workspace>;
  reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number): Promise<Workspace>;
  transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, expectedVersion?: number): Promise<Workspace>;
  requestIssueTransfer(issueId: string, destinationTeamId: string, note?: string, expectedVersion?: number): Promise<Workspace>;
  acceptIssueTransfer(transferId: string, expectedVersion?: number): Promise<Workspace>;
  rejectIssueTransfer(transferId: string, message: string, expectedVersion?: number): Promise<Workspace>;
  cancelIssueTransfer(transferId: string, expectedVersion?: number): Promise<Workspace>;
  sendTeamMessage(input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>): Promise<Workspace>;
  markMessageRead(messageId: string): Promise<Workspace>;
  createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId'>): Promise<Workspace>;
  markNotificationRead(notificationId: string): Promise<Workspace>;
  updateProfile(input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>): Promise<Workspace>;
  updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, expectedVersion?: number): Promise<Workspace>;
  generateMeetings(teamId: string): Promise<Workspace>;
  startMeeting(teamId: string, meetingId: string, expectedVersion?: number, facilitatorId?: string): Promise<Workspace>;
  createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }): Promise<Workspace>;
  updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>, expectedVersion?: number): Promise<Workspace>;
  createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }): Promise<Workspace>;
  updateUser(userId: string, input: Partial<Pick<User, 'name' | 'email'>> & { platformAdmin?: boolean }, expectedVersion?: number): Promise<Workspace>;
  upsertMembership(input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>): Promise<Workspace>;
  updateAgeSettings(settings: IssueAgeSettings): Promise<Workspace>;
  closeMeeting(teamId: string, recap: string, rating: number, meetingId?: string, attendeeRatings?: MeetingAttendeeRating[]): Promise<Workspace>;
  getMeetingReview(query?: MeetingReviewQuery): Promise<MeetingReviewPage>;
  getMeeting(teamId: string, meetingId: string): Promise<Workspace['meetings'][number]>;
  skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note?: string, expectedVersion?: number): Promise<Workspace>;
  requestMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number): Promise<Workspace>;
  cancelMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number): Promise<Workspace>;
  saveVto(teamId: string, input: VtoSaveInput, expectedVersion?: number): Promise<Workspace>;
  createHistoricalMeeting(teamId: string, input: HistoricalMeetingInput): Promise<Workspace>;
}

const cloneWorkspace = (workspace: Workspace): Workspace => structuredClone(workspace);
const nowIso = () => new Date().toISOString();
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `team-${Date.now()}`;

function stripLegacyRockProgress(rock: Rock): Rock {
  const next = { ...rock } as Record<string, unknown>;
  delete next.progress;
  return next as unknown as Rock;
}

export function ageBandFor(ageInDays: number, settings: IssueAgeSettings): IssueAgeBand {
  if (ageInDays >= settings.criticalDays) return 'critical';
  if (ageInDays >= settings.staleDays) return 'stale';
  if (ageInDays >= settings.agingDays) return 'aging';
  return 'fresh';
}

function normalizeTodoDate(value: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${normalized}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new WorkspaceApiError('VALIDATION', 'Choose a valid due date.');
  return normalized;
}

function normalizeMeetingDate(value: string) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${normalized}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new WorkspaceApiError('VALIDATION', 'Meeting date must be a valid date.');
  return normalized;
}

function assertFutureMeetingSchedule(scheduledDate: string, scheduledTime: string) {
  const timestamp = meetingScheduledAt({ scheduledDate, scheduledTime });
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new WorkspaceApiError('VALIDATION', 'A rescheduled meeting must be in the future with a valid time.');
}

function normalizedChecklist(todo: Todo, users: User[], memberships: TeamMembership[]) {
  return (Array.isArray(todo.checklist) ? todo.checklist : [])
    .map((item, index) => ({
      id: item.id || `checklist-${todo.id}-${index + 1}`,
      text: typeof item.text === 'string' ? item.text.trim() : '',
      completed: item.completed === true,
      supporterId: item.supporterId && users.some((user) => user.id === item.supporterId && user.active) && memberships.some((membership) => membership.teamId === todo.teamId && membership.userId === item.supporterId && membership.active) ? item.supporterId : todo.ownerId,
      createdAt: item.createdAt || todo.createdAt,
      updatedAt: item.updatedAt || todo.updatedAt,
    }))
    .filter((item) => item.text);
}

function ageFor(issue: Issue, settings: IssueAgeSettings, at = Date.now()): Issue {
  const end = issue.solvedAt ? new Date(issue.solvedAt).getTime() : at;
  const ageInDays = Math.max(0, Math.floor((end - new Date(issue.createdAt).getTime()) / DAY));
  return { ...issue, ageInDays, ageBand: ageBandFor(ageInDays, settings), meetingBand: issueMeetingBand(issue.meetingsPassed ?? 0, issue.status) };
}

function activeIssues(issues: Issue[]) {
  return issues.filter((issue) => issue.assignmentState !== 'redirected');
}

function meetingElapsedSeconds(startedAt: string | undefined, endedAt: string) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0;
}

function finalizeMeetingTiming(meeting: Workspace['meetings'][number], endedAt: string) {
  const section = meeting.activeSection;
  const sectionStartedAt = meeting.activeSectionStartedAt ?? meeting.startedAt;
  if (section && sectionStartedAt) {
    const elapsed = meetingElapsedSeconds(sectionStartedAt, endedAt);
    meeting.sectionDurations = { ...(meeting.sectionDurations ?? {}), [section]: (meeting.sectionDurations?.[section] ?? 0) + elapsed };
  }
  meeting.durationSeconds = meetingElapsedSeconds(meeting.startedAt, endedAt);
  meeting.activeSectionStartedAt = undefined;
}

function validateMeetingConfiguration(cadence: Team['meetingCadence'], meetingDay: string, meetingTime: string) {
  if (!meetingDay.trim()) throw new WorkspaceApiError('VALIDATION', cadence === 'monthly' ? 'Meeting date is required.' : 'Meeting day is required.');
  if (!meetingTime.trim()) throw new WorkspaceApiError('VALIDATION', 'Meeting time is required.');
  const normalizedDay = meetingDay.trim().toLowerCase();
  if (cadence === 'monthly' && !/^(?:[1-9]|[12]\d|3[01])$/.test(normalizedDay)) throw new WorkspaceApiError('VALIDATION', 'Monthly meeting date must be a day number from 1 to 31.');
  if (cadence === 'weekly' && !weekdayNames.has(normalizedDay)) throw new WorkspaceApiError('VALIDATION', 'Weekly meeting day must be Sunday through Saturday.');
}

function nextConfiguredMeetingDateOnOrAfter(team: Pick<Team, 'meetingCadence' | 'meetingDay' | 'meetingTime'>, at = new Date()) {
  const current = new Date(at);
  const currentDate = meetingDateFor(team, current);
  const currentScheduledAt = meetingScheduledAt({ scheduledDate: currentDate, scheduledTime: team.meetingTime });
  return Number.isFinite(currentScheduledAt) && currentScheduledAt > current.getTime()
    ? currentDate
    : nextConfiguredMeetingDateAfter(team, currentDate, current);
}

function validateMeetingSections(sections: MeetingSectionConfig[] | undefined) {
  if (sections === undefined) return defaultMeetingSections();
  if (sections.length !== meetingSectionIds.size) throw new WorkspaceApiError('VALIDATION', 'L10 configuration must include each supported section exactly once.');
  const seen = new Set<MeetingSection>();
  for (const section of sections) {
    if (!meetingSectionIds.has(section.id) || seen.has(section.id)) throw new WorkspaceApiError('VALIDATION', 'L10 configuration must include each supported section exactly once.');
    if (!section.label.trim()) throw new WorkspaceApiError('VALIDATION', 'Every L10 section needs a label.');
    if (typeof section.enabled !== 'boolean') throw new WorkspaceApiError('VALIDATION', 'Every L10 section must specify whether it is enabled.');
    if (!Number.isInteger(section.duration) || section.duration < 1 || section.duration > 180) throw new WorkspaceApiError('VALIDATION', 'Meeting section durations must be whole minutes between 1 and 180.');
    seen.add(section.id);
  }
  if (![...meetingSectionIds].every((section) => seen.has(section)) || !sections.some((section) => section.id === 'ids' && section.enabled) || !sections.some((section) => section.id === 'conclude' && section.enabled)) throw new WorkspaceApiError('VALIDATION', 'Each L10 must keep IDS and Conclude enabled.');
  return sections.map((section) => ({ ...section, label: section.label.trim() }));
}

function activeTransfer(transfers: IssueTransfer[], transferId: string) {
  const transfer = transfers.find((item) => item.id === transferId);
  if (!transfer) throw new WorkspaceApiError('NOT_FOUND', 'Transfer not found.');
  return transfer;
}

function avatarIsValid(value: string) {
  return /^(data:image\/(png|jpeg|jpg|webp);base64,)[a-z0-9+/=]+$/i.test(value) && value.length <= 360_000;
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

function meetingRecap(workspace: Workspace, team: Team, meeting: Workspace['meetings'][number], manualNotes: string) {
  const sections = meetingSectionsFor(team);
  const rocks = workspace.rocks.filter((rock) => rock.teamId === team.id);
  const todos = workspace.todos.filter((todo) => todo.teamId === team.id);
  const issues = workspace.issues.filter((issue) => issue.teamId === team.id && issue.assignmentState !== 'redirected');
  const ids = meeting.idsIssueIds.map((id) => issues.find((issue) => issue.id === id)).filter((issue): issue is Issue => Boolean(issue));
  const lines = [`${team.name} L10 recap · ${meeting.dateLabel} · week of ${meeting.weekStartDate ?? weekStartDateFor(new Date())}`, ''];
  const facilitator = workspace.users.find((user) => user.id === meeting.facilitatorId)?.name ?? meeting.facilitatorId;
  lines.push(`Facilitator: ${facilitator}`);
  if (meeting.durationSeconds !== undefined) lines.push(`Meeting duration: ${Math.floor(meeting.durationSeconds / 60)}m ${meeting.durationSeconds % 60}s`);
  if (meeting.attendeeRatings?.length) lines.push(`Meeting rating: ${meeting.lastRating}/10 average · Attendee ratings: ${meeting.attendeeRatings.map((entry) => `${workspace.users.find((user) => user.id === entry.attendeeId)?.name ?? entry.attendeeId} ${entry.rating}/10`).join('; ')}`);
  lines.push('');
  for (const section of sections) {
    const note = richTextToPlainText(meeting.sectionNotes[section.id]);
    if (note) lines.push(`${section.label}: ${note}`);
  }
  if (sections.some((section) => section.id === 'scorecard')) {
    const week = meeting.weekStartDate ?? weekStartDateFor(new Date());
    const teamMetrics = workspace.metrics.filter((metric) => metric.teamId === team.id);
    const results = teamMetrics.map((metric) => ({ metric, result: workspace.scorecardResults.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === week) }));
    const offTrack = results.filter(({ result }) => result?.status === 'off-track').map(({ metric, result }) => `${metric.label} (${result?.actual ?? 'Not entered'})`);
    const missing = results.filter(({ result }) => !result).map(({ metric }) => metric.label);
    lines.push(`Scorecard: ${offTrack.length ? `off-track — ${offTrack.join(', ')}` : missing.length ? `not entered — ${missing.join(', ')}` : 'all visible measurables on track.'}`);
  }
  lines.push(`Rock Review: ${rocks.length ? rocks.map((rock) => { const milestones = rockMilestoneCounts(rock); return `${rock.title} (${milestones.completed} completed · ${milestones.remaining} remaining · ${rock.status})`; }).join('; ') : 'no Rocks recorded.'}`);
  lines.push(`Headlines: ${workspace.headlines.filter((headline) => headline.teamId === team.id && (!headline.meetingId || headline.meetingId === meeting.id)).map((headline) => headline.title).join('; ') || 'none recorded.'}`);
  lines.push(`To-Do Review: ${todos.length ? todos.map((todo) => `${todo.title} — ${todo.status === 'done' ? 'done' : 'open'} · ${workspace.users.find((user) => user.id === todo.ownerId)?.name ?? 'unassigned'} · due ${todo.dueDate}`).join('; ') : 'no To-Dos recorded.'}`);
  lines.push(`IDS: ${ids.length ? ids.map((issue) => `${issue.title} — ${issue.status === 'solved' ? 'solved' : 'carried forward'}${issue.idsNote ? ` · ${richTextToPlainText(issue.idsNote).split('\n').at(-1)}` : ''}`).join('; ') : 'no Issues entered into IDS.'}`);
  const actions = meeting.actionSummary ?? meetingActionSummary(workspace, meeting);
  lines.push(`Actions: ${actions.todosCreated} To-Dos created · ${actions.issuesReviewedInIds} Issues reviewed in IDS · ${actions.issuesAddedToIds} Issues added to IDS · ${actions.issuesSolved} Issues solved.`);
  if (meeting.createdTodoIds.length) lines.push(`Created To-Dos: ${meeting.createdTodoIds.map((id) => todos.find((todo) => todo.id === id)?.title ?? id).join('; ')}`);
  if (manualNotes.trim()) lines.push(`Facilitator notes: ${manualNotes.trim()}`);
  return lines.join('\n');
}

function meetingActionSummary(workspace: Workspace, meeting: Workspace['meetings'][number]): MeetingActionSummary {
  return {
    todosCreated: meeting.createdTodoIds.length,
    issuesReviewedInIds: meeting.idsIssueIds.length,
    issuesAddedToIds: meeting.idsAddedIssueIds.length,
    issuesSolved: meeting.idsIssueIds.filter((issueId) => workspace.issues.find((issue) => issue.id === issueId)?.status === 'solved').length,
  };
}

function meetingAiSummary(workspace: Workspace, team: Team, meeting: Workspace['meetings'][number], source: MeetingAiSummary['source']): MeetingAiSummary {
  const issues = workspace.issues.filter((issue) => issue.teamId === team.id && issue.assignmentState !== 'redirected');
  const rocks = workspace.rocks.filter((rock) => rock.teamId === team.id);
  const todos = workspace.todos.filter((todo) => todo.teamId === team.id);
  const decisions = meeting.idsNotes.map((note) => richTextToPlainText(note.note)).filter(Boolean);
  const commitments = meeting.createdTodoIds.map((id) => todos.find((todo) => todo.id === id)?.title ?? id);
  const risks = [
    ...rocks.filter((rock) => rock.status === 'off-track').map((rock) => `Off-track Rock: ${rock.title}`),
    ...issues.filter((issue) => issue.status !== 'solved' && issue.horizon === 'short-term').map((issue) => `Open Issue: ${issue.title}`),
  ];
  const nextFocus = [
    ...todos.filter((todo) => todo.status !== 'done').slice(0, 3).map((todo) => todo.title),
    ...issues.filter((issue) => issue.status !== 'solved').slice(0, 2).map((issue) => issue.title),
  ];
  const executiveSummary = meeting.recap.trim()
    ? meeting.recap.trim().split('\n').filter(Boolean).at(-1) ?? `${team.name} completed its L10.`
    : `${team.name} completed its L10 with ${meeting.idsIssueIds.length} Issue${meeting.idsIssueIds.length === 1 ? '' : 's'} reviewed in IDS.`;
  return {
    executiveSummary,
    decisions: decisions.length ? decisions : ['No explicit IDS decision notes were recorded.'],
    commitments: commitments.length ? commitments : ['No new To-Dos were created during this meeting.'],
    risks: risks.length ? risks.slice(0, 5) : ['No immediate risks were identified from the recorded meeting context.'],
    nextFocus: nextFocus.length ? nextFocus : ['Continue the team’s current quarterly priorities.'],
    generatedAt: nowIso(),
    source,
  };
}

function teamForReview(workspace: Workspace, teamId: string): Team {
  return workspace.teams.find((team) => team.id === teamId) ?? {
    id: teamId,
    name: teamId,
    shortName: teamId,
    description: '',
    parentTeamId: null,
    nodeType: 'operational',
    memberCount: 0,
    meetingCadence: 'weekly',
    meetingDay: 'Monday',
    meetingTime: '9:00 AM',
    accent: '#8b96a8',
    initials: '?',
    active: true,
    meetingSections: [],
    escalationUserIds: [],
  };
}

function teamForMessage(workspace: Workspace, teamId: string) {
  return workspace.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function validateVtoInput(input: VtoSaveInput) {
  const list = (value: unknown, label: string, minimum: number, maximum: number) => {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum || value.some((item) => typeof item !== 'string' || !item.trim())) throw new WorkspaceApiError('VALIDATION', `${label} must contain between ${minimum} and ${maximum} non-empty entries.`);
  };
  const text = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !value.trim()) throw new WorkspaceApiError('VALIDATION', `${label} is required.`);
  };
  list(input.coreValues, 'Core Values', 3, 7);
  list(input.marketingStrategy?.uniques, 'Three Uniques', 3, 3);
  list(input.oneYearPlan?.measurables, 'One-Year Measurables', 1, 7);
  list(input.oneYearPlan?.goals, 'One-Year Goals', 1, 7);
  for (const [value, label] of [[input.coreFocusPurpose, 'Core Focus purpose'], [input.coreFocusNiche, 'Core Focus niche'], [input.tenYearTarget, '10-Year Target'], [input.marketingStrategy?.targetMarket, 'Target Market'], [input.marketingStrategy?.provenProcess, 'Proven Process'], [input.marketingStrategy?.guarantee, 'Guarantee'], [input.threeYearPicture?.targetDate, '3-Year Picture target date'], [input.threeYearPicture?.revenue, '3-Year Picture revenue'], [input.threeYearPicture?.profit, '3-Year Picture profit'], [input.threeYearPicture?.headcount, '3-Year Picture headcount'], [input.threeYearPicture?.description, '3-Year Picture description'], [input.oneYearPlan?.revenue, 'One-Year Plan revenue'], [input.oneYearPlan?.profit, 'One-Year Plan profit'], [input.effectiveDate, 'V/TO effective date'], [input.changeSummary, 'V/TO change summary']] as const) text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.threeYearPicture.targetDate) || Number.isNaN(new Date(`${input.effectiveDate}T12:00:00Z`).getTime()) || Number.isNaN(new Date(`${input.threeYearPicture.targetDate}T12:00:00Z`).getTime())) throw new WorkspaceApiError('VALIDATION', 'V/TO dates must be valid dates.');
  if (!Number.isInteger(input.oneYearPlan?.year) || input.oneYearPlan.year < 2000 || input.oneYearPlan.year > 9999) throw new WorkspaceApiError('VALIDATION', 'One-Year Plan year must be a four-digit year.');
  if (!Array.isArray(input.quarterlyRockIds) || input.quarterlyRockIds.length > 7 || input.quarterlyRockIds.some((id) => typeof id !== 'string' || !id.trim())) throw new WorkspaceApiError('VALIDATION', 'Quarterly Rocks must contain no more than seven valid Rock IDs.');
  if (!Array.isArray(input.issueIds) || input.issueIds.some((id) => typeof id !== 'string' || !id.trim())) throw new WorkspaceApiError('VALIDATION', 'Issues List must contain valid Issue IDs.');
}

function advanceIssueEscalations(workspace: Workspace, team: Team, meeting: Workspace['meetings'][number], at: string, notify: (userId: string, input: Omit<Notification, 'id' | 'recipientUserId' | 'createdAt'>) => void) {
  const meetingStart = new Date(meeting.startedAt ?? `${meeting.scheduledDate}T00:00:00.000Z`).getTime();
  for (const issue of workspace.issues.filter((candidate) => {
    const createdAt = new Date(candidate.createdAt).getTime();
    return candidate.teamId === team.id
      && candidate.assignmentState !== 'redirected'
      && candidate.status !== 'solved'
      && (Number.isNaN(meetingStart) || Number.isNaN(createdAt) || createdAt <= meetingStart);
  })) {
    issue.meetingsPassed += 1;
    issue.meetingBand = issueMeetingBand(issue.meetingsPassed, issue.status);
    issue.updatedAt = at;
    issue.version += 1;
    if (issue.meetingsPassed >= 4 && issue.escalationState !== 'escalated') {
      const recipientId = team.escalationUserIds[issue.escalationLevel] ?? team.escalationUserIds[0];
      issue.escalationState = 'escalated';
      issue.escalationDueAt = undefined;
      if (recipientId) {
        issue.escalatedToUserId = recipientId;
        issue.escalationLevel += 1;
        notify(recipientId, { type: 'issue-escalation', title: 'Issue escalated', message: `${issue.title} has remained unsolved through four L10 meetings for ${team.name}.`, issueId: issue.id, teamId: team.id });
      }
    }
  }
}

export class LocalWorkspaceApi implements WorkspaceApi {
  private readonly workspaces: Record<EnvironmentId, Workspace>;
  private readonly selectedQuarterIds: Record<EnvironmentId, string>;
  private selectedEnvironment: EnvironmentId = 'live';
  private readonly testAccessUserIds: Set<string>;

  private get workspace() {
    return this.workspaces[this.selectedEnvironment];
  }

  constructor(seed: Workspace | Partial<Record<EnvironmentId, Workspace>> = initialWorkspace, options: { testAccessUserIds?: readonly string[] } = {}) {
    const isWorkspace = (value: Workspace | Partial<Record<EnvironmentId, Workspace>>): value is Workspace => 'currentUser' in value;
    const liveSeed = isWorkspace(seed) ? seed : seed.live ?? initialWorkspace;
    const testSeed = isWorkspace(seed) ? testWorkspace : seed.test ?? testWorkspace;
    this.workspaces = {
      live: cloneWorkspace({ ...liveSeed, environment: 'live', quarters: liveSeed.quarters?.length ? liveSeed.quarters : [liveSeed.quarter], vtos: liveSeed.vtos ?? [], vtoVersions: liveSeed.vtoVersions ?? [] }),
      test: cloneWorkspace({ ...testSeed, environment: 'test', quarters: testSeed.quarters?.length ? testSeed.quarters : [testSeed.quarter], vtos: testSeed.vtos ?? [], vtoVersions: testSeed.vtoVersions ?? [] }),
    };
    this.selectedQuarterIds = { live: liveSeed.quarter.id, test: testSeed.quarter.id };
    this.testAccessUserIds = new Set(options.testAccessUserIds ?? [liveSeed.currentUser.id]);
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    this.refreshDerivedState();
    this.selectedEnvironment = 'test';
    this.refreshWorkspace('test');
    this.maintainMeetingWindows();
    this.refreshDerivedState();
    this.selectedEnvironment = 'live';
  }

  private refreshWorkspace(environment: EnvironmentId) {
    const previous = this.selectedEnvironment;
    this.selectedEnvironment = environment;
    this.refreshDerivedState();
    this.selectedEnvironment = previous;
  }

  private requireSelectedEnvironmentAccess() {
    if (this.selectedEnvironment === 'test' && !this.testAccessUserIds.has(this.workspaces.live.currentUser.id)) {
      throw new WorkspaceApiError('FORBIDDEN', 'Test environment access has not been granted.');
    }
  }

  async getEnvironmentSession(): Promise<EnvironmentSession> {
    const userId = this.workspaces.live.currentUser.id;
    const canSwitchToTest = this.testAccessUserIds.has(userId);
    return {
      currentEnvironment: this.selectedEnvironment,
      availableEnvironments: [{ id: 'live', label: 'Live', canAccess: true }, ...(canSwitchToTest ? [{ id: 'test' as const, label: 'Test', canAccess: true }] : [])],
      canSwitchToTest,
    };
  }

  async selectEnvironment(environment: EnvironmentId): Promise<EnvironmentSession> {
    if (environment === 'test' && !this.testAccessUserIds.has(this.workspaces.live.currentUser.id)) throw new WorkspaceApiError('FORBIDDEN', 'Test environment access has not been granted.');
    this.selectedEnvironment = environment;
    this.requireSelectedEnvironmentAccess();
    this.selectedQuarterIds[environment] = this.workspaces[environment].quarters.find((quarter) => quarter.status === 'current')?.id ?? this.workspaces[environment].quarter.id;
    this.workspaces[environment].quarter = this.workspaces[environment].quarters.find((quarter) => quarter.id === this.selectedQuarterIds[environment]) ?? this.workspaces[environment].quarter;
    this.refreshDerivedState();
    return this.getEnvironmentSession();
  }

  private requireLiveAdminForEnvironmentAccess() {
    if (this.selectedEnvironment !== 'live') throw new WorkspaceApiError('FORBIDDEN', 'Test access is managed from the Live Admin center.');
    const isOrgAdmin = this.workspaces.live.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === this.workspaces.live.currentUser.id && membership.role === 'OrgAdmin' && membership.active);
    if (!this.workspaces.live.currentUser.platformCapabilities.includes('PlatformAdmin') && !isOrgAdmin) throw new WorkspaceApiError('FORBIDDEN', 'OrgAdmin administration is required.');
  }

  async getEnvironmentAccess(): Promise<EnvironmentAccess[]> {
    this.requireLiveAdminForEnvironmentAccess();
    return this.workspaces.live.users.filter((user) => user.active).map((user) => ({ userId: user.id, name: user.name, email: user.email, testAllowed: this.testAccessUserIds.has(user.id), version: this.testAccessUserIds.has(user.id) ? 1 : 0 }));
  }

  async updateEnvironmentAccess(userId: string, testAllowed: boolean): Promise<EnvironmentAccess[]> {
    this.requireLiveAdminForEnvironmentAccess();
    const user = this.workspaces.live.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) throw new WorkspaceApiError('NOT_FOUND', 'User not found in the Live directory.');
    if (testAllowed) this.testAccessUserIds.add(userId);
    else this.testAccessUserIds.delete(userId);
    this.workspaces.live.activity.unshift({ id: `environment-audit-${Date.now()}`, actorId: this.workspaces.live.currentUser.id, action: testAllowed ? 'Granted Test access' : 'Revoked Test access', target: userId, detail: `${user.name} can ${testAllowed ? 'now' : 'no longer'} switch to the Test environment.`, createdAt: nowIso(), type: 'team' });
    return this.getEnvironmentAccess();
  }

  private refreshDerivedState() {
    this.workspace.quarters = (this.workspace.quarters?.length ? this.workspace.quarters : [this.workspace.quarter]).map((quarter) => ({ ...quarter, status: quarter.status ?? (quarter.id === this.workspace.quarter.id ? 'current' : 'past') }));
    this.workspace.rocks = this.workspace.rocks.map((rock) => ({ ...stripLegacyRockProgress(rock), notes: sanitizeRichText(rock.notes) }));
    this.workspace.teams = this.workspace.teams.map((team) => ({
      ...team,
      meetingCadence: team.meetingCadence ?? 'weekly',
      meetingSections: meetingSectionConfigsFor(team),
      escalationUserIds: team.escalationUserIds ?? [],
    }));
    this.workspace.issues = this.workspace.issues.map((issue) => ageFor({
      ...issue,
      quarterId: issue.quarterId ?? quarterIdForDate(issue.createdAt, this.workspace.quarters),
      detail: sanitizeRichText(issue.detail),
      idsNote: issue.idsNote ? sanitizeRichText(issue.idsNote) : undefined,
      meetingsPassed: issue.meetingsPassed ?? 0,
      escalationState: issue.escalationState ?? 'not-scheduled',
      escalationLevel: issue.escalationLevel ?? 0,
    }, this.workspace.settings));
    this.workspace.users = this.workspace.users.map((user) => ({ ...user, initials: user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?', updatedAt: user.updatedAt ?? nowIso(), version: user.version ?? 1 }));
    this.workspace.teams = this.workspace.teams.map((team) => ({
      ...team,
      memberCount: this.workspace.memberships.filter((membership) => membership.teamId === team.id && membership.active).length,
    }));
    this.workspace.todos = this.workspace.todos.map((todo) => ({ ...todo, quarterId: todo.quarterId ?? quarterIdForDate(todo.dueDate, this.workspace.quarters), notes: sanitizeTodoNotes(todo.notes), checklist: normalizedChecklist(todo, this.workspace.users, this.workspace.memberships), carryForwardCount: todo.carryForwardCount ?? 0, flagged: todo.flagged ?? false, isMine: todo.ownerId === this.workspace.currentUser.id }));
    this.workspace.headlines = (this.workspace.headlines ?? []).map((headline) => ({ ...headline, quarterId: headline.quarterId ?? quarterIdForDate(headline.createdAt, this.workspace.quarters), title: typeof headline.title === 'string' ? headline.title.trim() : '', detail: typeof headline.detail === 'string' ? sanitizeRichText(headline.detail) : '' }));
    this.workspace.scorecardResults = this.workspace.scorecardResults ?? [];
    this.workspace.meetings = this.workspace.meetings.map((meeting) => {
      const team = this.workspace.teams.find((candidate) => candidate.id === meeting.teamId);
      const sections = team ? meetingSectionsFor(team) : meetingSectionsFor({ meetingSections: [] });
      return normalizeMeeting({ ...meeting, quarterId: meeting.quarterId ?? quarterIdForDate(meeting.scheduledDate ?? '', this.workspace.quarters), agendaTotal: sections.length, sectionNotes: Object.fromEntries(Object.entries(meeting.sectionNotes ?? {}).map(([section, note]) => [section, sanitizeRichText(note)])), sectionDurations: meeting.sectionDurations ?? {}, attendeeRatings: meeting.attendeeRatings ?? [], idsIssueIds: meeting.idsIssueIds ?? [], idsAddedIssueIds: meeting.idsAddedIssueIds ?? [], createdTodoIds: meeting.createdTodoIds ?? [], idsNotes: (meeting.idsNotes ?? []).map((note) => ({ ...note, note: sanitizeRichText(note.note) })), aiSummaryStatus: meeting.aiSummaryStatus ?? (meeting.status === 'closed' ? 'not-generated' : undefined), aiSummarySource: meeting.aiSummarySource }, team);
    });
  }

  private membership(teamId: string, userId = this.workspace.currentUser.id) {
    return this.workspace.memberships.find((membership) => membership.teamId === teamId && membership.userId === userId && membership.active);
  }

  private leadershipMember() {
    return this.membership('leadership');
  }

  private canReadTeam(teamId: string) {
    if (this.membership(teamId) || this.leadershipMember()) return true;
    return this.workspace.memberships.some((membership) => membership.userId === this.workspace.currentUser.id
      && membership.active
      && (membership.role === 'TeamLead' || membership.role === 'OrgAdmin')
      && this.descendantIds(membership.teamId).includes(teamId));
  }

  private canWriteTeam(teamId: string) {
    const role = this.membership(teamId)?.role;
    return role === 'OrgAdmin' || role === 'TeamLead' || role === 'Member';
  }

  private canManageMeeting(teamId: string) {
    const role = this.membership(teamId)?.role;
    return role === 'OrgAdmin' || role === 'TeamLead';
  }

  private requireRead(teamId: string) {
    if (!this.canReadTeam(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You do not have access to this team.');
  }

  private requireWrite(teamId: string) {
    if (!this.canWriteTeam(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You need team editing access for this action.');
  }

  private resolveQuarterId(requestedQuarterId?: string, associatedDate?: string | Date) {
    const resolved = requestedQuarterId ?? (associatedDate ? quarterIdForDate(associatedDate, this.workspace.quarters) : this.workspace.quarter.id);
    if (!resolved || !this.workspace.quarters.some((quarter) => quarter.id === resolved)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid quarter.');
    return resolved;
  }

  private assertQuarterDate(quarterId: string | undefined, associatedDate: string | Date) {
    const resolved = this.resolveQuarterId(quarterId, associatedDate);
    if (quarterId && quarterIdForDate(associatedDate, this.workspace.quarters) !== quarterId) throw new WorkspaceApiError('VALIDATION', 'The record date must fall within the selected quarter.');
    return resolved;
  }

  private canManageMeetingSummary(teamId: string) {
    // Summary generation is a write against the meeting's own team record.
    // Parent-team reviewers can read descendant meetings, but do not gain
    // mutation rights through the hierarchy.
    return this.canWriteTeam(teamId);
  }

  private requireChecklistSupporter(teamId: string, userId: string) {
    if (!this.workspace.users.some((user) => user.id === userId && user.active) || !this.workspace.memberships.some((membership) => membership.teamId === teamId && membership.userId === userId && membership.active)) throw new WorkspaceApiError('VALIDATION', 'Checklist supporter must be an active member of the To-Do team.');
  }

  private requireAdmin() {
    const isOrgAdmin = this.workspace.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === this.workspace.currentUser.id && membership.role === 'OrgAdmin' && membership.active);
    if (!this.workspace.currentUser.platformCapabilities.includes('PlatformAdmin') && !isOrgAdmin) throw new WorkspaceApiError('FORBIDDEN', 'OrgAdmin administration is required.');
  }

  private requireVersion(actual: number, expected?: number) {
    if (expected !== undefined && actual !== expected) throw new WorkspaceApiError('CONFLICT', 'This item changed elsewhere. Refresh and try again.');
  }

  private audit(action: string, target: string, detail: string, type: Workspace['activity'][number]['type']) {
    this.workspace.activity.unshift({ id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, actorId: this.workspace.currentUser.id, action, target, detail, createdAt: nowIso(), type });
  }

  private notify(recipientUserId: string, input: Omit<Notification, 'id' | 'recipientUserId' | 'createdAt'>) {
    this.workspace.notifications.unshift({ ...input, id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recipientUserId, createdAt: nowIso() });
  }

  private result() {
    this.requireSelectedEnvironmentAccess();
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    return cloneWorkspace(this.workspace);
  }

  async getWorkspace(quarterId?: string) {
    this.requireSelectedEnvironmentAccess();
    const selectedId = quarterId ?? this.selectedQuarterIds[this.selectedEnvironment] ?? this.workspace.quarter.id;
    const selectedQuarter = this.workspace.quarters.find((quarter) => quarter.id === selectedId);
    if (!selectedQuarter) throw new WorkspaceApiError('VALIDATION', 'The selected quarter does not exist.');
    this.selectedQuarterIds[this.selectedEnvironment] = selectedId;
    this.workspace.quarter = selectedQuarter;
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    return cloneWorkspace(this.workspace);
  }

  async getAuditTrail(entityType: AuditEntityType, entityId: string) {
    this.requireSelectedEnvironmentAccess();
    const teamId = entityType === 'rock'
      ? this.workspace.rocks.find((rock) => rock.id === entityId)?.teamId
      : entityType === 'todo'
        ? this.workspace.todos.find((todo) => todo.id === entityId)?.teamId
        : this.workspace.issues.find((issue) => issue.id === entityId && issue.assignmentState !== 'redirected')?.teamId;
    if (!teamId) throw new WorkspaceApiError('NOT_FOUND', `${entityType[0].toUpperCase()}${entityType.slice(1)} not found.`);
    this.requireRead(teamId);
    const eventTypes = entityType === 'issue' ? new Set<AuditEvent['type']>(['issue', 'transfer', 'meeting']) : new Set<AuditEvent['type']>([entityType]);
    return structuredClone(this.workspace.activity
      .filter((event) => event.target === entityId && eventTypes.has(event.type))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  }

  async getMeetingReview(query: MeetingReviewQuery = {}): Promise<MeetingReviewPage> {
    this.requireSelectedEnvironmentAccess();
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const userId = this.workspace.currentUser.id;
    const leadership = Boolean(this.leadershipMember());
    const visibleTeamIds = new Set<string>(this.workspace.memberships
      .filter((membership) => membership.userId === userId && membership.active)
      .flatMap((membership) => [membership.teamId, ...(membership.role === 'TeamLead' || membership.role === 'OrgAdmin' ? this.descendantIds(membership.teamId) : [])]));
    if (leadership) this.workspace.teams.filter((team) => team.active).forEach((team) => visibleTeamIds.add(team.id));
    if (query.teamId && !visibleTeamIds.has(query.teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You do not have access to this team’s meeting history.');
    const from = query.from ? normalizeMeetingDate(query.from) : undefined;
    const to = query.to ? normalizeMeetingDate(query.to) : undefined;
    if (from && to && from > to) throw new WorkspaceApiError('VALIDATION', 'From date must be on or before the To date.');
    const requestedFilter = query.filter ?? query.status;
    const items = this.workspace.meetings
      .filter((meeting) => visibleTeamIds.has(meeting.teamId) && (!query.teamId || meeting.teamId === query.teamId))
      .map((meeting) => {
        const team = teamForReview(this.workspace, meeting.teamId);
        return { meeting, team, reviewStatus: meetingReviewStatus(meeting, team) } satisfies MeetingReviewItem;
      })
      .filter(({ meeting, reviewStatus }) => (!from || (meeting.scheduledDate ?? '') >= from) && (!to || (meeting.scheduledDate ?? '') <= to) && (
          requestedFilter === 'attention' ? reviewStatus === 'missed' || reviewStatus === 'overdue'
          : requestedFilter === 'completed' ? reviewStatus === 'closed'
            : requestedFilter === 'skipped' ? reviewStatus === 'skipped'
              : requestedFilter === 'all' || !requestedFilter ? true
                : reviewStatus === requestedFilter
      ))
      .sort((left, right) => `${right.meeting.scheduledDate}T${right.meeting.scheduledTime}`.localeCompare(`${left.meeting.scheduledDate}T${left.meeting.scheduledTime}`));
    const attentionCount = this.workspace.meetings
      .filter((meeting) => visibleTeamIds.has(meeting.teamId))
      .some((meeting) => {
        const team = teamForReview(this.workspace, meeting.teamId);
        const status = meetingReviewStatus(meeting, team);
        return status === 'missed' || status === 'overdue';
      }) ? this.workspace.meetings.filter((meeting) => visibleTeamIds.has(meeting.teamId)).filter((meeting) => {
        const status = meetingReviewStatus(meeting, teamForReview(this.workspace, meeting.teamId));
        return status === 'missed' || status === 'overdue';
      }).length : 0;
    return { items, attentionCount };
  }

  async getMeeting(teamId: string, meetingId: string) {
    this.requireSelectedEnvironmentAccess();
    this.requireRead(teamId);
    this.refreshDerivedState();
    this.maintainMeetingWindows();
    const meeting = this.workspace.meetings.find((candidate) => candidate.teamId === teamId && candidate.id === meetingId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    return structuredClone(meeting);
  }

  async getCompanyOverview(): Promise<CompanyOverview> {
    this.requireSelectedEnvironmentAccess();
    if (!this.leadershipMember()) throw new WorkspaceApiError('FORBIDDEN', 'Leadership membership is required for company visibility.');
    this.refreshDerivedState();
    const visibleIssues = activeIssues(this.workspace.issues);
    const rollups = this.workspace.teams.map((team) => {
      const directRocks = this.workspace.rocks.filter((rock) => rock.teamId === team.id);
      const directTodos = this.workspace.todos.filter((todo) => todo.teamId === team.id);
      const directIssues = visibleIssues.filter((issue) => issue.teamId === team.id);
      const descendantIds = this.descendantIds(team.id);
      return {
        teamId: team.id,
        direct: {
          rocks: { total: directRocks.length, onTrack: directRocks.filter((rock) => rock.status === 'on-track').length, offTrack: directRocks.filter((rock) => rock.status === 'off-track').length, complete: directRocks.filter((rock) => rock.status === 'complete').length },
          todos: { total: directTodos.length, open: directTodos.filter((todo) => todo.status === 'open').length, done: directTodos.filter((todo) => todo.status === 'done').length, notDone: directTodos.filter((todo) => todo.status === 'not-done').length },
          issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, neutral: directIssues.filter((issue) => issue.meetingBand === 'neutral').length, green: directIssues.filter((issue) => issue.meetingBand === 'green').length, yellow: directIssues.filter((issue) => issue.meetingBand === 'yellow').length, orange: directIssues.filter((issue) => issue.meetingBand === 'orange').length, red: directIssues.filter((issue) => issue.meetingBand === 'red').length },
        },
        descendants: { rocks: this.workspace.rocks.filter((rock) => descendantIds.includes(rock.teamId)).length, todos: this.workspace.todos.filter((todo) => descendantIds.includes(todo.teamId)).length, issues: visibleIssues.filter((issue) => descendantIds.includes(issue.teamId)).length },
      };
    });
    return { teams: rollups, issues: visibleIssues, rocks: [...this.workspace.rocks], todos: [...this.workspace.todos] };
  }

  private descendantIds(teamId: string): string[] {
    const children = this.workspace.teams.filter((team) => team.parentTeamId === teamId).map((team) => team.id);
    return children.flatMap((childId) => [childId, ...this.descendantIds(childId)]);
  }

  private rock(rockId: string) {
    const rock = this.workspace.rocks.find((item) => item.id === rockId);
    if (!rock) throw new WorkspaceApiError('NOT_FOUND', 'Rock not found.');
    this.requireRead(rock.teamId);
    return rock;
  }

  private task(taskId: string) {
    for (const rock of this.workspace.rocks) {
      const task = rock.tasks.find((item) => item.id === taskId);
      if (task) {
        this.requireRead(rock.teamId);
        return { rock, task };
      }
    }
    throw new WorkspaceApiError('NOT_FOUND', 'Rock Task not found.');
  }

  private todo(todoId: string) {
    const todo = this.workspace.todos.find((item) => item.id === todoId);
    if (!todo) throw new WorkspaceApiError('NOT_FOUND', 'To-Do not found.');
    this.requireRead(todo.teamId);
    return todo;
  }

  private issue(issueId: string) {
    const issue = this.workspace.issues.find((item) => item.id === issueId && item.assignmentState !== 'redirected');
    if (!issue) throw new WorkspaceApiError('NOT_FOUND', 'Issue not found.');
    this.requireRead(issue.teamId);
    return issue;
  }

  async updateRockStatus(rockId: string, status: RockStatus, expectedVersion?: number) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    this.requireVersion(rock.version, expectedVersion);
    rock.status = status;
    rock.updatedAt = nowIso();
    rock.updatedBy = this.workspace.currentUser.id;
    rock.version += 1;
    this.audit('Updated Rock status', rock.id, `${rock.title} marked ${status}.`, 'rock');
    return this.result();
  }

  async updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, expectedVersion?: number) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    this.requireVersion(rock.version, expectedVersion);
    const allowedInput: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>> = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.notes !== undefined ? { notes: sanitizeRichText(input.notes) } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    Object.assign(rock, allowedInput, { updatedAt: nowIso(), updatedBy: this.workspace.currentUser.id, version: rock.version + 1 });
    this.audit('Updated Rock', rock.id, `Updated ${rock.title}.`, 'rock');
    return this.result();
  }

  async addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string; quarterId?: string }) {
    this.requireWrite(input.teamId);
    const quarterId = this.assertQuarterDate(input.quarterId, input.dueDate);
    const timestamp = nowIso();
    this.workspace.rocks.unshift({ ...input, id: `rock-${Date.now()}`, quarterId, notes: sanitizeRichText(input.notes), status: 'on-track', tasks: [], createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1 });
    this.audit('Created Rock', this.workspace.rocks[0].id, input.title, 'rock');
    return this.result();
  }

  async addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    const timestamp = nowIso();
    rock.tasks.push({ ...input, id: `task-${Date.now()}`, rockId, teamId: rock.teamId, status: 'open', createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1 });
    rock.updatedAt = timestamp;
    rock.updatedBy = this.workspace.currentUser.id;
    rock.version += 1;
    this.audit('Added Rock Task', rock.id, input.title, 'rock');
    return this.result();
  }

  async updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number) {
    const { rock, task } = this.task(taskId);
    this.requireWrite(rock.teamId);
    this.requireVersion(task.version, expectedVersion);
    const allowedInput: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>> = {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      ...(input.assignedAt !== undefined ? { assignedAt: input.assignedAt } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    Object.assign(task, allowedInput, { updatedAt: nowIso(), updatedBy: this.workspace.currentUser.id, version: task.version + 1 });
    if (task.linkedTodoId) {
      const todo = this.workspace.todos.find((item) => item.id === task.linkedTodoId);
      if (todo) {
        if (input.status) todo.status = input.status === 'done' ? 'done' : 'open';
        if (input.assigneeId) todo.ownerId = input.assigneeId;
        if (input.dueDate) todo.dueDate = input.dueDate;
        todo.updatedAt = nowIso();
        todo.updatedBy = this.workspace.currentUser.id;
        todo.version += 1;
      }
    }
    rock.updatedAt = nowIso();
    rock.updatedBy = this.workspace.currentUser.id;
    rock.version += 1;
    this.audit('Updated Rock Task', task.id, task.title, 'rock');
    return this.result();
  }

  async deleteRockTask(taskId: string, expectedVersion?: number) {
    const { rock, task } = this.task(taskId);
    this.requireWrite(rock.teamId);
    this.requireVersion(task.version, expectedVersion);
    if (task.linkedTodoId) {
      const todo = this.workspace.todos.find((item) => item.id === task.linkedTodoId);
      if (todo) {
        delete todo.linkedRockTaskId;
        todo.origin = 'Team workspace · former Rock Task';
        todo.updatedAt = nowIso();
        todo.updatedBy = this.workspace.currentUser.id;
        todo.version += 1;
      }
    }
    rock.tasks = rock.tasks.filter((item) => item.id !== taskId);
    rock.updatedAt = nowIso();
    rock.updatedBy = this.workspace.currentUser.id;
    rock.version += 1;
    this.audit('Deleted Rock Task', task.id, `${task.title} removed from ${rock.title}.`, 'rock');
    return this.result();
  }

  async convertRockTaskToTodo(taskId: string) {
    const { rock, task } = this.task(taskId);
    this.requireWrite(rock.teamId);
    if (task.linkedTodoId) return this.result();
    const timestamp = nowIso();
    const todo: Todo = { id: `todo-task-${task.id}`, teamId: rock.teamId, quarterId: rock.quarterId, title: task.title, notes: sanitizeTodoNotes(task.notes), ownerId: task.assigneeId, dueDate: task.dueDate, status: task.status === 'done' ? 'done' : 'open', origin: `Rock · ${rock.title}`, linkedRockTaskId: task.id, checklist: [], createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1, carryForwardCount: 0, flagged: false };
    task.linkedTodoId = todo.id;
    task.updatedAt = timestamp;
    task.updatedBy = this.workspace.currentUser.id;
    task.version += 1;
    rock.tasks = rock.tasks.map((item) => item.id === task.id ? task : item);
    this.workspace.todos.unshift(todo);
    this.audit('Converted Rock Task to To-Do', task.id, `${task.title} linked to ${todo.id}.`, 'todo');
    return this.result();
  }

  async updateTodoStatus(todoId: string, status: TodoStatus, expectedVersion?: number) {
    return this.updateTodo(todoId, { status }, expectedVersion);
  }

  async updateTodo(todoId: string, input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, expectedVersion?: number) {
    const todo = this.todo(todoId);
    this.requireWrite(todo.teamId);
    this.requireVersion(todo.version, expectedVersion);
    const normalizedDueDate = input.dueDate === undefined ? undefined : normalizeTodoDate(input.dueDate);
    if (input.status !== undefined && !['open', 'done', 'not-done'].includes(input.status)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid To-Do status.');
    const normalizedInput = normalizedDueDate === undefined ? input : { ...input, dueDate: normalizedDueDate };
    const isLaterDate = normalizedDueDate !== undefined && normalizedDueDate > todo.dueDate;
    const isRollover = todo.status !== 'done' && isLaterDate;
    const timestamp = nowIso();
    const nextInput = isRollover ? { ...normalizedInput, status: 'open' as const } : normalizedInput;
    if (isRollover) {
      todo.carryForwardCount += 1;
      todo.flagged = todo.carryForwardCount > 3;
    }
    Object.assign(todo, { ...nextInput, ...(nextInput.notes !== undefined ? { notes: sanitizeTodoNotes(nextInput.notes) } : {}) }, { updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: todo.version + 1 });
    if (todo.linkedRockTaskId) {
      const linked = this.task(todo.linkedRockTaskId);
      this.requireWrite(linked.rock.teamId);
      if (isRollover) linked.task.status = 'open';
      else if (normalizedInput.status) linked.task.status = normalizedInput.status === 'done' ? 'done' : 'open';
      if (normalizedInput.ownerId) linked.task.assigneeId = normalizedInput.ownerId;
      if (normalizedDueDate) linked.task.dueDate = normalizedDueDate;
      linked.task.updatedAt = timestamp;
      linked.task.updatedBy = this.workspace.currentUser.id;
      linked.task.version += 1;
      linked.rock.updatedAt = timestamp;
      linked.rock.updatedBy = this.workspace.currentUser.id;
      linked.rock.version += 1;
    }
    if (isRollover && todo.flagged && !todo.convertedIssueId) {
      const issueId = `issue-todo-rollover-${todo.id}`;
      const issue: Issue = {
        id: issueId,
        teamId: todo.teamId,
        quarterId: todo.quarterId,
        sourceTeamId: todo.teamId,
        currentTeamId: todo.teamId,
        title: `Repeated To-Do: ${todo.title}`,
        detail: `This To-Do was moved forward ${todo.carryForwardCount} times. Review the commitment in IDS and decide what must change.`,
        priority: 2,
        status: 'open',
        horizon: 'short-term',
        assignmentState: 'assigned',
        raisedById: this.workspace.currentUser.id,
        ownerId: todo.ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        ageInDays: 0,
        ageBand: 'fresh',
        meetingBand: issueMeetingBand(0, 'open'),
        version: 1,
        meetingsPassed: 0,
        escalationState: 'not-scheduled',
        escalationLevel: 0,
        sourceTodoId: todo.id,
        updatedBy: this.workspace.currentUser.id,
      };
      this.workspace.issues.unshift(issue);
      todo.convertedIssueId = issueId;
      this.audit('Converted repeated To-Do to Issue', issueId, `${todo.title} moved forward ${todo.carryForwardCount} times.`, 'issue');
    } else if (isRollover) {
      this.audit('Moved To-Do forward', todo.id, `${todo.title} moved to ${todo.dueDate} (${todo.carryForwardCount} times).`, 'todo');
    } else {
      this.audit('Updated To-Do', todo.id, `Updated ${todo.title}.`, 'todo');
    }
    return this.result();
  }

  async addTodoChecklistItem(todoId: string, text: string, supporterId?: string, expectedVersion?: number) {
    const todo = this.todo(todoId);
    this.requireWrite(todo.teamId);
    this.requireVersion(todo.version, expectedVersion);
    if (!text.trim()) throw new WorkspaceApiError('VALIDATION', 'Checklist item text is required.');
    const resolvedSupporterId = supporterId ?? todo.ownerId;
    this.requireChecklistSupporter(todo.teamId, resolvedSupporterId);
    const timestamp = nowIso();
    const item: TodoChecklistItem = { id: `checklist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: text.trim(), completed: false, supporterId: resolvedSupporterId, createdAt: timestamp, updatedAt: timestamp };
    todo.checklist = [...(todo.checklist ?? []), item];
    todo.updatedAt = timestamp;
    todo.updatedBy = this.workspace.currentUser.id;
    todo.version += 1;
    this.audit('Added To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return this.result();
  }

  async updateTodoChecklistItem(todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>, expectedVersion?: number) {
    const todo = this.todo(todoId);
    this.requireWrite(todo.teamId);
    this.requireVersion(todo.version, expectedVersion);
    const item = (todo.checklist ?? []).find((candidate) => candidate.id === itemId);
    if (!item) throw new WorkspaceApiError('NOT_FOUND', 'Checklist item not found.');
    if (input.text !== undefined && !input.text.trim()) throw new WorkspaceApiError('VALIDATION', 'Checklist item text is required.');
    if (input.completed !== undefined && typeof input.completed !== 'boolean') throw new WorkspaceApiError('VALIDATION', 'Checklist completion must be true or false.');
    if (input.supporterId !== undefined) this.requireChecklistSupporter(todo.teamId, input.supporterId);
    Object.assign(item, { ...input, text: input.text?.trim() ?? item.text, updatedAt: nowIso() });
    todo.updatedAt = item.updatedAt;
    todo.updatedBy = this.workspace.currentUser.id;
    todo.version += 1;
    this.audit('Updated To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return this.result();
  }

  async deleteTodoChecklistItem(todoId: string, itemId: string, expectedVersion?: number) {
    const todo = this.todo(todoId);
    this.requireWrite(todo.teamId);
    this.requireVersion(todo.version, expectedVersion);
    const item = (todo.checklist ?? []).find((candidate) => candidate.id === itemId);
    if (!item) throw new WorkspaceApiError('NOT_FOUND', 'Checklist item not found.');
    todo.checklist = todo.checklist.filter((candidate) => candidate.id !== itemId);
    todo.updatedAt = nowIso();
    todo.updatedBy = this.workspace.currentUser.id;
    todo.version += 1;
    this.audit('Removed To-Do checklist item', todo.id, `${todo.title}: ${item.text}`, 'todo');
    return this.result();
  }

  private metric(metricId: string) {
    const metric = this.workspace.metrics.find((item) => item.id === metricId);
    if (!metric) throw new WorkspaceApiError('NOT_FOUND', 'Measurable not found.');
    this.requireRead(metric.teamId);
    return metric;
  }

  private validateScorecardOwner(teamId: string, ownerId: string) {
    if (!this.workspace.users.some((user) => user.id === ownerId && user.active)) throw new WorkspaceApiError('VALIDATION', 'Measurable owner not found.');
    if (!this.workspace.memberships.some((membership) => membership.teamId === teamId && membership.userId === ownerId && membership.active)) throw new WorkspaceApiError('VALIDATION', 'Measurable owner must be an active member of the team.');
  }

  private validateScorecardWeek(weekStartDate: string) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate) || weekStartDateFor(weekStartDate) !== weekStartDate) throw new WorkspaceApiError('VALIDATION', 'Week start must be a valid Monday date.');
    } catch (error) {
      if (error instanceof WorkspaceApiError) throw error;
      throw new WorkspaceApiError('VALIDATION', 'Week start must be a valid Monday date.');
    }
  }

  async createScorecardMetric(input: Pick<ScorecardMetric, 'teamId' | 'label' | 'target' | 'unit' | 'ownerId'>) {
    this.requireWrite(input.teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === input.teamId && candidate.active);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Grouping-only teams cannot own measurables.');
    if (!input.label.trim() || !input.target.trim() || !input.unit.trim()) throw new WorkspaceApiError('VALIDATION', 'Label, target, and unit are required.');
    this.validateScorecardOwner(input.teamId, input.ownerId);
    const timestamp = nowIso();
    const metric: ScorecardMetric = { id: `metric-${slugify(input.label)}-${Date.now()}`, teamId: input.teamId, label: input.label.trim(), target: input.target.trim(), unit: input.unit.trim(), ownerId: input.ownerId, createdAt: timestamp, updatedAt: timestamp, version: 1 };
    this.workspace.metrics.push(metric);
    this.audit('Created Scorecard measurable', metric.id, metric.label, 'team');
    return this.result();
  }

  async updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetric, 'label' | 'target' | 'unit' | 'ownerId'>>, expectedVersion?: number) {
    const metric = this.metric(metricId);
    this.requireWrite(metric.teamId);
    this.requireVersion(metric.version, expectedVersion);
    if (input.label !== undefined && !input.label.trim()) throw new WorkspaceApiError('VALIDATION', 'Measurable label is required.');
    if (input.target !== undefined && !input.target.trim()) throw new WorkspaceApiError('VALIDATION', 'Measurable target is required.');
    if (input.unit !== undefined && !input.unit.trim()) throw new WorkspaceApiError('VALIDATION', 'Measurable unit is required.');
    if (input.ownerId !== undefined) this.validateScorecardOwner(metric.teamId, input.ownerId);
    Object.assign(metric, { ...input, label: input.label?.trim() ?? metric.label, target: input.target?.trim() ?? metric.target, unit: input.unit?.trim() ?? metric.unit, updatedAt: nowIso(), version: metric.version + 1 });
    this.audit('Updated Scorecard measurable', metric.id, metric.label, 'team');
    return this.result();
  }

  async upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResult, 'actual' | 'status'>, expectedVersion?: number) {
    const metric = this.metric(metricId);
    this.requireWrite(metric.teamId);
    this.validateScorecardWeek(weekStartDate);
    if (typeof input.actual !== 'string' || !input.actual.trim()) throw new WorkspaceApiError('VALIDATION', 'Actual value is required.');
    if (!['on-track', 'off-track'].includes(input.status)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid measurable status.');
    const result = this.workspace.scorecardResults.find((candidate) => candidate.metricId === metricId && candidate.weekStartDate === weekStartDate);
    const priorWeek = weekStartDateFor(new Date(new Date(`${weekStartDate}T12:00:00Z`).getTime() - 7 * DAY));
    const prior = this.workspace.scorecardResults.find((candidate) => candidate.metricId === metricId && candidate.weekStartDate === priorWeek);
    const trend = scorecardTrendFor(input.actual, prior?.actual);
    const timestamp = nowIso();
    if (result) {
      this.requireVersion(result.version, expectedVersion);
      Object.assign(result, { actual: input.actual.trim(), status: input.status, ...trend, updatedAt: timestamp, version: result.version + 1 });
    } else {
      if (expectedVersion !== undefined) throw new WorkspaceApiError('CONFLICT', 'This weekly result does not exist yet. Refresh and try again.');
      this.workspace.scorecardResults.push({ id: `result-${metricId}-${weekStartDate}`, metricId, teamId: metric.teamId, weekStartDate, actual: input.actual.trim(), status: input.status, ...trend, createdAt: timestamp, updatedAt: timestamp, version: 1 });
    }
    this.audit('Updated Scorecard result', result?.id ?? `result-${metricId}-${weekStartDate}`, `${metric.label} · ${weekStartDate}`, 'team');
    return this.result();
  }

  async createIssueFromScorecard(metricId: string, weekStartDate: string, expectedVersion?: number) {
    const metric = this.metric(metricId);
    this.requireWrite(metric.teamId);
    this.validateScorecardWeek(weekStartDate);
    const result = this.workspace.scorecardResults.find((candidate) => candidate.metricId === metricId && candidate.weekStartDate === weekStartDate);
    if (!result || result.status !== 'off-track') throw new WorkspaceApiError('VALIDATION', 'Only an off-track Scorecard result can become an Issue.');
    this.requireVersion(result.version, expectedVersion);
    const existing = this.workspace.issues.find((issue) => issue.teamId === metric.teamId && issue.assignmentState !== 'redirected' && issue.linkedScorecardMetricId === metricId && issue.linkedScorecardWeekStartDate === weekStartDate);
    if (existing) return this.result();
    const timestamp = nowIso();
    const issue: Issue = {
      id: `issue-scorecard-${metricId}-${weekStartDate}`,
      teamId: metric.teamId,
      quarterId: quarterIdForDate(weekStartDate, this.workspace.quarters),
      sourceTeamId: metric.teamId,
      currentTeamId: metric.teamId,
      title: `Scorecard: ${metric.label}`,
      detail: `${metric.label} is ${result.actual} against a target of ${metric.target} ${metric.unit} for the week of ${weekStartDate}.`,
      priority: 1,
      status: 'open',
      horizon: 'short-term',
      assignmentState: 'assigned',
      raisedById: this.workspace.currentUser.id,
      ownerId: metric.ownerId,
      createdAt: timestamp,
      updatedAt: timestamp,
      ageInDays: 0,
      ageBand: 'fresh',
      meetingBand: issueMeetingBand(0, 'open'),
      linkedScorecardMetricId: metricId,
      linkedScorecardWeekStartDate: weekStartDate,
      version: 1,
      meetingsPassed: 0,
      escalationState: 'not-scheduled',
      escalationLevel: 0,
    };
    this.workspace.issues.unshift(issue);
    this.audit('Created Issue from Scorecard', issue.id, `${metric.label} · ${weekStartDate}`, 'issue');
    return this.result();
  }

  async createIssueFromRock(rockId: string, expectedVersion?: number) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    this.requireVersion(rock.version, expectedVersion);
    if (rock.status !== 'off-track') throw new WorkspaceApiError('VALIDATION', 'Only an off-track Rock can become an Issue.');
    const existing = this.workspace.issues.find((issue) => issue.assignmentState !== 'redirected' && issue.linkedRockId === rockId);
    if (existing) return this.result();
    const timestamp = nowIso();
    const issue: Issue = {
      id: `issue-rock-${rock.id}`,
      teamId: rock.teamId,
      quarterId: rock.quarterId,
      sourceTeamId: rock.teamId,
      currentTeamId: rock.teamId,
      title: `Off-track Rock: ${rock.title}`,
      detail: rock.description || (() => { const milestones = rockMilestoneCounts(rock); return `The Rock has ${milestones.remaining} milestone${milestones.remaining === 1 ? '' : 's'} remaining and is marked off-track.`; })(),
      priority: rock.priority === 'high' ? 1 : rock.priority === 'medium' ? 3 : 5,
      status: 'open',
      horizon: 'short-term',
      assignmentState: 'assigned',
      raisedById: this.workspace.currentUser.id,
      ownerId: rock.ownerId,
      createdAt: timestamp,
      updatedAt: timestamp,
      ageInDays: 0,
      ageBand: 'fresh',
      meetingBand: issueMeetingBand(0, 'open'),
      linkedRockId: rock.id,
      version: 1,
      meetingsPassed: 0,
      escalationState: 'not-scheduled',
      escalationLevel: 0,
    };
    this.workspace.issues.unshift(issue);
    this.audit('Created Issue from Rock', issue.id, `${rock.title} · off-track`, 'issue');
    return this.result();
  }

  async addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string; sourceIssueId?: string; quarterId?: string }) {
    this.requireWrite(input.teamId);
    if (!input.title.trim()) throw new WorkspaceApiError('VALIDATION', 'To-Do title is required.');
    if (!this.workspace.users.some((user) => user.id === input.ownerId && user.active)) throw new WorkspaceApiError('VALIDATION', 'To-Do owner not found.');
    const dueDate = normalizeTodoDate(input.dueDate);
    const quarterId = this.assertQuarterDate(input.quarterId, dueDate);
    if (input.sourceIssueId) {
      const sourceIssue = this.issue(input.sourceIssueId);
      if (sourceIssue.teamId !== input.teamId) throw new WorkspaceApiError('VALIDATION', 'Source Issue must belong to the same team.');
    }
    const timestamp = nowIso();
    this.workspace.todos.unshift({ ...input, quarterId, dueDate, id: `todo-${Date.now()}`, notes: sanitizeTodoNotes(input.notes), status: 'open', origin: input.linkedRockTaskId ? 'Rock Task' : input.sourceIssueId ? 'Issue follow-up' : 'Team workspace', checklist: [], createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1, carryForwardCount: 0, flagged: false });
    this.audit('Created To-Do', this.workspace.todos[0].id, input.title, 'todo');
    return this.result();
  }

  async startIssue(issueId: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    if (issue.horizon === 'long-term') throw new WorkspaceApiError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    this.requireVersion(issue.version, expectedVersion);
    const meeting = this.workspace.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    issue.status = 'in-ids';
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = timestamp;
      meeting.version = (meeting.version ?? 1) + 1;
    }
    this.audit('Started IDS', issue.id, issue.title, 'issue');
    return this.result();
  }

  async parkIssue(issueId: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    if (issue.horizon === 'long-term') throw new WorkspaceApiError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    if (issue.status === 'solved') return this.result();
    this.requireVersion(issue.version, expectedVersion);
    const timestamp = nowIso();
    const meeting = this.workspace.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    issue.status = 'parked';
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, 'Parked for a future IDS conversation.');
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = timestamp;
      meeting.version = (meeting.version ?? 1) + 1;
    }
    this.audit('Parked Issue', issue.id, issue.title, 'issue');
    return this.result();
  }

  async solveIssue(issueId: string, input: SolveIssueInput, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    if (issue.status === 'solved') return this.result();
    this.requireVersion(issue.version, expectedVersion);
    if (typeof input.createFollowUpTodo !== 'boolean') throw new WorkspaceApiError('VALIDATION', 'Choose whether to create a follow-up To-Do.');
    if (input.resolutionNote !== undefined && typeof input.resolutionNote !== 'string') throw new WorkspaceApiError('VALIDATION', 'Resolution note must be a string.');
    const meeting = this.workspace.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed' && item.status !== 'skipped');
    if (meeting && !meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    issue.status = 'solved';
    issue.solvedAt = timestamp;
    issue.updatedAt = issue.solvedAt;
    issue.updatedBy = this.workspace.currentUser.id;
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
      meeting.updatedAt = issue.updatedAt;
      meeting.version = (meeting.version ?? 1) + 1;
    }
    const followUpId = `todo-follow-up-${issue.id}`;
    const followUpExists = this.workspace.todos.some((todo) => todo.id === followUpId);
    let followUpCreated = false;
    if (input.createFollowUpTodo && !followUpExists) {
      this.workspace.todos.unshift({ id: followUpId, teamId: issue.teamId, quarterId: issue.quarterId, title: `Follow up on the solution: ${issue.title}`, notes: '', ownerId: this.workspace.currentUser.id, dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), status: 'open', origin: `IDS · ${issue.title}`, sourceIssueId: issue.id, checklist: [], createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1, carryForwardCount: 0, flagged: false });
      followUpCreated = true;
      if (meeting) {
        meeting.createdTodoIds.push(followUpId);
        meeting.updatedAt = nowIso();
        meeting.version = (meeting.version ?? 1) + 1;
      }
    }
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, `Resolved. Follow-up To-Do ${input.createFollowUpTodo ? 'created' : 'not created'}.${input.resolutionNote?.trim() ? ` ${input.resolutionNote.trim()}` : ''}`);
    issue.updatedAt = timestamp;
    issue.version += 1;
    this.audit('Solved Issue', issue.id, `${issue.title}; follow-up To-Do ${followUpCreated ? 'created' : 'not created'}.`, 'issue');
    return this.result();
  }

  async reopenIssue(issueId: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    if (issue.status !== 'solved') return this.result();
    this.requireVersion(issue.version, expectedVersion);
    const timestamp = nowIso();
    issue.status = 'open';
    delete issue.solvedAt;
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, 'Reopened for another IDS conversation.');
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    this.audit('Reopened Issue', issue.id, `Reopened ${issue.title} for another IDS conversation.`, 'issue');
    return this.result();
  }

  async createHeadline(input: Pick<Headline, 'teamId' | 'type' | 'title' | 'detail'> & { meetingId?: string; issueId?: string }) {
    this.requireWrite(input.teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === input.teamId);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Grouping-only nodes cannot own Headlines.');
    if (input.type !== 'win' && input.type !== 'concern') throw new WorkspaceApiError('VALIDATION', 'Headline type must be win or concern.');
    if (!input.title.trim()) throw new WorkspaceApiError('VALIDATION', 'Headline title is required.');
    if (input.meetingId) {
      const meeting = this.workspace.meetings.find((candidate) => candidate.id === input.meetingId && candidate.teamId === input.teamId);
      if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
      if (meeting.status === 'closed' || meeting.status === 'skipped') throw new WorkspaceApiError('CONFLICT', 'Headlines can only be added to an upcoming or in-progress meeting.');
    }
    if (input.issueId) {
      const issue = this.issue(input.issueId);
      if (issue.teamId !== input.teamId) throw new WorkspaceApiError('VALIDATION', 'Linked Headline Issue must belong to the same team.');
    }
    const timestamp = nowIso();
    this.workspace.headlines.unshift({
      id: `headline-${Date.now()}`,
      teamId: input.teamId,
      authorId: this.workspace.currentUser.id,
      type: input.type,
      title: input.title.trim(),
      detail: typeof input.detail === 'string' ? sanitizeRichText(input.detail) : '',
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy: this.workspace.currentUser.id,
      version: 1,
      ...(input.meetingId ? { meetingId: input.meetingId } : {}),
      ...(input.issueId ? { issueId: input.issueId } : {}),
    });
    this.audit('Created Headline', this.workspace.headlines[0].id, input.title.trim(), 'team');
    return this.result();
  }

  async addIssue(input: Pick<Issue, 'title' | 'detail' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; quarterId?: string; linkedRockId?: string; linkedScorecardMetricId?: string; linkedScorecardWeekStartDate?: string; idsNote?: string }) {
    this.requireWrite(input.teamId);
    const quarterId = this.resolveQuarterId(input.quarterId);
    const timestamp = nowIso();
    const issue = { id: `issue-${Date.now()}`, teamId: input.teamId, quarterId, title: input.title, detail: sanitizeRichText(input.detail), sourceTeamId: input.teamId, currentTeamId: input.teamId, raisedById: input.raisedById, ownerId: input.ownerId ?? input.raisedById, priority: input.priority ?? 1, status: 'open' as const, horizon: input.horizon ?? 'short-term', assignmentState: 'assigned' as const, ...(input.linkedRockId ? { linkedRockId: input.linkedRockId } : {}), ...(input.linkedScorecardMetricId ? { linkedScorecardMetricId: input.linkedScorecardMetricId } : {}), ...(input.linkedScorecardWeekStartDate ? { linkedScorecardWeekStartDate: input.linkedScorecardWeekStartDate } : {}), ...(input.idsNote ? { idsNote: sanitizeRichText(input.idsNote) } : {}), createdAt: timestamp, updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, ageInDays: 0, ageBand: 'fresh' as const, meetingBand: issueMeetingBand(0, 'open'), version: 1, meetingsPassed: 0, escalationState: 'not-scheduled' as const, escalationLevel: 0 };
    this.workspace.issues.unshift(issue);
    this.audit('Created Issue', this.workspace.issues[0].id, input.title, 'issue');
    return this.result();
  }

  async updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    this.requireVersion(issue.version, expectedVersion);
    const allowedInput = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.detail !== undefined ? { detail: sanitizeRichText(input.detail) } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.idsNote !== undefined ? { idsNote: sanitizeRichText(input.idsNote) } : {}),
    };
    Object.assign(issue, allowedInput, { updatedAt: nowIso(), updatedBy: this.workspace.currentUser.id, version: issue.version + 1 });
    this.audit('Updated Issue', issue.id, `Updated ${issue.title}.`, 'issue');
    return this.result();
  }

  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    this.requireVersion(issue.version, expectedVersion);
    const cleanNote = sanitizeRichText(note);
    if (!richTextToPlainText(cleanNote)) throw new WorkspaceApiError('VALIDATION', 'Add a note before saving.');
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === issue.teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    if (meeting.status === 'closed') throw new WorkspaceApiError('CONFLICT', 'Closed meetings cannot receive new IDS notes.');
    if (!meeting.idsIssueIds.includes(issue.id) && meeting.idsIssueIds.length >= MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const timestamp = nowIso();
    const entry = { id: `meeting-note-${Date.now()}`, meetingId, issueId, authorId: this.workspace.currentUser.id, note: cleanNote, createdAt: timestamp };
    meeting.idsNotes.push(entry);
    if (!meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      if (!meeting.idsAddedIssueIds.includes(issue.id)) meeting.idsAddedIssueIds.push(issue.id);
    }
    meeting.idsTotal = meeting.idsIssueIds.length;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    issue.idsNote = appendHistoricalNote(issue.idsNote, timestamp, cleanNote);
    issue.status = issue.status === 'open' ? 'in-ids' : issue.status;
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    this.audit('Added meeting IDS note', issue.id, `${meeting.label}: ${richTextToPlainText(cleanNote)}`, 'issue');
    return this.result();
  }

  async updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status === 'closed') throw new WorkspaceApiError('CONFLICT', 'Closed meetings cannot receive notes.');
    if (!['segue', 'scorecard', 'rock-review', 'headlines', 'todo-review', 'ids', 'conclude'].includes(section)) throw new WorkspaceApiError('VALIDATION', 'Invalid meeting section.');
    if (typeof note !== 'string') throw new WorkspaceApiError('VALIDATION', 'Meeting note must be a string.');
    const cleanNote = sanitizeRichText(note);
    const normalizedNote = richTextToPlainText(cleanNote) ? cleanNote.trim() : '';
    const sectionNotes = { ...meeting.sectionNotes };
    if (normalizedNote) sectionNotes[section] = normalizedNote;
    else delete sectionNotes[section];
    meeting.sectionNotes = sectionNotes;
    meeting.updatedAt = nowIso();
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Updated meeting section notes', meeting.id, `${teamId} · ${section}`, 'meeting');
    return this.result();
  }

  async setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status === 'closed' || meeting.status === 'skipped') throw new WorkspaceApiError('CONFLICT', 'Closed meetings cannot change their IDS selection.');
    if (!Array.isArray(issueIds) || issueIds.some((issueId) => typeof issueId !== 'string')) throw new WorkspaceApiError('VALIDATION', 'IDS selection must be a list of Issue IDs.');
    if (issueIds.length > MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const unique = new Set<string>();
    for (const issueId of issueIds) {
      if (unique.has(issueId)) throw new WorkspaceApiError('VALIDATION', 'IDS selection cannot contain duplicates.');
      unique.add(issueId);
      const issue = this.workspace.issues.find((candidate) => candidate.id === issueId && candidate.assignmentState !== 'redirected');
      if (!issue || issue.teamId !== teamId || issue.horizon !== 'short-term' || issue.status === 'solved') throw new WorkspaceApiError('VALIDATION', 'Every selected Issue must be an active short-term Issue for this team.');
    }
    if (issueIds.every((issueId, index) => issueId === meeting.idsIssueIds[index]) && issueIds.length === meeting.idsIssueIds.length) return this.result();
    const timestamp = nowIso();
    const previous = new Set(meeting.idsIssueIds);
    meeting.idsIssueIds = [...issueIds];
    meeting.idsAddedIssueIds = [...new Set([...meeting.idsAddedIssueIds, ...issueIds.filter((issueId) => !previous.has(issueId))])];
    meeting.idsTotal = issueIds.length;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    for (const issueId of issueIds) {
      const issue = this.workspace.issues.find((candidate) => candidate.id === issueId);
      if (issue && issue.status !== 'in-ids') {
        issue.status = 'in-ids';
        issue.updatedAt = timestamp;
        issue.version += 1;
      }
    }
    this.audit('Selected IDS Issues', meeting.id, `${teamId} selected ${issueIds.length} Issues for IDS.`, 'meeting');
    return this.result();
  }

  async reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status === 'closed') throw new WorkspaceApiError('CONFLICT', 'Closed meetings cannot reorder Issues.');
    if (!Array.isArray(issueIds) || issueIds.some((issueId) => typeof issueId !== 'string')) throw new WorkspaceApiError('VALIDATION', 'Issue order must be a list of Issue IDs.');
    if (issueIds.length > MAX_IDS_ISSUES) throw new WorkspaceApiError('VALIDATION', `Select no more than ${MAX_IDS_ISSUES} Issues for an L10.`);
    const requested = new Set<string>();
    for (const issueId of issueIds) {
      if (requested.has(issueId)) throw new WorkspaceApiError('VALIDATION', 'Issue order cannot contain duplicates.');
      requested.add(issueId);
      if (!meeting.idsIssueIds.includes(issueId)) throw new WorkspaceApiError('VALIDATION', 'Issue order can only contain Issues already in this meeting.');
      const issue = this.workspace.issues.find((candidate) => candidate.id === issueId && candidate.assignmentState !== 'redirected');
      if (!issue || issue.teamId !== teamId) throw new WorkspaceApiError('VALIDATION', 'Every ordered Issue must belong to this team.');
    }
    const nextOrder = [...issueIds, ...meeting.idsIssueIds.filter((issueId) => !requested.has(issueId))];
    if (nextOrder.every((issueId, index) => issueId === meeting.idsIssueIds[index])) return this.result();
    meeting.idsIssueIds = nextOrder;
    meeting.idsTotal = nextOrder.length;
    meeting.updatedAt = nowIso();
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Reordered IDS Issues', meeting.id, `${teamId} IDS order updated.`, 'meeting');
    return this.result();
  }

  async transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    const team = this.workspace.teams.find((item) => item.id === teamId);
    if (!meeting || !team) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status !== 'in-progress') throw new WorkspaceApiError('CONFLICT', 'Start the meeting before moving between timed sections.');
    if (!meetingSectionIds.has(fromSection) || !meetingSectionIds.has(toSection) || !meetingSectionsFor(team).some((section) => section.id === fromSection) || !meetingSectionsFor(team).some((section) => section.id === toSection)) throw new WorkspaceApiError('VALIDATION', 'Choose valid sections for this meeting.');
    if (fromSection === toSection) return this.result();
    const timestamp = nowIso();
    const activeSection = meeting.activeSection ?? fromSection;
    const sectionStartedAt = meeting.activeSectionStartedAt ?? meeting.startedAt;
    const elapsed = activeSection && sectionStartedAt ? meetingElapsedSeconds(sectionStartedAt, timestamp) : 0;
    meeting.sectionDurations = { ...(meeting.sectionDurations ?? {}), [activeSection]: (meeting.sectionDurations?.[activeSection] ?? 0) + elapsed };
    meeting.activeSection = toSection;
    meeting.activeSectionStartedAt = timestamp;
    const nextIndex = meetingSectionsFor(team).findIndex((section) => section.id === toSection);
    meeting.agendaProgress = nextIndex >= 0 ? nextIndex + 1 : meeting.agendaProgress;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Moved L10 section', meeting.id, `${fromSection} → ${toSection}.`, 'meeting');
    return this.result();
  }

  async startMeeting(teamId: string, meetingId: string, expectedVersion?: number, facilitatorId?: string) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    const team = this.workspace.teams.find((item) => item.id === teamId);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (meeting.status === 'closed' || meeting.status === 'skipped') throw new WorkspaceApiError('CONFLICT', 'Closed or skipped meetings cannot be started.');
    const teamMemberIds = new Set(this.workspace.memberships.filter((membership) => membership.teamId === teamId && membership.active).map((membership) => membership.userId));
    const selectedFacilitatorId = facilitatorId ?? meeting.facilitatorId ?? this.workspace.currentUser.id;
    if (!this.workspace.users.some((user) => user.id === selectedFacilitatorId && user.active) || !teamMemberIds.has(selectedFacilitatorId)) throw new WorkspaceApiError('VALIDATION', 'The facilitator must be an active member of this team.');
    if (meeting.status === 'in-progress') {
      // Starting/resuming is safe to repeat from a second screen when the
      // meeting is already live and the facilitator is unchanged.
      if (meeting.facilitatorId === selectedFacilitatorId) return this.result();
      this.requireVersion(meeting.version ?? 1, expectedVersion);
      if (!this.canManageMeeting(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'Only a TeamLead or OrgAdmin can change the meeting facilitator.');
      const timestamp = nowIso();
      const previousFacilitatorId = meeting.facilitatorId;
      meeting.facilitatorId = selectedFacilitatorId;
      if (!meeting.attendeeIds.includes(selectedFacilitatorId)) meeting.attendeeIds = [...meeting.attendeeIds, selectedFacilitatorId];
      meeting.updatedAt = timestamp;
      meeting.version = (meeting.version ?? 1) + 1;
      this.audit('Changed L10 facilitator', meeting.id, `${previousFacilitatorId ?? 'No facilitator'} → ${selectedFacilitatorId}.`, 'meeting');
      return this.result();
    }
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    const timestamp = nowIso();
    meeting.status = 'in-progress';
    meeting.startedAt = meeting.startedAt ?? timestamp;
    meeting.facilitatorId = selectedFacilitatorId;
    if (!meeting.attendeeIds.includes(selectedFacilitatorId)) meeting.attendeeIds = [...meeting.attendeeIds, selectedFacilitatorId];
    meeting.activeSection = meeting.activeSection ?? meetingSectionsFor(team)[0]?.id ?? 'conclude';
    meeting.activeSectionStartedAt = meeting.activeSectionStartedAt ?? timestamp;
    meeting.sectionDurations = meeting.sectionDurations ?? {};
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Started L10 meeting', meeting.id, `${this.workspace.teams.find((team) => team.id === teamId)?.name ?? teamId} L10 started.`, 'meeting');
    return this.result();
  }

  async requestIssueTransfer(issueId: string, destinationTeamId: string, note?: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    this.requireVersion(issue.version, expectedVersion);
    const destination = this.workspace.teams.find((team) => team.id === destinationTeamId && team.active);
    if (!destination || destination.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Issues can only be sent to active operational teams.');
    if (destinationTeamId === issue.teamId || issue.status === 'solved') throw new WorkspaceApiError('VALIDATION', 'This Issue cannot be transferred to that team.');
    if (issue.assignmentState === 'pending-transfer') throw new WorkspaceApiError('CONFLICT', 'This Issue already has a pending transfer.');
    const timestamp = nowIso();
    const transfer: IssueTransfer = { id: `transfer-${Date.now()}`, issueId, sourceTeamId: issue.teamId, destinationTeamId, requestedById: this.workspace.currentUser.id, requestedAt: timestamp, status: 'pending', sourceIssueVersion: issue.version + 1, note, version: 1 };
    this.workspace.transfers.unshift(transfer);
    issue.assignmentState = 'pending-transfer';
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    this.workspace.memberships.filter((membership) => membership.teamId === destinationTeamId && membership.active && membership.role !== 'Viewer').forEach((membership) => {
      this.notify(membership.userId, { type: 'issue-transfer-requested', title: `Issue transferred to ${destination.shortName}`, message: `${issue.title} is waiting for your team to accept or reject it.`, issueId, transferId: transfer.id, teamId: destinationTeamId });
    });
    this.audit('Requested Issue transfer', issue.id, `Sent from ${transfer.sourceTeamId} to ${transfer.destinationTeamId}.`, 'transfer');
    return this.result();
  }

  async acceptIssueTransfer(transferId: string, expectedVersion?: number) {
    const transfer = activeTransfer(this.workspace.transfers, transferId);
    this.requireVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new WorkspaceApiError('CONFLICT', 'This transfer has already been decided.');
    this.requireWrite(transfer.destinationTeamId);
    const sourceIssue = this.workspace.issues.find((issue) => issue.id === transfer.issueId && issue.assignmentState === 'pending-transfer');
    if (!sourceIssue) throw new WorkspaceApiError('CONFLICT', 'The source Issue is no longer waiting for this transfer.');
    this.requireVersion(sourceIssue.version, transfer.sourceIssueVersion);
    const timestamp = nowIso();
    const existing = this.workspace.issues.find((issue) => issue.id === sourceIssue.id && issue.teamId === transfer.destinationTeamId && issue.assignmentState !== 'redirected');
    if (!existing) {
      this.workspace.issues.push({ ...sourceIssue, teamId: transfer.destinationTeamId, currentTeamId: transfer.destinationTeamId, assignmentState: 'assigned', updatedAt: timestamp, updatedBy: this.workspace.currentUser.id, version: 1 });
    }
    sourceIssue.assignmentState = 'redirected';
    sourceIssue.currentTeamId = transfer.destinationTeamId;
    sourceIssue.updatedAt = timestamp;
    sourceIssue.updatedBy = this.workspace.currentUser.id;
    sourceIssue.version += 1;
    transfer.status = 'accepted';
    transfer.decidedById = this.workspace.currentUser.id;
    transfer.decidedAt = timestamp;
    transfer.version += 1;
    this.workspace.memberships.filter((membership) => membership.teamId === transfer.sourceTeamId && membership.active && membership.userId !== this.workspace.currentUser.id).forEach((membership) => {
      this.notify(membership.userId, { type: 'issue-transfer-decided', title: 'Issue transfer accepted', message: `${sourceIssue.title} was accepted by the destination team.`, issueId: sourceIssue.id, transferId: transfer.id, teamId: transfer.sourceTeamId });
    });
    this.audit('Accepted Issue transfer', sourceIssue.id, `Moved to ${transfer.destinationTeamId}.`, 'transfer');
    return this.result();
  }

  async rejectIssueTransfer(transferId: string, message: string, expectedVersion?: number) {
    const transfer = activeTransfer(this.workspace.transfers, transferId);
    this.requireVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new WorkspaceApiError('CONFLICT', 'This transfer has already been decided.');
    if (!message.trim()) throw new WorkspaceApiError('VALIDATION', 'A rejection message is required.');
    this.requireWrite(transfer.destinationTeamId);
    const issue = this.workspace.issues.find((item) => item.id === transfer.issueId && item.assignmentState === 'pending-transfer');
    if (!issue) throw new WorkspaceApiError('CONFLICT', 'The source Issue is no longer waiting for this transfer.');
    this.requireVersion(issue.version, transfer.sourceIssueVersion);
    const timestamp = nowIso();
    issue.assignmentState = 'unassigned';
    issue.currentTeamId = null;
    issue.ownerId = undefined;
    issue.updatedAt = timestamp;
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    transfer.status = 'rejected';
    transfer.rejectionMessage = message.trim();
    transfer.decidedById = this.workspace.currentUser.id;
    transfer.decidedAt = timestamp;
    transfer.version += 1;
    this.workspace.memberships.filter((membership) => membership.teamId === transfer.sourceTeamId && membership.active).forEach((membership) => {
      this.notify(membership.userId, { type: 'issue-transfer-decided', title: 'Issue returned unassigned', message: `${issue.title} was rejected: ${message.trim()}`, issueId: issue.id, transferId: transfer.id, teamId: transfer.sourceTeamId });
    });
    this.audit('Rejected Issue transfer', issue.id, `Returned to ${transfer.sourceTeamId} unassigned: ${message.trim()}`, 'transfer');
    return this.result();
  }

  async cancelIssueTransfer(transferId: string, expectedVersion?: number) {
    const transfer = activeTransfer(this.workspace.transfers, transferId);
    this.requireVersion(transfer.version, expectedVersion);
    if (transfer.status !== 'pending') throw new WorkspaceApiError('CONFLICT', 'This transfer has already been decided.');
    this.requireWrite(transfer.sourceTeamId);
    const issue = this.workspace.issues.find((item) => item.id === transfer.issueId && item.assignmentState === 'pending-transfer');
    if (!issue) throw new WorkspaceApiError('CONFLICT', 'The source Issue is no longer waiting for this transfer.');
    this.requireVersion(issue.version, transfer.sourceIssueVersion);
    issue.assignmentState = 'assigned';
    issue.currentTeamId = issue.teamId;
    issue.updatedAt = nowIso();
    issue.updatedBy = this.workspace.currentUser.id;
    issue.version += 1;
    transfer.status = 'cancelled';
    transfer.decidedById = this.workspace.currentUser.id;
    transfer.decidedAt = nowIso();
    transfer.version += 1;
    this.audit('Cancelled Issue transfer', issue.id, `Kept in ${transfer.sourceTeamId}.`, 'transfer');
    return this.result();
  }

  async sendTeamMessage(input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>) {
    this.requireWrite(input.fromTeamId);
    const destination = this.workspace.teams.find((team) => team.id === input.toTeamId && team.active && team.nodeType === 'operational');
    if (!destination) throw new WorkspaceApiError('VALIDATION', 'Choose an active operational destination team.');
    if (input.fromTeamId === input.toTeamId) throw new WorkspaceApiError('VALIDATION', 'Messages are for cross-team communication.');
    if (!input.subject.trim() || !input.body.trim()) throw new WorkspaceApiError('VALIDATION', 'A subject and message are required.');
    const timestamp = nowIso();
    this.workspace.messages.unshift({ id: `message-${Date.now()}`, fromTeamId: input.fromTeamId, toTeamId: input.toTeamId, senderId: this.workspace.currentUser.id, subject: input.subject.trim(), body: input.body.trim(), status: 'unread', createdAt: timestamp, updatedAt: timestamp, version: 1 });
    const message = this.workspace.messages[0];
    this.workspace.memberships.filter((membership) => membership.teamId === destination.id && membership.active).forEach((membership) => {
      this.notify(membership.userId, { type: 'team-message', title: `New message from ${teamForMessage(this.workspace, input.fromTeamId)}`, message: input.subject.trim(), teamId: destination.id });
    });
    this.audit('Sent team message', message.id, `${teamForMessage(this.workspace, input.fromTeamId)} → ${destination.name}: ${message.subject}`, 'team');
    return this.result();
  }

  async markMessageRead(messageId: string) {
    const message = this.workspace.messages.find((item) => item.id === messageId);
    if (!message) throw new WorkspaceApiError('NOT_FOUND', 'Message not found.');
    this.requireRead(message.toTeamId);
    if (message.status === 'unread') {
      message.status = 'read';
      message.readAt = nowIso();
      message.updatedAt = message.readAt;
      message.version += 1;
    }
    return this.result();
  }

  async createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId'>) {
    const message = this.workspace.messages.find((item) => item.id === messageId);
    if (!message) throw new WorkspaceApiError('NOT_FOUND', 'Message not found.');
    this.requireWrite(message.toTeamId);
    if (message.convertedIssueId) return this.result();
    const timestamp = nowIso();
    const issueId = `issue-message-${message.id}`;
    const detail = sanitizeRichText(input.detail);
    const issue: Issue = { id: issueId, teamId: message.toTeamId, sourceTeamId: message.toTeamId, currentTeamId: message.toTeamId, title: input.title.trim(), detail, priority: input.priority, status: 'open', horizon: input.horizon, assignmentState: 'assigned', raisedById: this.workspace.currentUser.id, ownerId: input.ownerId, createdAt: timestamp, updatedAt: timestamp, ageInDays: 0, ageBand: 'fresh', meetingBand: issueMeetingBand(0, 'open'), version: 1, meetingsPassed: 0, escalationState: 'not-scheduled', escalationLevel: 0 };
    if (!issue.title || !issue.detail) throw new WorkspaceApiError('VALIDATION', 'An Issue title and detail are required.');
    this.workspace.issues.unshift(issue);
    message.status = 'converted';
    message.convertedIssueId = issueId;
    message.readAt = message.readAt ?? timestamp;
    message.updatedAt = timestamp;
    message.version += 1;
    this.audit('Created Issue from team message', issue.id, `${message.subject} → ${issue.title}`, 'issue');
    return this.result();
  }

  async markNotificationRead(notificationId: string) {
    const notification = this.workspace.notifications.find((item) => item.id === notificationId && item.recipientUserId === this.workspace.currentUser.id);
    if (!notification) throw new WorkspaceApiError('NOT_FOUND', 'Notification not found.');
    notification.readAt = nowIso();
    return this.result();
  }

  async updateProfile(input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>) {
    if (input.avatarDataUrl && !avatarIsValid(input.avatarDataUrl)) throw new WorkspaceApiError('VALIDATION', 'Use a PNG, JPEG, or WebP avatar smaller than 256 KB.');
    const user = this.workspace.users.find((item) => item.id === this.workspace.currentUser.id);
    if (!user) throw new WorkspaceApiError('NOT_FOUND', 'Profile not found.');
    if (input.name !== undefined && !input.name.trim()) throw new WorkspaceApiError('VALIDATION', 'Name is required.');
    if (input.email !== undefined && !input.email.trim()) throw new WorkspaceApiError('VALIDATION', 'Email is required.');
    if (input.email !== undefined && this.workspace.users.some((candidate) => candidate.id !== user.id && candidate.email.toLowerCase() === input.email!.trim().toLowerCase())) throw new WorkspaceApiError('CONFLICT', 'A user with that email already exists.');
    const version = user.version ?? 1;
    Object.assign(user, { ...input, name: input.name?.trim() ?? user.name, email: input.email?.trim() ?? user.email, updatedAt: nowIso(), version: version + 1 });
    this.workspace.currentUser = user;
    this.audit('Updated profile', user.id, 'Profile details or avatar changed.', 'profile');
    return this.result();
  }

  async createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) {
    this.requireAdmin();
    if (!input.parentTeamId) throw new WorkspaceApiError('VALIDATION', 'New teams must be placed under the Leadership Team.');
    if (input.parentTeamId && !this.workspace.teams.some((team) => team.id === input.parentTeamId)) throw new WorkspaceApiError('VALIDATION', 'Parent team not found.');
    const id = slugify(input.name);
    if (this.workspace.teams.some((team) => team.id === id)) throw new WorkspaceApiError('CONFLICT', 'A team with that name already exists.');
    if (input.meetingCadence !== 'weekly' && input.meetingCadence !== 'monthly') throw new WorkspaceApiError('VALIDATION', 'Meeting cadence must be weekly or monthly.');
    validateMeetingConfiguration(input.meetingCadence, input.meetingDay, input.meetingTime);
    const team: Team = { ...input, id, meetingSections: validateMeetingSections(input.meetingSections), escalationUserIds: input.escalationUserIds ?? [], memberCount: 0, active: true };
    this.workspace.teams.push(team);
    if (team.nodeType === 'operational') {
      const scheduledDate = meetingDateFor(team);
      this.workspace.meetings.push({ id: `meeting-${team.id}-current`, teamId: team.id, quarterId: quarterIdForDate(scheduledDate, this.workspace.quarters), label: `${team.shortName} L10`, dateLabel: meetingDateLabel(scheduledDate), scheduledDate, scheduledTime: team.meetingTime, recurrenceDate: scheduledDate, weekStartDate: weekStartDateFor(scheduledDate), status: 'upcoming', facilitatorId: team.escalationUserIds[0] ?? this.workspace.currentUser.id, attendeeIds: [], lastRating: 0, agendaProgress: 0, agendaTotal: meetingSectionsFor(team).length, idsSolved: 0, idsTotal: 0, recap: '', startedAt: undefined, closedAt: undefined, sectionNotes: {}, idsIssueIds: [], idsAddedIssueIds: [], createdTodoIds: [], idsNotes: [], version: 1 });
      this.ensureUpcomingMeetingWindow(team);
    }
    this.audit('Created team', id, input.name, 'team');
    return this.result();
  }

  async updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>, expectedVersion?: number) {
    this.requireAdmin();
    const team = this.workspace.teams.find((item) => item.id === teamId);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (teamId === 'leadership' && input.parentTeamId !== undefined && input.parentTeamId !== null) throw new WorkspaceApiError('VALIDATION', 'Leadership Team must remain the hierarchy root.');
    if (teamId !== 'leadership' && input.parentTeamId === null) throw new WorkspaceApiError('VALIDATION', 'Teams must remain under the Leadership Team hierarchy.');
    if (input.parentTeamId === teamId || (input.parentTeamId && this.descendantIds(teamId).includes(input.parentTeamId))) throw new WorkspaceApiError('VALIDATION', 'A team cannot be its own ancestor.');
    if (input.parentTeamId && !this.workspace.teams.some((item) => item.id === input.parentTeamId)) throw new WorkspaceApiError('VALIDATION', 'Parent team not found.');
    if (input.meetingCadence !== undefined && input.meetingCadence !== 'weekly' && input.meetingCadence !== 'monthly') throw new WorkspaceApiError('VALIDATION', 'Meeting cadence must be weekly or monthly.');
    validateMeetingConfiguration(input.meetingCadence ?? team.meetingCadence, input.meetingDay ?? team.meetingDay, input.meetingTime ?? team.meetingTime);
    if (team.nodeType === 'operational' && input.nodeType === 'grouping' && (this.workspace.rocks.some((rock) => rock.teamId === teamId) || this.workspace.todos.some((todo) => todo.teamId === teamId) || activeIssues(this.workspace.issues).some((issue) => issue.teamId === teamId))) throw new WorkspaceApiError('VALIDATION', 'Resolve active work before changing this node to grouping-only.');
    const meetingSections = input.meetingSections === undefined ? undefined : validateMeetingSections(input.meetingSections);
    this.requireVersion(team.version ?? 1, expectedVersion);
    if (input.escalationUserIds?.some((userId) => !this.workspace.users.some((user) => user.id === userId && user.active))) throw new WorkspaceApiError('VALIDATION', 'Every escalation recipient must be an active user.');
    Object.assign(team, input, meetingSections ? { meetingSections } : {}, { version: (team.version ?? 1) + 1 });
    this.audit('Updated team', team.id, team.name, 'team');
    return this.result();
  }

  private createUpcomingMeeting(team: Team, scheduledDate: string, template?: Workspace['meetings'][number], idsIssueIds: string[] = []): Workspace['meetings'][number] {
    const sections = meetingSectionsFor(team);
    return {
      id: `meeting-${team.id}-${scheduledDate}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      teamId: team.id,
      quarterId: quarterIdForDate(scheduledDate, this.workspace.quarters),
      label: `${team.shortName} L10`,
      dateLabel: meetingDateLabel(scheduledDate),
      scheduledDate,
      scheduledTime: team.meetingTime,
      recurrenceDate: scheduledDate,
      weekStartDate: weekStartDateFor(scheduledDate),
      status: 'upcoming',
      facilitatorId: team.escalationUserIds[0] ?? template?.facilitatorId ?? this.workspace.currentUser.id,
      attendeeIds: [...(template?.attendeeIds ?? this.workspace.memberships.filter((membership) => membership.teamId === team.id && membership.active).map((membership) => membership.userId))],
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
      version: 1,
    };
  }

  private ensureUpcomingMeetingWindow(team: Team, carriedIssueIds: string[] = [], template?: Workspace['meetings'][number]) {
    const now = Date.now();
    const upcoming = () => this.workspace.meetings.filter((meeting) => meeting.teamId === team.id && meeting.status === 'upcoming' && (!Number.isFinite(meetingScheduledAt(meeting)) || meetingScheduledAt(meeting) >= now)).sort((left, right) => `${left.scheduledDate}T${left.scheduledTime}`.localeCompare(`${right.scheduledDate}T${right.scheduledTime}`));
    let openMeetings = upcoming();
    const first = openMeetings[0];
    if (first && carriedIssueIds.length) {
      first.idsIssueIds = [...carriedIssueIds];
      first.idsTotal = carriedIssueIds.length;
    }
    const cadenceDates = this.workspace.meetings
      .filter((meeting) => meeting.teamId === team.id)
      .map((meeting) => meeting.recurrenceDate ?? meeting.scheduledDate)
      .filter((date): date is string => Boolean(date))
      .sort();
    let cursor = cadenceDates.at(-1) ?? template?.recurrenceDate ?? template?.scheduledDate ?? meetingDateFor(team);
    while (openMeetings.length < 4) {
      const nextDate = nextConfiguredMeetingDateAfter(team, cursor, cursor);
      const existing = this.workspace.meetings.some((meeting) => meeting.teamId === team.id && (meeting.recurrenceDate ?? meeting.scheduledDate) === nextDate);
      cursor = nextDate;
      if (existing) {
        openMeetings = upcoming();
        continue;
      }
      const next = this.createUpcomingMeeting(team, nextDate, template ?? openMeetings.at(-1), carriedIssueIds);
      this.workspace.meetings.push(next);
      openMeetings = upcoming();
    }
  }

  private maintainMeetingWindows() {
    this.workspace.teams.filter((team) => team.active && team.nodeType === 'operational').forEach((team) => this.ensureUpcomingMeetingWindow(team));
  }

  private queueLocalSummary(environment: EnvironmentId, teamId: string, meetingId: string, sourceWorkspace: Workspace, source: 'close' | 'legacy') {
    const timer = setTimeout(() => {
      const targetWorkspace = this.workspaces[environment];
      const meeting = targetWorkspace.meetings.find((candidate) => candidate.id === meetingId && candidate.teamId === teamId);
      const team = targetWorkspace.teams.find((candidate) => candidate.id === teamId);
      const sourceMeeting = sourceWorkspace.meetings.find((candidate) => candidate.id === meetingId);
      if (!meeting || !team || meeting.status !== 'closed' || meeting.aiSummaryStatus !== 'queued') return;
      meeting.aiSummary = meetingAiSummary(sourceWorkspace, team, sourceMeeting ?? meeting, source);
      meeting.aiSummaryStatus = 'ready';
      meeting.aiSummarySource = source;
      meeting.aiSummaryGeneratedAt = meeting.aiSummary.generatedAt;
      meeting.aiSummaryError = undefined;
      meeting.updatedAt = meeting.aiSummary.generatedAt;
      meeting.version = (meeting.version ?? 1) + 1;
    }, 250);
    const unref = (timer as unknown as { unref?: () => void }).unref;
    if (unref) unref.call(timer);
  }

  async updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status !== 'upcoming') throw new WorkspaceApiError('CONFLICT', 'Only open upcoming meetings can be rescheduled.');
    const scheduledDate = normalizeMeetingDate(input.scheduledDate);
    if (!input.scheduledTime.trim()) throw new WorkspaceApiError('VALIDATION', 'Meeting time is required.');
    assertFutureMeetingSchedule(scheduledDate, input.scheduledTime.trim());
    if (this.workspace.meetings.some((candidate) => candidate.id !== meeting.id && candidate.teamId === teamId && candidate.status === 'upcoming' && candidate.scheduledDate === scheduledDate && candidate.scheduledTime === input.scheduledTime.trim())) throw new WorkspaceApiError('CONFLICT', 'Another upcoming meeting already uses that date and time.');
    Object.assign(meeting, { scheduledDate, scheduledTime: input.scheduledTime.trim(), dateLabel: meetingDateLabel(scheduledDate), weekStartDate: weekStartDateFor(scheduledDate), updatedAt: nowIso(), version: (meeting.version ?? 1) + 1 });
    this.audit('Updated meeting schedule', meeting.id, `Moved ${this.workspace.teams.find((team) => team.id === teamId)?.name ?? teamId} L10 to ${meeting.dateLabel} at ${meeting.scheduledTime}.`, 'meeting');
    return this.result();
  }

  async generateMeetings(teamId: string) {
    this.requireWrite(teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId && candidate.active);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Grouping-only teams cannot own L10 meetings.');
    validateMeetingConfiguration(team.meetingCadence, team.meetingDay, team.meetingTime);

    const now = Date.now();
    const futureMeetings = this.workspace.meetings
      .filter((meeting) => meeting.teamId === teamId && meeting.status === 'upcoming' && Number.isFinite(meetingScheduledAt(meeting)) && meetingScheduledAt(meeting) > now)
      .sort((left, right) => meetingScheduledAt(left) - meetingScheduledAt(right));
    const template = futureMeetings[0] ?? this.workspace.meetings
      .filter((meeting) => meeting.teamId === teamId)
      .sort((left, right) => meetingScheduledAt(left) - meetingScheduledAt(right))
      .at(-1);
    const deletedIds = new Set(futureMeetings.map((meeting) => meeting.id));
    this.workspace.meetings = this.workspace.meetings.filter((meeting) => !deletedIds.has(meeting.id));

    let cursor = nextConfiguredMeetingDateOnOrAfter(team, new Date(now));
    const created: Workspace['meetings'] = [];
    while (created.length < 4) {
      while (this.workspace.meetings.some((meeting) => meeting.teamId === teamId && (meeting.recurrenceDate ?? meeting.scheduledDate) === cursor)) {
        cursor = nextConfiguredMeetingDateAfter(team, cursor, cursor);
      }
      created.push(this.createUpcomingMeeting(team, cursor, template));
      this.workspace.meetings.push(created.at(-1)!);
      cursor = nextConfiguredMeetingDateAfter(team, cursor, cursor);
    }

    this.audit('Generated L10 meetings', teamId, `Replaced ${futureMeetings.length} future open occurrences with four ${team.meetingCadence} L10 meetings from the saved cadence.`, 'meeting');
    return this.result();
  }

  async skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note = '', expectedVersion?: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status !== 'upcoming') throw new WorkspaceApiError('CONFLICT', 'Only meetings that have not started can be skipped.');
    if (!['public-holiday', 'annual-leave', 'other'].includes(reason)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid skip reason.');
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    const timestamp = nowIso();
    Object.assign(meeting, { status: 'skipped' as const, skipReason: reason, skipNote: note.trim() || undefined, skippedAt: timestamp, skippedById: this.workspace.currentUser.id, updatedAt: timestamp, version: (meeting.version ?? 1) + 1 });
    this.ensureUpcomingMeetingWindow(team);
    this.audit('Skipped L10 meeting', meeting.id, `${team.name} meeting skipped: ${reason}${note.trim() ? ` · ${note.trim()}` : ''}.`, 'meeting');
    return this.result();
  }

  async requestMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number) {
    if (!this.canManageMeetingSummary(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You do not have permission to generate this meeting summary.');
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId);
    if (!meeting || !team) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status !== 'closed') throw new WorkspaceApiError('CONFLICT', 'AI summaries are available after a meeting is closed.');
    if (meeting.aiSummaryStatus === 'queued' || meeting.aiSummaryStatus === 'generating') return this.result();
    const timestamp = nowIso();
    const source = meeting.aiSummaryRequestedAt ? 'close' : 'legacy';
    const sourceWorkspace = cloneWorkspace(this.workspace);
    meeting.aiSummaryStatus = 'queued';
    meeting.aiSummaryRequestedAt = timestamp;
    meeting.aiSummarySource = source;
    meeting.aiSummaryJobId = meeting.aiSummaryJobId ?? `summary-${meeting.id}`;
    meeting.aiSummaryError = undefined;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Queued meeting AI summary', meeting.id, `${team.name} summary generation queued (${source}).`, 'meeting');
    this.queueLocalSummary(this.selectedEnvironment, teamId, meetingId, sourceWorkspace, source);
    return this.result();
  }

  async cancelMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number) {
    if (!this.canManageMeetingSummary(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You do not have permission to cancel this meeting summary.');
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId);
    if (!meeting || !team) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    this.requireVersion(meeting.version ?? 1, expectedVersion);
    if (meeting.status !== 'closed') throw new WorkspaceApiError('CONFLICT', 'AI summaries are available after a meeting is closed.');
    if (meeting.aiSummaryStatus === 'cancelled') return this.result();
    if (meeting.aiSummaryStatus !== 'queued' && meeting.aiSummaryStatus !== 'generating') throw new WorkspaceApiError('CONFLICT', 'Only a queued or generating AI summary can be cancelled.');
    const timestamp = nowIso();
    const cancellationMessage = 'AI recap generation was cancelled by the meeting editor.';
    meeting.aiSummaryStatus = 'cancelled';
    meeting.aiSummaryError = cancellationMessage;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    this.audit('Cancelled meeting AI summary', meeting.id, `${team.name} summary generation was cancelled.`, 'meeting');
    return this.result();
  }

  async createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) {
    this.requireAdmin();
    const timestamp = nowIso();
    const name = input.name.trim();
    const email = input.email.trim();
    if (!name || !email) throw new WorkspaceApiError('VALIDATION', 'Name and email are required.');
    if (this.workspace.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) throw new WorkspaceApiError('CONFLICT', 'A user with that email already exists.');
    const id = slugify(email.split('@')[0]);
    if (this.workspace.users.some((user) => user.id === id)) throw new WorkspaceApiError('CONFLICT', 'A local user with that email already exists.');
    this.workspace.users.push({ id, name, initials: name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(), email, accent: input.accent, active: true, platformCapabilities: input.platformAdmin ? ['PlatformAdmin'] : [], createdAt: timestamp, updatedAt: timestamp, version: 1 });
    this.audit('Created local user', id, email, 'profile');
    return this.result();
  }

  async updateUser(userId: string, input: Partial<Pick<User, 'name' | 'email'>> & { platformAdmin?: boolean }, expectedVersion?: number) {
    this.requireAdmin();
    const user = this.workspace.users.find((candidate) => candidate.id === userId && candidate.active);
    if (!user) throw new WorkspaceApiError('NOT_FOUND', 'User not found.');
    if (input.name === undefined && input.email === undefined && input.platformAdmin === undefined) throw new WorkspaceApiError('VALIDATION', 'At least one user field is required.');
    const version = user.version ?? 1;
    this.requireVersion(version, expectedVersion);
    if (input.name !== undefined && !input.name.trim()) throw new WorkspaceApiError('VALIDATION', 'Name is required.');
    if (input.email !== undefined && !input.email.trim()) throw new WorkspaceApiError('VALIDATION', 'Email is required.');
    if (input.email !== undefined && this.workspace.users.some((candidate) => candidate.id !== user.id && candidate.email.toLowerCase() === input.email!.trim().toLowerCase())) throw new WorkspaceApiError('CONFLICT', 'A user with that email already exists.');
    if (input.platformAdmin !== undefined && typeof input.platformAdmin !== 'boolean') throw new WorkspaceApiError('VALIDATION', 'platformAdmin must be a boolean.');
    const name = input.name?.trim() ?? user.name;
    const email = input.email?.trim() ?? user.email;
    Object.assign(user, {
      name,
      email,
      platformCapabilities: input.platformAdmin === undefined ? user.platformCapabilities : input.platformAdmin ? ['PlatformAdmin'] : [],
      initials: input.name !== undefined ? name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() : user.initials,
      updatedAt: nowIso(),
      version: version + 1,
    });
    if (this.workspace.currentUser.id === user.id) this.workspace.currentUser = user;
    this.audit('Updated user', user.id, `Updated the profile for ${user.name}.`, 'profile');
    return this.result();
  }

  async upsertMembership(input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>) {
    this.requireAdmin();
    if (!this.workspace.users.some((user) => user.id === input.userId) || !this.workspace.teams.some((team) => team.id === input.teamId)) throw new WorkspaceApiError('VALIDATION', 'User or team not found.');
    const existing = this.workspace.memberships.find((membership) => membership.userId === input.userId && membership.teamId === input.teamId);
    if (existing) {
      existing.role = input.role;
      existing.active = true;
      existing.updatedAt = nowIso();
    } else {
      const timestamp = nowIso();
      this.workspace.memberships.push({ ...input, id: `membership-${input.userId}-${input.teamId}`, active: true, createdAt: timestamp, updatedAt: timestamp });
    }
    this.audit('Updated membership', `${input.userId}:${input.teamId}`, input.role, 'membership');
    return this.result();
  }

  async updateAgeSettings(settings: IssueAgeSettings) {
    this.requireAdmin();
    if (!Number.isInteger(settings.agingDays) || !Number.isInteger(settings.staleDays) || !Number.isInteger(settings.criticalDays) || settings.agingDays <= 0 || settings.agingDays >= settings.staleDays || settings.staleDays >= settings.criticalDays) throw new WorkspaceApiError('VALIDATION', 'Age bands must be positive whole numbers in ascending order.');
    this.workspace.settings = { ...settings };
    this.audit('Updated Issue aging settings', 'organization', `${settings.agingDays}/${settings.staleDays}/${settings.criticalDays} days.`, 'team');
    return this.result();
  }

  async saveVto(teamId: string, input: VtoSaveInput, expectedVersion?: number) {
    if (!this.canManageMeeting(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'Only a TeamLead or OrgAdmin can edit the team V/TO.');
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId && candidate.active);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Grouping-only nodes cannot own a V/TO.');
    validateVtoInput(input);
    const normalized: VtoSaveInput = {
      ...input,
      coreValues: input.coreValues.map((value) => value.trim()),
      coreFocusPurpose: input.coreFocusPurpose.trim(),
      coreFocusNiche: input.coreFocusNiche.trim(),
      tenYearTarget: input.tenYearTarget.trim(),
      marketingStrategy: { targetMarket: input.marketingStrategy.targetMarket.trim(), uniques: input.marketingStrategy.uniques.map((value) => value.trim()), provenProcess: input.marketingStrategy.provenProcess.trim(), guarantee: input.marketingStrategy.guarantee.trim() },
      threeYearPicture: { targetDate: input.threeYearPicture.targetDate.trim(), revenue: input.threeYearPicture.revenue.trim(), profit: input.threeYearPicture.profit.trim(), headcount: input.threeYearPicture.headcount.trim(), description: input.threeYearPicture.description.trim() },
      oneYearPlan: { year: input.oneYearPlan.year, revenue: input.oneYearPlan.revenue.trim(), profit: input.oneYearPlan.profit.trim(), measurables: input.oneYearPlan.measurables.map((value) => value.trim()), goals: input.oneYearPlan.goals.map((value) => value.trim()) },
      quarterlyRockIds: [...input.quarterlyRockIds],
      issueIds: [...input.issueIds],
      effectiveDate: input.effectiveDate.trim(),
      changeSummary: input.changeSummary.trim(),
    };
    if (normalized.quarterlyRockIds.some((rockId) => !this.workspace.rocks.some((rock) => rock.id === rockId && rock.teamId === teamId))) throw new WorkspaceApiError('VALIDATION', 'Every V/TO Quarterly Rock must belong to this team.');
    if (normalized.issueIds.some((issueId) => !this.workspace.issues.some((issue) => issue.id === issueId && issue.teamId === teamId && issue.assignmentState !== 'redirected'))) throw new WorkspaceApiError('VALIDATION', 'Every V/TO Issue must belong to this team.');
    const current = this.workspace.vtos.find((candidate) => candidate.teamId === teamId);
    if (current) this.requireVersion(current.version, expectedVersion);
    else if (expectedVersion !== undefined) throw new WorkspaceApiError('CONFLICT', 'This team V/TO does not exist yet. Refresh and try again.');
    const timestamp = nowIso();
    const versionNumber = Math.max(current?.versionNumber ?? 0, ...this.workspace.vtoVersions.filter((version) => version.teamId === teamId).map((version) => version.versionNumber), 0) + 1;
    const vtoId = `vto-${teamId}`;
    const next: Vto = {
      ...(current ?? { id: vtoId, teamId, createdAt: timestamp }),
      ...normalized,
      id: vtoId,
      teamId,
      versionNumber,
      savedBy: this.workspace.currentUser.id,
      updatedAt: timestamp,
      version: (current?.version ?? 0) + 1,
    };
    const snapshot: VtoVersion = {
      ...next,
      id: `${vtoId}-version-${versionNumber}`,
      vtoId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: versionNumber,
    };
    this.workspace.vtos = current ? this.workspace.vtos.map((candidate) => candidate.teamId === teamId ? next : candidate) : [next, ...this.workspace.vtos];
    this.workspace.vtoVersions.unshift(snapshot);
    this.audit('Updated team V/TO', vtoId, `${team.name} V/TO version ${versionNumber} saved.`, 'vto');
    return this.result();
  }

  async createHistoricalMeeting(teamId: string, input: HistoricalMeetingInput) {
    this.requireWrite(teamId);
    const team = this.workspace.teams.find((candidate) => candidate.id === teamId && candidate.active);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (team.nodeType !== 'operational') throw new WorkspaceApiError('VALIDATION', 'Grouping-only nodes cannot own L10 meetings.');
    const scheduledDate = normalizeMeetingDate(input.scheduledDate);
    const scheduledTime = input.scheduledTime.trim();
    const scheduledAt = meetingScheduledAt({ scheduledDate, scheduledTime });
    if (!scheduledTime || !Number.isFinite(scheduledAt) || scheduledAt > Date.now()) throw new WorkspaceApiError('VALIDATION', 'Historical meetings must have a valid date and time in the past.');
    const quarterId = input.quarterId ?? quarterIdForDate(scheduledDate, this.workspace.quarters);
    if (!quarterId || !this.workspace.quarters.some((quarter) => quarter.id === quarterId)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid quarter.');
    if (input.quarterId && quarterIdForDate(scheduledDate, this.workspace.quarters) !== input.quarterId) throw new WorkspaceApiError('VALIDATION', 'The meeting date must fall within the selected quarter.');
    if (this.workspace.meetings.some((meeting) => meeting.teamId === teamId && meeting.scheduledDate === scheduledDate && meeting.scheduledTime === scheduledTime)) throw new WorkspaceApiError('CONFLICT', 'A meeting already exists for that team, date, and time.');
    const activeMemberIds = new Set(this.workspace.memberships.filter((membership) => membership.teamId === teamId && membership.active && this.workspace.users.some((user) => user.id === membership.userId && user.active)).map((membership) => membership.userId));
    if (!input.attendeeIds.length) throw new WorkspaceApiError('VALIDATION', 'Record at least one attendee.');
    if (!activeMemberIds.has(input.facilitatorId)) throw new WorkspaceApiError('VALIDATION', 'Facilitator must be an active member of the team.');
    if (new Set(input.attendeeIds).size !== input.attendeeIds.length || input.attendeeIds.some((userId) => !activeMemberIds.has(userId))) throw new WorkspaceApiError('VALIDATION', 'Every attendee must be a unique active member of the team.');
    const rating = input.rating ?? 0;
    if (rating !== 0 && !isValidMeetingRating(rating)) throw new WorkspaceApiError('VALIDATION', 'Meeting rating must be 0 or a half-point value from 0.5 to 10.');
    const timestamp = nowIso();
    const sections = meetingSectionsFor(team);
    const meeting: Workspace['meetings'][number] = {
      id: `meeting-${teamId}-${scheduledDate}-${Date.now()}`,
      teamId,
      quarterId,
      label: `${team.shortName} L10`,
      dateLabel: meetingDateLabel(scheduledDate),
      scheduledDate,
      scheduledTime,
      weekStartDate: weekStartDateFor(scheduledDate),
      status: 'closed',
      facilitatorId: input.facilitatorId,
      attendeeIds: [...input.attendeeIds],
      lastRating: rating,
      agendaProgress: sections.length,
      agendaTotal: sections.length,
      idsSolved: 0,
      idsTotal: 0,
      recap: sanitizeRichText(input.recap ?? ''),
      startedAt: new Date(scheduledAt - sections.reduce((total, section) => total + section.duration, 0) * 60_000).toISOString(),
      closedAt: new Date(scheduledAt).toISOString(),
      sectionNotes: input.idsNote?.trim() ? { ids: sanitizeRichText(input.idsNote) } : {},
      idsIssueIds: [],
      idsAddedIssueIds: [],
      createdTodoIds: [],
      idsNotes: [],
      aiSummaryStatus: 'not-generated',
      aiSummarySource: 'legacy',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.workspace.meetings.unshift(meeting);
    this.audit('Recorded historical L10 meeting', meeting.id, `${team.name} · ${meeting.dateLabel}.`, 'meeting');
    return this.result();
  }

  async closeMeeting(teamId: string, recap: string, rating: number, meetingId?: string, attendeeRatings?: MeetingAttendeeRating[]) {
    this.requireWrite(teamId);
    const canManage = this.canManageMeeting(teamId);
    const meeting = this.workspace.meetings.find((item) => item.teamId === teamId && (meetingId ? item.id === meetingId : true) && (item.status === 'upcoming' || item.status === 'in-progress'));
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    const activeTeam = this.workspace.teams.find((team) => team.id === teamId);
    if (!activeTeam) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    const timestamp = nowIso();
    const sections = meetingSectionsFor(activeTeam);
    const ratings = attendeeRatings ?? [];
    if (attendeeRatings !== undefined && (!Array.isArray(attendeeRatings) || attendeeRatings.some((entry) => !entry || typeof entry.attendeeId !== 'string' || !isValidMeetingRating(entry.rating)))) throw new WorkspaceApiError('VALIDATION', 'Each attendee rating must be a number from 0.5 to 10 in 0.5 increments.');
    if (attendeeRatings === undefined && (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 10)) throw new WorkspaceApiError('VALIDATION', 'Meeting rating must be between 0 and 10.');
    if (attendeeRatings !== undefined && ratings.length !== meeting.attendeeIds.length) throw new WorkspaceApiError('VALIDATION', 'Enter a rating for each recorded attendee before closing the meeting.');
    if (attendeeRatings !== undefined && !canManage && this.workspace.currentUser.id !== meeting.facilitatorId) throw new WorkspaceApiError('FORBIDDEN', 'Only the meeting facilitator or a TeamLead can submit attendee ratings.');
    const attendeeIds = new Set(meeting.attendeeIds);
    if (new Set(ratings.map((entry) => entry.attendeeId)).size !== ratings.length || ratings.some((entry) => !attendeeIds.has(entry.attendeeId))) throw new WorkspaceApiError('VALIDATION', 'Ratings must be supplied once for each recorded attendee.');
    finalizeMeetingTiming(meeting, timestamp);
    meeting.status = 'closed';
    meeting.closedAt = timestamp;
    meeting.updatedAt = timestamp;
    meeting.version = (meeting.version ?? 1) + 1;
    meeting.agendaProgress = sections.length;
    meeting.agendaTotal = sections.length;
    meeting.lastRating = averageMeetingRating(ratings) ?? Math.min(10, Math.max(0, rating));
    if (attendeeRatings !== undefined) meeting.attendeeRatings = ratings.map((entry) => ({ ...entry }));
    meeting.idsTotal = meeting.idsIssueIds.length;
    meeting.idsSolved = meeting.idsIssueIds.filter((issueId) => this.workspace.issues.find((issue) => issue.id === issueId)?.status === 'solved').length;
    meeting.actionSummary = meetingActionSummary(this.workspace, meeting);
    meeting.recap = meetingRecap(this.workspace, activeTeam, meeting, recap);
    meeting.aiSummaryStatus = 'queued';
    meeting.aiSummaryRequestedAt = timestamp;
    meeting.aiSummaryJobId = meeting.aiSummaryJobId ?? `summary-${meeting.id}`;
    meeting.aiSummarySource = 'close';
    meeting.aiSummaryError = undefined;
    advanceIssueEscalations(this.workspace, activeTeam, meeting, timestamp, this.notify.bind(this));
    const summaryWorkspace = cloneWorkspace(this.workspace);
    const carriedIssueIds = meeting.idsIssueIds.filter((issueId) => this.workspace.issues.find((issue) => issue.id === issueId)?.status !== 'solved');
    this.ensureUpcomingMeetingWindow(activeTeam, carriedIssueIds, meeting);
    this.audit('Closed L10 meeting', meeting.id, recap || 'Meeting closed without a recap.', 'meeting');
    this.queueLocalSummary(this.selectedEnvironment, teamId, meeting.id, summaryWorkspace, 'close');
    return this.result();
  }
}

type ApiSnapshot = {
  environmentId: EnvironmentId;
  user: User;
  teams: Array<Team & { teamId?: string }>;
  users: User[];
  memberships: TeamMembership[];
  settings: IssueAgeSettings;
  rocks: Array<Rock & { teamId: string }>;
  tasks: RockTask[];
  todos: Todo[];
  issues: Issue[];
  transfers: IssueTransfer[];
  notifications: Notification[];
  messages: TeamMessage[];
  meetings: Workspace['meetings'];
  metrics: ScorecardMetric[];
  scorecardResults: ScorecardResult[];
  headlines: Workspace['headlines'];
  audit: ApiAuditEvent[];
  quarter: QuarterDto;
  quarters?: QuarterDto[];
  vtos?: Vto[];
  vtoVersions?: VtoVersion[];
  etag: string;
};

type QuarterDto = Workspace['quarter'];

type ApiAuditEvent = { id: string; actorId: string; action: string; target: string; detail: string; createdAt: string; eventType?: string; type?: string };

const auditEventTypes = new Set<AuditEvent['type']>(['team', 'membership', 'rock', 'todo', 'issue', 'transfer', 'profile', 'meeting', 'vto']);

function auditEventType(value: string | undefined): AuditEvent['type'] {
  if (!value || value === 'admin' || !auditEventTypes.has(value as AuditEvent['type'])) return 'team';
  return value as AuditEvent['type'];
}

function mapAuditEvent(event: ApiAuditEvent): AuditEvent {
  return { id: String(event.id), actorId: String(event.actorId), action: String(event.action), target: String(event.target), detail: String(event.detail), createdAt: String(event.createdAt), type: auditEventType(event.type ?? event.eventType) };
}

function codeForResponse(value: unknown): WorkspaceApiError['code'] {
  return value === 'NOT_FOUND' || value === 'FORBIDDEN' || value === 'CONFLICT' || value === 'VALIDATION' || value === 'UNAVAILABLE' ? value : 'UNAVAILABLE';
}

function serverTeam(team: Team & { teamId?: string }): Team {
  return { ...team, id: team.id || team.teamId || '', memberCount: team.memberCount ?? 0, meetingCadence: team.meetingCadence ?? 'weekly' };
}

function serverMembership(membership: TeamMembership): TeamMembership {
  return membership;
}

function mapSnapshot(snapshot: ApiSnapshot): Workspace {
  const teams = snapshot.teams.map(serverTeam);
  const quarters = snapshot.quarters?.length ? snapshot.quarters : [snapshot.quarter];
  const selectedQuarter = quarters.find((quarter) => quarter.id === snapshot.quarter.id) ?? snapshot.quarter;
  const tasksByRock = new Map<string, RockTask[]>();
  for (const task of snapshot.tasks) tasksByRock.set(task.rockId, [...(tasksByRock.get(task.rockId) ?? []), task]);
  const normalizedMeetings = snapshot.meetings.map((meeting) => {
    const normalized = normalizeMeeting(meeting, teams.find((team) => team.id === meeting.teamId));
    return { ...normalized, quarterId: quarterIdForRecord(normalized, quarters) };
  });
  return {
    environment: snapshot.environmentId,
    currentUser: snapshot.user,
    quarter: selectedQuarter,
    quarters,
    settings: snapshot.settings,
    teams,
    users: snapshot.users,
    memberships: snapshot.memberships.map(serverMembership),
    rocks: snapshot.rocks.map((rock) => ({ ...stripLegacyRockProgress(rock), id: rock.id, notes: sanitizeRichText(rock.notes), tasks: tasksByRock.get(rock.id) ?? [] })),
    todos: snapshot.todos.map((todo) => ({ ...todo, quarterId: quarterIdForRecord(todo, quarters), notes: sanitizeTodoNotes(todo.notes), checklist: normalizedChecklist(todo, snapshot.users, snapshot.memberships) })),
    issues: snapshot.issues.map((issue) => ({ ...issue, quarterId: quarterIdForRecord(issue, quarters), detail: sanitizeRichText(issue.detail), idsNote: issue.idsNote ? sanitizeRichText(issue.idsNote) : undefined, meetingsPassed: issue.meetingsPassed ?? 0, meetingBand: issueMeetingBand(issue.meetingsPassed ?? 0, issue.status), escalationState: issue.escalationState ?? 'not-scheduled', escalationLevel: issue.escalationLevel ?? 0 })),
    messages: snapshot.messages,
    transfers: snapshot.transfers,
    notifications: snapshot.notifications,
    metrics: snapshot.metrics,
    scorecardResults: snapshot.scorecardResults ?? [],
    headlines: (snapshot.headlines ?? []).map((headline) => ({ ...headline, quarterId: quarterIdForRecord(headline, quarters), title: typeof headline.title === 'string' ? headline.title.trim() : '', detail: typeof headline.detail === 'string' ? headline.detail.trim() : '' })),
    meetings: normalizedMeetings,
    vtos: snapshot.vtos ?? [],
    vtoVersions: snapshot.vtoVersions ?? [],
    activity: snapshot.audit.map(mapAuditEvent),
  };
}

type MutationObject = Record<string, unknown>;

function isMutationObject(value: unknown): value is MutationObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function replaceRecord<T extends { id: string }>(records: T[], next: T) {
  const index = records.findIndex((record) => record.id === next.id);
  if (index < 0) records.unshift(next);
  else records[index] = next;
}

function mergeMutationRecord(workspace: Workspace, value: MutationObject): boolean {
  const kind = value.kind;
  if (typeof kind !== 'string') return false;
  switch (kind) {
    case 'rock': {
      const next = value as unknown as Rock & { teamId?: string };
      const existing = workspace.rocks.find((rock) => rock.id === next.id);
      replaceRecord(workspace.rocks, { ...stripLegacyRockProgress(next), id: next.id, teamId: next.teamId ?? existing?.teamId ?? '', tasks: next.tasks ?? existing?.tasks ?? [] });
      return true;
    }
    case 'rockTask': {
      const next = value as unknown as RockTask;
      const rock = workspace.rocks.find((candidate) => candidate.id === next.rockId);
      if (!rock) return false;
      replaceRecord(rock.tasks, next);
      return true;
    }
    case 'todo': {
      const next = value as unknown as Todo;
      replaceRecord(workspace.todos, { ...next, notes: sanitizeTodoNotes(next.notes), checklist: normalizedChecklist(next, workspace.users, workspace.memberships) });
      return true;
    }
    case 'issue': {
      const next = value as unknown as Issue;
      replaceRecord(workspace.issues, ageFor({ ...next, detail: sanitizeRichText(next.detail), idsNote: next.idsNote ? sanitizeRichText(next.idsNote) : undefined }, workspace.settings));
      return true;
    }
    case 'headline':
      replaceRecord(workspace.headlines, value as unknown as Headline);
      return true;
    case 'scorecardMetric':
      replaceRecord(workspace.metrics, value as unknown as ScorecardMetric);
      return true;
    case 'scorecardResult':
      replaceRecord(workspace.scorecardResults, value as unknown as ScorecardResult);
      return true;
    case 'meeting': {
      const next = value as unknown as Workspace['meetings'][number];
      const team = workspace.teams.find((candidate) => candidate.id === next.teamId);
      replaceRecord(workspace.meetings, normalizeMeeting(next, team));
      return true;
    }
    case 'vto':
      replaceRecord(workspace.vtos, value as unknown as Vto);
      return true;
    case 'vtoVersion':
      replaceRecord(workspace.vtoVersions, value as unknown as VtoVersion);
      return true;
    case 'user': {
      const next = value as unknown as User;
      replaceRecord(workspace.users, next);
      if (workspace.currentUser.id === next.id) workspace.currentUser = next;
      return true;
    }
    case 'team': {
      const next = serverTeam(value as unknown as Team & { teamId?: string });
      replaceRecord(workspace.teams, next);
      return true;
    }
    case 'teamMembership':
      replaceRecord(workspace.memberships, value as unknown as TeamMembership);
      workspace.teams = workspace.teams.map((team) => ({ ...team, memberCount: workspace.memberships.filter((membership) => membership.teamId === team.id && membership.active).length }));
      return true;
    case 'transfer':
    case 'issueTransfer':
      replaceRecord(workspace.transfers, value as unknown as IssueTransfer);
      return true;
    case 'message':
      replaceRecord(workspace.messages, value as unknown as TeamMessage);
      return true;
    case 'notification':
      replaceRecord(workspace.notifications, value as unknown as Notification);
      return true;
    case 'issueAgeSettings':
      workspace.settings = { agingDays: Number(value.agingDays), staleDays: Number(value.staleDays), criticalDays: Number(value.criticalDays), version: typeof value.version === 'number' ? value.version : workspace.settings.version };
      workspace.issues = workspace.issues.map((issue) => ageFor(issue, workspace.settings));
      return true;
    case 'auditEvent':
      workspace.activity.unshift(mapAuditEvent(value as unknown as ApiAuditEvent));
      return true;
    default:
      return false;
  }
}

/**
 * Mutation endpoints return the changed record (or a small object of changed
 * records) with its record kind. Treating that payload as a typed delta keeps
 * normal writes local while still allowing callers to fall back to a snapshot
 * when a side effect is broader than the returned records.
 */
function mergeMutationDelta(workspace: Workspace, payload: unknown): boolean {
  if (!isMutationObject(payload)) return false;
  if (typeof payload.kind === 'string') return mergeMutationRecord(workspace, payload);
  let merged = false;
  for (const value of Object.values(payload)) {
    if (isMutationObject(value)) merged = mergeMutationDelta(workspace, value) || merged;
  }
  return merged;
}

/** HTTP adapter used when VITE_LOCAL_POC_MODE=false. Cookies are sent by the
 * browser, while the API remains the authority for environment access. */
export class HttpWorkspaceApi implements WorkspaceApi {
  private cachedWorkspace: Workspace | null = null;

  private async request<T>(path: string, method = 'GET', body?: unknown, expectedVersion?: number): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (expectedVersion !== undefined) headers['If-Match'] = `W/"${expectedVersion}"`;
    let response: Response;
    try {
      response = await fetch(`/api/${path.replace(/^\//, '')}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new WorkspaceApiError('UNAVAILABLE', 'The API could not be reached.');
    }
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
    if (!response.ok) throw new WorkspaceApiError(codeForResponse(payload.code), payload.error ?? 'The API could not complete the request.');
    return payload;
  }

  async getEnvironmentSession(): Promise<EnvironmentSession> {
    const session = await this.request<EnvironmentSession & { currentEnvironment: EnvironmentId }>('/me');
    return { currentEnvironment: session.currentEnvironment, availableEnvironments: session.availableEnvironments, canSwitchToTest: session.canSwitchToTest };
  }

  async selectEnvironment(environment: EnvironmentId): Promise<EnvironmentSession> {
    const session = await this.request<EnvironmentSession & { currentEnvironment: EnvironmentId }>('/me/environment', 'PUT', { environment });
    this.cachedWorkspace = null;
    return { currentEnvironment: session.currentEnvironment, availableEnvironments: session.availableEnvironments, canSwitchToTest: session.canSwitchToTest };
  }

  async getEnvironmentAccess(): Promise<EnvironmentAccess[]> {
    const response = await this.request<{ access: EnvironmentAccess[] }>('/platform-admin/environment-access');
    return response.access;
  }

  async updateEnvironmentAccess(userId: string, testAllowed: boolean): Promise<EnvironmentAccess[]> {
    await this.request(`/platform-admin/environment-access/${encodeURIComponent(userId)}`, 'PATCH', { testAllowed });
    return this.getEnvironmentAccess();
  }

  async getWorkspace(quarterId?: string): Promise<Workspace> {
    const selectedQuarterId = quarterId ?? (this.cachedWorkspace?.quarter.status !== 'current' ? this.cachedWorkspace?.quarter.id : undefined);
    const path = selectedQuarterId ? `/workspace?quarterId=${encodeURIComponent(selectedQuarterId)}` : '/workspace';
    const workspace = mapSnapshot(await this.request<ApiSnapshot>(path));
    this.cachedWorkspace = workspace;
    return cloneWorkspace(workspace);
  }

  async getAuditTrail(entityType: AuditEntityType, entityId: string) {
    const events = await this.request<ApiAuditEvent[]>(`/audit/${entityType}/${encodeURIComponent(entityId)}`);
    return events.map(mapAuditEvent);
  }

  async getCompanyOverview(): Promise<CompanyOverview> {
    const overview = await this.request<{ teams: CompanyOverview['teams']; issues: Issue[]; rocks: Rock[]; todos: Todo[] }>('/company/overview');
    return { teams: overview.teams, issues: overview.issues, rocks: overview.rocks.map((rock) => ({ ...stripLegacyRockProgress(rock), tasks: rock.tasks ?? [] })), todos: overview.todos };
  }

  private async mutate<T = unknown>(path: string, method: string, body?: unknown, expectedVersion?: number, options: { refresh?: boolean } = {}) {
    let payload: T;
    try {
      payload = await this.request<T>(path, method, body, expectedVersion);
    } catch (error) {
      // A conflict means the local snapshot is stale. A network failure after
      // a write is also ambiguous, so refresh the cache before surfacing the
      // original error. The refresh is best effort and must not hide it.
      if (this.cachedWorkspace && error instanceof WorkspaceApiError && (error.code === 'CONFLICT' || error.code === 'UNAVAILABLE')) {
        try {
          await this.getWorkspace();
        } catch {
          // Preserve the mutation error when the recovery read is unavailable.
        }
      }
      throw error;
    }
    if (!options.refresh && this.cachedWorkspace && mergeMutationDelta(this.cachedWorkspace, payload)) return cloneWorkspace(this.cachedWorkspace);
    return this.getWorkspace();
  }

  async updateRockStatus(rockId: string, status: RockStatus, expectedVersion?: number) { return this.mutate(`/rocks/${rockId}/status`, 'PATCH', { status }, expectedVersion); }
  async updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>, expectedVersion?: number) { return this.mutate(`/rocks/${rockId}`, 'PATCH', input, expectedVersion); }
  async addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string; quarterId?: string }) { return this.mutate(`/teams/${input.teamId}/rocks`, 'POST', input); }
  async addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>) { return this.mutate(`/rocks/${rockId}/tasks`, 'POST', input); }
  async updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number) {
    const task = this.cachedWorkspace?.rocks.flatMap((rock) => rock.tasks).find((candidate) => candidate.id === taskId);
    return this.mutate(`/rock-tasks/${taskId}`, 'PATCH', input, expectedVersion, { refresh: Boolean(task?.linkedTodoId) });
  }
  async deleteRockTask(taskId: string, expectedVersion?: number) { return this.mutate(`/rock-tasks/${taskId}`, 'DELETE', undefined, expectedVersion, { refresh: true }); }
  async convertRockTaskToTodo(taskId: string) { return this.mutate(`/rock-tasks/${taskId}/todo`, 'POST'); }
  async updateTodoStatus(todoId: string, status: TodoStatus, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/status`, 'PATCH', { status }, expectedVersion); }
  async updateTodo(todoId: string, input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, expectedVersion?: number) {
    const todo = this.cachedWorkspace?.todos.find((candidate) => candidate.id === todoId);
    const dueDateChanged = input.dueDate !== undefined && input.dueDate !== todo?.dueDate;
    return this.mutate(`/todos/${todoId}`, 'PATCH', input, expectedVersion, { refresh: Boolean(todo?.linkedRockTaskId) || dueDateChanged });
  }
  async addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string; sourceIssueId?: string; quarterId?: string }) { return this.mutate(`/teams/${input.teamId}/todos`, 'POST', input); }
  async addTodoChecklistItem(todoId: string, text: string, supporterId?: string, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/checklist`, 'POST', { text, ...(supporterId ? { supporterId } : {}) }, expectedVersion); }
  async updateTodoChecklistItem(todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/checklist/${itemId}`, 'PATCH', input, expectedVersion); }
  async deleteTodoChecklistItem(todoId: string, itemId: string, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/checklist/${itemId}`, 'DELETE', undefined, expectedVersion); }
  async createScorecardMetric(input: Pick<ScorecardMetric, 'teamId' | 'label' | 'target' | 'unit' | 'ownerId'>) { return this.mutate(`/teams/${input.teamId}/scorecard/metrics`, 'POST', input); }
  async updateScorecardMetric(metricId: string, input: Partial<Pick<ScorecardMetric, 'label' | 'target' | 'unit' | 'ownerId'>>, expectedVersion?: number) { return this.mutate(`/scorecard/metrics/${metricId}`, 'PATCH', input, expectedVersion); }
  async upsertScorecardResult(metricId: string, weekStartDate: string, input: Pick<ScorecardResult, 'actual' | 'status'>, expectedVersion?: number) { return this.mutate(`/scorecard/metrics/${metricId}/weeks/${weekStartDate}`, 'PUT', input, expectedVersion); }
  async createIssueFromScorecard(metricId: string, weekStartDate: string, expectedVersion?: number) { return this.mutate(`/scorecard/metrics/${metricId}/weeks/${weekStartDate}/issue`, 'POST', undefined, expectedVersion); }
  async createIssueFromRock(rockId: string, expectedVersion?: number) { return this.mutate(`/rocks/${rockId}/issue`, 'POST', undefined, expectedVersion); }
  async startIssue(issueId: string, expectedVersion?: number) { return this.mutate(`/issues/${issueId}/ids`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async parkIssue(issueId: string, expectedVersion?: number) { return this.mutate(`/issues/${issueId}/park`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async solveIssue(issueId: string, input: SolveIssueInput, expectedVersion?: number) { return this.mutate(`/issues/${issueId}/solve`, 'POST', input, expectedVersion, { refresh: true }); }
  async reopenIssue(issueId: string, expectedVersion?: number) { return this.mutate(`/issues/${issueId}/reopen`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async createHeadline(input: Pick<Headline, 'teamId' | 'type' | 'title' | 'detail'> & { meetingId?: string; issueId?: string }) { return this.mutate(`/teams/${input.teamId}/headlines`, 'POST', input, undefined, { refresh: true }); }
  async addIssue(input: Pick<Issue, 'title' | 'detail' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; quarterId?: string; linkedRockId?: string; linkedScorecardMetricId?: string; linkedScorecardWeekStartDate?: string; idsNote?: string }) { return this.mutate(`/teams/${input.teamId}/issues`, 'POST', input); }
  async updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number) { return this.mutate(`/issues/${issueId}`, 'PATCH', input, expectedVersion); }
  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number) {
    const workspace = this.cachedWorkspace ?? await this.getWorkspace();
    const issue = workspace.issues.find((candidate) => candidate.id === issueId);
    if (!issue) throw new WorkspaceApiError('NOT_FOUND', 'Issue not found.');
    return this.mutate(`/teams/${issue.teamId}/meetings/${meetingId}/issues/${issueId}/notes`, 'POST', { note }, expectedVersion);
  }
  async updateMeetingSectionNote(teamId: string, meetingId: string, section: MeetingSection, note: string, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/notes`, 'PATCH', { section, note }, expectedVersion); }
  async setMeetingIssueSelection(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/ids/selection`, 'PATCH', { issueIds }, expectedVersion, { refresh: true }); }
  async reorderMeetingIssues(teamId: string, meetingId: string, issueIds: string[], expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/ids/order`, 'PATCH', { issueIds }, expectedVersion); }
  async transitionMeetingSection(teamId: string, meetingId: string, fromSection: MeetingSection, toSection: MeetingSection, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/section`, 'PATCH', { fromSection, toSection }, expectedVersion); }
  async getMeetingReview(query: MeetingReviewQuery = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    return this.request<MeetingReviewPage>(`/meetings/review${params.toString() ? `?${params.toString()}` : ''}`);
  }
  async getMeeting(teamId: string, meetingId: string) { return this.request<Workspace['meetings'][number]>(`/teams/${teamId}/meetings/${meetingId}`); }
  async startMeeting(teamId: string, meetingId: string, expectedVersion?: number, facilitatorId?: string) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/start`, 'POST', facilitatorId ? { facilitatorId } : undefined, expectedVersion, { refresh: true }); }
  async updateMeetingSchedule(teamId: string, meetingId: string, input: { scheduledDate: string; scheduledTime: string }, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}`, 'PATCH', input, expectedVersion); }
  async generateMeetings(teamId: string) { return this.mutate(`/teams/${teamId}/meetings/generate`, 'POST', undefined, undefined, { refresh: true }); }
  async skipMeeting(teamId: string, meetingId: string, reason: MeetingSkipReason, note = '', expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/skip`, 'POST', { reason, note }, expectedVersion, { refresh: true }); }
  async requestMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/ai-summary/retry`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async cancelMeetingSummary(teamId: string, meetingId: string, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/meetings/${meetingId}/ai-summary/cancel`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async saveVto(teamId: string, input: VtoSaveInput, expectedVersion?: number) { return this.mutate(`/teams/${teamId}/vto`, 'PUT', input, expectedVersion, { refresh: true }); }
  async createHistoricalMeeting(teamId: string, input: HistoricalMeetingInput) { return this.mutate(`/teams/${teamId}/meetings/history`, 'POST', input, undefined, { refresh: true }); }
  async requestIssueTransfer(issueId: string, destinationTeamId: string, note?: string) { return this.mutate(`/issues/${issueId}/transfers`, 'POST', { destinationTeamId, note }, undefined, { refresh: true }); }
  async acceptIssueTransfer(transferId: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/accept`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async rejectIssueTransfer(transferId: string, message: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/reject`, 'POST', { message }, expectedVersion, { refresh: true }); }
  async cancelIssueTransfer(transferId: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/cancel`, 'POST', undefined, expectedVersion, { refresh: true }); }
  async sendTeamMessage(input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>) { return this.mutate(`/teams/${input.fromTeamId}/messages`, 'POST', input, undefined, { refresh: true }); }
  async markMessageRead(messageId: string, expectedVersion?: number) { return this.mutate(`/messages/${messageId}/read`, 'POST', undefined, expectedVersion); }
  async createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId'>) { return this.mutate(`/messages/${messageId}/issue`, 'POST', input, undefined, { refresh: true }); }
  async markNotificationRead(notificationId: string) { return this.mutate(`/notifications/${notificationId}/read`, 'PATCH'); }
  async updateProfile(input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>) { return this.mutate('/profile', 'PATCH', input); }
  async createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) { return this.mutate('/platform-admin/teams', 'POST', input, undefined, { refresh: true }); }
  async updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>, expectedVersion?: number) { return this.mutate(`/platform-admin/teams/${teamId}`, 'PATCH', input, expectedVersion, { refresh: true }); }
  async createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) { return this.mutate('/platform-admin/users', 'POST', input); }
  async updateUser(userId: string, input: Partial<Pick<User, 'name' | 'email'>> & { platformAdmin?: boolean }, expectedVersion?: number) { return this.mutate(`/platform-admin/users/${encodeURIComponent(userId)}`, 'PATCH', input, expectedVersion); }
  async upsertMembership(input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>) { return this.mutate('/platform-admin/memberships', 'PUT', input); }
  async updateAgeSettings(settings: IssueAgeSettings) { return this.mutate('/platform-admin/settings/aging', 'PUT', settings); }
  async closeMeeting(teamId: string, recap: string, rating: number, meetingId?: string, attendeeRatings?: MeetingAttendeeRating[]) {
    const workspace = this.cachedWorkspace ?? await this.getWorkspace();
    const meeting = workspace.meetings.find((candidate) => candidate.teamId === teamId && (meetingId ? candidate.id === meetingId : true) && (candidate.status === 'upcoming' || candidate.status === 'in-progress'));
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    return this.mutate(`/teams/${teamId}/meetings/${meeting.id}/close`, 'POST', { recap, rating, ...(attendeeRatings !== undefined ? { attendeeRatings } : {}) }, meeting.version, { refresh: true });
  }
}

export const workspaceApi: WorkspaceApi = import.meta.env.VITE_LOCAL_POC_MODE === 'false' ? new HttpWorkspaceApi() : new LocalWorkspaceApi();
