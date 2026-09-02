import { defaultAgeBand, initialWorkspace, testWorkspace } from './data';
import { meetingSectionsFor } from './types';
import type {
  CompanyOverview,
  EnvironmentAccess,
  EnvironmentId,
  EnvironmentSession,
  Issue,
  IssueAgeBand,
  IssueAgeSettings,
  IssueHorizon,
  IssueTransfer,
  IssueTransferStatus,
  IssueStatus,
  Notification,
  TeamMessage,
  MeetingSection,
  MeetingSectionConfig,
  Rock,
  RockStatus,
  RockTask,
  RockTaskStatus,
  ScorecardMetric,
  Team,
  TeamMembership,
  TeamNodeType,
  TeamRole,
  Todo,
  TodoStatus,
  User,
  Workspace,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

export class WorkspaceApiError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'VALIDATION' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

export interface WorkspaceApi {
  getEnvironmentSession(): Promise<EnvironmentSession>;
  selectEnvironment(environment: EnvironmentId): Promise<EnvironmentSession>;
  getEnvironmentAccess(): Promise<EnvironmentAccess[]>;
  updateEnvironmentAccess(userId: string, testAllowed: boolean): Promise<EnvironmentAccess[]>;
  getWorkspace(): Promise<Workspace>;
  getCompanyOverview(): Promise<CompanyOverview>;
  updateRockStatus(rockId: string, status: RockStatus, expectedVersion?: number): Promise<Workspace>;
  updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, expectedVersion?: number): Promise<Workspace>;
  addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string }): Promise<Workspace>;
  addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>): Promise<Workspace>;
  updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number): Promise<Workspace>;
  convertRockTaskToTodo(taskId: string): Promise<Workspace>;
  updateTodoStatus(todoId: string, status: TodoStatus, expectedVersion?: number): Promise<Workspace>;
  updateTodo(todoId: string, input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, expectedVersion?: number): Promise<Workspace>;
  moveTodoForward(todoId: string, dueDate: string, expectedVersion?: number): Promise<Workspace>;
  addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string }): Promise<Workspace>;
  startIssue(issueId: string): Promise<Workspace>;
  solveIssue(issueId: string): Promise<Workspace>;
  addIssue(input: Pick<Issue, 'title' | 'detail' | 'category' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; linkedRockId?: string; idsNote?: string }): Promise<Workspace>;
  updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number): Promise<Workspace>;
  addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number): Promise<Workspace>;
  requestIssueTransfer(issueId: string, destinationTeamId: string, note?: string, expectedVersion?: number): Promise<Workspace>;
  acceptIssueTransfer(transferId: string, expectedVersion?: number): Promise<Workspace>;
  rejectIssueTransfer(transferId: string, message: string, expectedVersion?: number): Promise<Workspace>;
  cancelIssueTransfer(transferId: string, expectedVersion?: number): Promise<Workspace>;
  sendTeamMessage(input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>): Promise<Workspace>;
  markMessageRead(messageId: string): Promise<Workspace>;
  createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId'>): Promise<Workspace>;
  markNotificationRead(notificationId: string): Promise<Workspace>;
  updateProfile(input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>): Promise<Workspace>;
  createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }): Promise<Workspace>;
  updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>): Promise<Workspace>;
  createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }): Promise<Workspace>;
  upsertMembership(input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>): Promise<Workspace>;
  updateAgeSettings(settings: IssueAgeSettings): Promise<Workspace>;
  closeMeeting(teamId: string, recap: string, rating: number): Promise<Workspace>;
}

const cloneWorkspace = (workspace: Workspace): Workspace => structuredClone(workspace);
const nowIso = () => new Date().toISOString();
const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `team-${Date.now()}`;

export function ageBandFor(ageInDays: number, settings: IssueAgeSettings): IssueAgeBand {
  if (ageInDays >= settings.criticalDays) return 'critical';
  if (ageInDays >= settings.staleDays) return 'stale';
  if (ageInDays >= settings.agingDays) return 'aging';
  return 'fresh';
}

function ageFor(issue: Issue, settings: IssueAgeSettings, at = Date.now()): Issue {
  const end = issue.solvedAt ? new Date(issue.solvedAt).getTime() : at;
  const ageInDays = Math.max(0, Math.floor((end - new Date(issue.createdAt).getTime()) / DAY));
  return { ...issue, ageInDays, ageBand: ageBandFor(ageInDays, settings) };
}

function activeIssues(issues: Issue[]) {
  return issues.filter((issue) => issue.assignmentState !== 'redirected');
}

function activeTransfer(transfers: IssueTransfer[], transferId: string) {
  const transfer = transfers.find((item) => item.id === transferId);
  if (!transfer) throw new WorkspaceApiError('NOT_FOUND', 'Transfer not found.');
  return transfer;
}

function avatarIsValid(value: string) {
  return /^(data:image\/(png|jpeg|jpg|webp);base64,)[a-z0-9+/=]+$/i.test(value) && value.length <= 360_000;
}

function appendMeetingNote(current: string | undefined, label: string, note: string) {
  const entry = `[${label}] ${note.trim()}`;
  return current?.trim() ? `${current.trim()}\n\n${entry}` : entry;
}

function meetingRecap(workspace: Workspace, team: Team, meeting: Workspace['meetings'][number], manualNotes: string) {
  const sections = meetingSectionsFor(team);
  const rocks = workspace.rocks.filter((rock) => rock.teamId === team.id);
  const todos = workspace.todos.filter((todo) => todo.teamId === team.id);
  const issues = workspace.issues.filter((issue) => issue.teamId === team.id && issue.assignmentState !== 'redirected');
  const ids = meeting.idsIssueIds.map((id) => issues.find((issue) => issue.id === id)).filter((issue): issue is Issue => Boolean(issue));
  const lines = [`${team.name} L10 recap · ${meeting.dateLabel}`, ''];
  for (const section of sections) {
    const note = meeting.sectionNotes[section.id]?.trim();
    if (note) lines.push(`${section.label}: ${note}`);
  }
  if (sections.some((section) => section.id === 'scorecard')) {
    const offTrack = workspace.metrics.filter((metric) => metric.teamId === team.id && metric.status === 'off-track').map((metric) => metric.label);
    lines.push(`Scorecard: ${offTrack.length ? `off-track — ${offTrack.join(', ')}` : 'all visible measurables on track.'}`);
  }
  lines.push(`Rock Review: ${rocks.length ? rocks.map((rock) => `${rock.title} (${rock.progress}% · ${rock.status})`).join('; ') : 'no Rocks recorded.'}`);
  lines.push(`Headlines: ${workspace.headlines.filter((headline) => headline.teamId === team.id).map((headline) => headline.title).join('; ') || 'none recorded.'}`);
  lines.push(`To-Do Review: ${todos.length ? todos.map((todo) => `${todo.title} — ${todo.status === 'done' ? 'done' : 'open'} · ${workspace.users.find((user) => user.id === todo.ownerId)?.name ?? 'unassigned'} · due ${todo.dueDate}`).join('; ') : 'no To-Dos recorded.'}`);
  lines.push(`IDS: ${ids.length ? ids.map((issue) => `${issue.title} — ${issue.status === 'solved' ? 'solved' : 'carried forward'}${issue.idsNote ? ` · ${issue.idsNote.split('\n').at(-1)}` : ''}`).join('; ') : 'no Issues entered into IDS.'}`);
  if (meeting.createdTodoIds.length) lines.push(`Created To-Dos: ${meeting.createdTodoIds.map((id) => todos.find((todo) => todo.id === id)?.title ?? id).join('; ')}`);
  if (manualNotes.trim()) lines.push(`Facilitator notes: ${manualNotes.trim()}`);
  return lines.join('\n');
}

function teamForMessage(workspace: Workspace, teamId: string) {
  return workspace.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

function advanceIssueEscalations(workspace: Workspace, team: Team, meeting: Workspace['meetings'][number], at: string, notify: (userId: string, input: Omit<Notification, 'id' | 'recipientUserId' | 'createdAt'>) => void) {
  const now = new Date(at).getTime();
  for (const issue of workspace.issues.filter((candidate) => candidate.teamId === team.id && candidate.assignmentState !== 'redirected' && candidate.status !== 'solved')) {
    if (!meeting.idsIssueIds.includes(issue.id)) continue;
    issue.meetingsPassed += 1;
    issue.updatedAt = at;
    issue.version += 1;
    if (issue.meetingsPassed >= 3 && issue.escalationState === 'not-scheduled') {
      issue.escalationState = 'scheduled';
      issue.escalationDueAt = new Date(now + 7 * DAY).toISOString();
      const firstRecipient = team.escalationUserIds[0];
      if (firstRecipient) notify(firstRecipient, { type: 'issue-escalation', title: 'Issue escalation scheduled', message: `${issue.title} has passed three L10 meetings and will escalate in seven days if it remains unsolved.`, issueId: issue.id, teamId: team.id });
    }
    if ((issue.escalationState === 'scheduled' || issue.escalationState === 'escalated') && issue.escalationDueAt && new Date(issue.escalationDueAt).getTime() <= now) {
      const recipientId = team.escalationUserIds[issue.escalationLevel];
      if (recipientId) {
        issue.escalationState = 'escalated';
        issue.escalatedToUserId = recipientId;
        issue.escalationLevel += 1;
        const nextRecipient = team.escalationUserIds[issue.escalationLevel];
        issue.escalationDueAt = nextRecipient ? new Date(now + 7 * DAY).toISOString() : undefined;
        notify(recipientId, { type: 'issue-escalation', title: 'Issue escalated', message: `${issue.title} has reached its seven-day escalation point for ${team.name}.`, issueId: issue.id, teamId: team.id });
      } else {
        issue.escalationState = 'due';
        issue.escalationDueAt = undefined;
      }
    }
  }
}

export class LocalWorkspaceApi implements WorkspaceApi {
  private readonly workspaces: Record<EnvironmentId, Workspace>;
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
      live: cloneWorkspace({ ...liveSeed, environment: 'live' }),
      test: cloneWorkspace({ ...testSeed, environment: 'test' }),
    };
    this.testAccessUserIds = new Set(options.testAccessUserIds ?? [liveSeed.currentUser.id]);
    this.refreshDerivedState();
    this.refreshWorkspace('test');
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
    this.workspace.teams = this.workspace.teams.map((team) => ({
      ...team,
      meetingSections: team.meetingSections?.length ? team.meetingSections : meetingSectionsFor({ meetingSections: [] }),
      escalationUserIds: team.escalationUserIds ?? [],
    }));
    this.workspace.issues = this.workspace.issues.map((issue) => ageFor({
      ...issue,
      meetingsPassed: issue.meetingsPassed ?? 0,
      escalationState: issue.escalationState ?? 'not-scheduled',
      escalationLevel: issue.escalationLevel ?? 0,
    }, this.workspace.settings));
    this.workspace.users = this.workspace.users.map((user) => ({ ...user, initials: user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?', updatedAt: user.updatedAt ?? nowIso() }));
    this.workspace.teams = this.workspace.teams.map((team) => ({
      ...team,
      memberCount: this.workspace.memberships.filter((membership) => membership.teamId === team.id && membership.active).length,
    }));
    this.workspace.todos = this.workspace.todos.map((todo) => ({ ...todo, carryForwardCount: todo.carryForwardCount ?? 0, flagged: todo.flagged ?? false, isMine: todo.ownerId === this.workspace.currentUser.id }));
    this.workspace.meetings = this.workspace.meetings.map((meeting) => {
      const team = this.workspace.teams.find((candidate) => candidate.id === meeting.teamId);
      const sections = team ? meetingSectionsFor(team) : meetingSectionsFor({ meetingSections: [] });
      return { ...meeting, agendaTotal: sections.length, sectionNotes: meeting.sectionNotes ?? {}, idsIssueIds: meeting.idsIssueIds ?? [], createdTodoIds: meeting.createdTodoIds ?? [], idsNotes: meeting.idsNotes ?? [] };
    });
  }

  private membership(teamId: string, userId = this.workspace.currentUser.id) {
    return this.workspace.memberships.find((membership) => membership.teamId === teamId && membership.userId === userId && membership.active);
  }

  private leadershipMember() {
    return this.membership('leadership');
  }

  private canReadTeam(teamId: string) {
    return Boolean(this.membership(teamId) || this.leadershipMember());
  }

  private canWriteTeam(teamId: string) {
    const role = this.membership(teamId)?.role;
    return role === 'OrgAdmin' || role === 'TeamLead' || role === 'Member';
  }

  private requireRead(teamId: string) {
    if (!this.canReadTeam(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You do not have access to this team.');
  }

  private requireWrite(teamId: string) {
    if (!this.canWriteTeam(teamId)) throw new WorkspaceApiError('FORBIDDEN', 'You need team editing access for this action.');
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
    return cloneWorkspace(this.workspace);
  }

  async getWorkspace() {
    this.requireSelectedEnvironmentAccess();
    this.refreshDerivedState();
    return cloneWorkspace(this.workspace);
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
          issues: { total: directIssues.length, open: directIssues.filter((issue) => issue.status === 'open').length, inIds: directIssues.filter((issue) => issue.status === 'in-ids').length, solved: directIssues.filter((issue) => issue.status === 'solved').length, aging: directIssues.filter((issue) => issue.ageBand === 'aging').length, stale: directIssues.filter((issue) => issue.ageBand === 'stale').length, critical: directIssues.filter((issue) => issue.ageBand === 'critical').length },
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
    if (status === 'complete') rock.progress = 100;
    if (status === 'on-track' && rock.progress === 100) rock.progress = 95;
    rock.updatedAt = nowIso();
    rock.version += 1;
    this.audit('Updated Rock status', rock.id, `${rock.title} marked ${status}.`, 'rock');
    return this.result();
  }

  async updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, expectedVersion?: number) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    this.requireVersion(rock.version, expectedVersion);
    Object.assign(rock, input, { updatedAt: nowIso(), version: rock.version + 1 });
    return this.result();
  }

  async addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string }) {
    this.requireWrite(input.teamId);
    const timestamp = nowIso();
    this.workspace.rocks.unshift({ ...input, id: `rock-${Date.now()}`, quarterId: this.workspace.quarter.id, notes: input.notes ?? '', status: 'on-track', progress: 0, tasks: [], createdAt: timestamp, updatedAt: timestamp, version: 1 });
    this.audit('Created Rock', this.workspace.rocks[0].id, input.title, 'rock');
    return this.result();
  }

  async addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>) {
    const rock = this.rock(rockId);
    this.requireWrite(rock.teamId);
    const timestamp = nowIso();
    rock.tasks.push({ ...input, id: `task-${Date.now()}`, rockId, teamId: rock.teamId, status: 'open', createdAt: timestamp, updatedAt: timestamp, version: 1 });
    rock.updatedAt = timestamp;
    rock.version += 1;
    this.audit('Added Rock Task', rock.id, input.title, 'rock');
    return this.result();
  }

  async updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number) {
    const { rock, task } = this.task(taskId);
    this.requireWrite(rock.teamId);
    this.requireVersion(task.version, expectedVersion);
    Object.assign(task, input, { updatedAt: nowIso(), version: task.version + 1 });
    if (task.linkedTodoId) {
      const todo = this.workspace.todos.find((item) => item.id === task.linkedTodoId);
      if (todo) {
        if (input.status) todo.status = input.status === 'done' ? 'done' : 'open';
        if (input.assigneeId) todo.ownerId = input.assigneeId;
        if (input.dueDate) todo.dueDate = input.dueDate;
        todo.updatedAt = nowIso();
        todo.version += 1;
      }
    }
    rock.updatedAt = nowIso();
    rock.version += 1;
    return this.result();
  }

  async convertRockTaskToTodo(taskId: string) {
    const { rock, task } = this.task(taskId);
    this.requireWrite(rock.teamId);
    if (task.linkedTodoId) return this.result();
    const timestamp = nowIso();
    const todo: Todo = { id: `todo-task-${task.id}`, teamId: rock.teamId, title: task.title, notes: task.notes, ownerId: task.assigneeId, dueDate: task.dueDate, status: task.status === 'done' ? 'done' : 'open', origin: `Rock · ${rock.title}`, linkedRockTaskId: task.id, createdAt: timestamp, updatedAt: timestamp, version: 1, carryForwardCount: 0, flagged: false };
    task.linkedTodoId = todo.id;
    task.updatedAt = timestamp;
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
    Object.assign(todo, input, { updatedAt: nowIso(), version: todo.version + 1 });
    if (todo.linkedRockTaskId) {
      const linked = this.task(todo.linkedRockTaskId);
      this.requireWrite(linked.rock.teamId);
      if (input.status) linked.task.status = input.status === 'done' ? 'done' : 'open';
      if (input.ownerId) linked.task.assigneeId = input.ownerId;
      if (input.dueDate) linked.task.dueDate = input.dueDate;
      linked.task.updatedAt = nowIso();
      linked.task.version += 1;
      linked.rock.updatedAt = nowIso();
      linked.rock.version += 1;
    }
    return this.result();
  }

  async moveTodoForward(todoId: string, dueDate: string, expectedVersion?: number) {
    const todo = this.todo(todoId);
    this.requireWrite(todo.teamId);
    this.requireVersion(todo.version, expectedVersion);
    if (todo.status === 'done') throw new WorkspaceApiError('VALIDATION', 'Completed To-Dos do not need to be moved forward.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new WorkspaceApiError('VALIDATION', 'Choose a valid future due date.');
    const timestamp = nowIso();
    todo.dueDate = dueDate;
    todo.status = 'open';
    todo.carryForwardCount += 1;
    todo.flagged = todo.carryForwardCount > 3;
    todo.updatedAt = timestamp;
    todo.version += 1;
    if (todo.linkedRockTaskId) {
      const linked = this.task(todo.linkedRockTaskId);
      linked.task.dueDate = dueDate;
      linked.task.status = 'open';
      linked.task.updatedAt = timestamp;
      linked.task.version += 1;
      linked.rock.updatedAt = timestamp;
      linked.rock.version += 1;
    }
    if (todo.flagged && !todo.convertedIssueId) {
      const issueId = `issue-todo-rollover-${todo.id}`;
      const issue: Issue = {
        id: issueId,
        teamId: todo.teamId,
        sourceTeamId: todo.teamId,
        currentTeamId: todo.teamId,
        title: `Repeated To-Do: ${todo.title}`,
        detail: `This To-Do was moved forward ${todo.carryForwardCount} times. Review the commitment in IDS and decide what must change.`,
        category: 'To-Do rollover',
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
        version: 1,
        meetingsPassed: 0,
        escalationState: 'not-scheduled',
        escalationLevel: 0,
        sourceTodoId: todo.id,
      };
      this.workspace.issues.unshift(issue);
      todo.convertedIssueId = issueId;
      this.audit('Converted repeated To-Do to Issue', issueId, `${todo.title} moved forward ${todo.carryForwardCount} times.`, 'issue');
    } else {
      this.audit('Moved To-Do forward', todo.id, `${todo.title} moved to ${todo.dueDate} (${todo.carryForwardCount} times).`, 'todo');
    }
    return this.result();
  }

  async addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string }) {
    this.requireWrite(input.teamId);
    const timestamp = nowIso();
    this.workspace.todos.unshift({ ...input, id: `todo-${Date.now()}`, notes: input.notes ?? '', status: 'open', origin: input.linkedRockTaskId ? 'Rock Task' : 'Team workspace', createdAt: timestamp, updatedAt: timestamp, version: 1, carryForwardCount: 0, flagged: false });
    this.audit('Created To-Do', this.workspace.todos[0].id, input.title, 'todo');
    return this.result();
  }

  async startIssue(issueId: string) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    if (issue.horizon === 'long-term') throw new WorkspaceApiError('VALIDATION', 'Long-term Issues do not enter the weekly IDS queue.');
    issue.status = 'in-ids';
    issue.updatedAt = nowIso();
    issue.version += 1;
    const meeting = this.workspace.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed');
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
    }
    this.audit('Started IDS', issue.id, issue.title, 'issue');
    return this.result();
  }

  async solveIssue(issueId: string) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    issue.status = 'solved';
    issue.solvedAt = nowIso();
    issue.updatedAt = issue.solvedAt;
    issue.version += 1;
    const meeting = this.workspace.meetings.find((item) => item.teamId === issue.teamId && item.status !== 'closed');
    if (meeting && !meeting.idsIssueIds.includes(issue.id)) {
      meeting.idsIssueIds.push(issue.id);
      meeting.idsTotal = meeting.idsIssueIds.length;
    }
    const followUpId = `todo-follow-up-${issue.id}`;
    if (!this.workspace.todos.some((todo) => todo.id === followUpId)) {
      this.workspace.todos.unshift({ id: followUpId, teamId: issue.teamId, title: `Follow up on the solution: ${issue.title}`, notes: '', ownerId: this.workspace.currentUser.id, dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), status: 'open', origin: `IDS · ${issue.title}`, createdAt: nowIso(), updatedAt: nowIso(), version: 1, carryForwardCount: 0, flagged: false });
      if (meeting) meeting.createdTodoIds.push(followUpId);
    }
    this.audit('Solved Issue', issue.id, `${issue.title}; follow-up To-Do created.`, 'issue');
    return this.result();
  }

  async addIssue(input: Pick<Issue, 'title' | 'detail' | 'category' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; linkedRockId?: string; idsNote?: string }) {
    this.requireWrite(input.teamId);
    const timestamp = nowIso();
    this.workspace.issues.unshift({ ...input, id: `issue-${Date.now()}`, sourceTeamId: input.teamId, currentTeamId: input.teamId, ownerId: input.ownerId ?? input.raisedById, priority: input.priority ?? 1, status: 'open', horizon: input.horizon ?? 'short-term', assignmentState: 'assigned', createdAt: timestamp, updatedAt: timestamp, ageInDays: 0, ageBand: 'fresh', version: 1, meetingsPassed: 0, escalationState: 'not-scheduled', escalationLevel: 0 });
    this.audit('Created Issue', this.workspace.issues[0].id, input.title, 'issue');
    return this.result();
  }

  async updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    this.requireVersion(issue.version, expectedVersion);
    Object.assign(issue, input, { updatedAt: nowIso(), version: issue.version + 1 });
    return this.result();
  }

  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number) {
    const issue = this.issue(issueId);
    this.requireWrite(issue.teamId);
    this.requireVersion(issue.version, expectedVersion);
    if (!note.trim()) throw new WorkspaceApiError('VALIDATION', 'Add a note before saving.');
    const meeting = this.workspace.meetings.find((item) => item.id === meetingId && item.teamId === issue.teamId);
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting record not found.');
    if (meeting.status === 'closed') throw new WorkspaceApiError('CONFLICT', 'Closed meetings cannot receive new IDS notes.');
    const timestamp = nowIso();
    const entry = { id: `meeting-note-${Date.now()}`, meetingId, issueId, authorId: this.workspace.currentUser.id, note: note.trim(), createdAt: timestamp };
    meeting.idsNotes.push(entry);
    if (!meeting.idsIssueIds.includes(issue.id)) meeting.idsIssueIds.push(issue.id);
    meeting.idsTotal = meeting.idsIssueIds.length;
    issue.idsNote = appendMeetingNote(issue.idsNote, meeting.label, note);
    issue.status = issue.status === 'open' ? 'in-ids' : issue.status;
    issue.updatedAt = timestamp;
    issue.version += 1;
    this.audit('Added meeting IDS note', issue.id, `${meeting.label}: ${note.trim()}`, 'issue');
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
      this.workspace.issues.push({ ...sourceIssue, teamId: transfer.destinationTeamId, currentTeamId: transfer.destinationTeamId, assignmentState: 'assigned', updatedAt: timestamp, version: 1 });
    }
    sourceIssue.assignmentState = 'redirected';
    sourceIssue.currentTeamId = transfer.destinationTeamId;
    sourceIssue.updatedAt = timestamp;
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

  async createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId'>) {
    const message = this.workspace.messages.find((item) => item.id === messageId);
    if (!message) throw new WorkspaceApiError('NOT_FOUND', 'Message not found.');
    this.requireWrite(message.toTeamId);
    if (message.convertedIssueId) return this.result();
    const timestamp = nowIso();
    const issueId = `issue-message-${message.id}`;
    const issue: Issue = { id: issueId, teamId: message.toTeamId, sourceTeamId: message.toTeamId, currentTeamId: message.toTeamId, title: input.title.trim(), detail: input.detail.trim(), category: input.category, priority: input.priority, status: 'open', horizon: input.horizon, assignmentState: 'assigned', raisedById: this.workspace.currentUser.id, ownerId: input.ownerId, createdAt: timestamp, updatedAt: timestamp, ageInDays: 0, ageBand: 'fresh', version: 1, meetingsPassed: 0, escalationState: 'not-scheduled', escalationLevel: 0 };
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
    Object.assign(user, input, { updatedAt: nowIso() });
    this.workspace.currentUser = user;
    this.audit('Updated profile', user.id, 'Profile details or avatar changed.', 'profile');
    return this.result();
  }

  async createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) {
    this.requireAdmin();
    if (!input.parentTeamId) throw new WorkspaceApiError('VALIDATION', 'New teams must be placed under the Leadership Team.');
    if (input.parentTeamId && !this.workspace.teams.some((team) => team.id === input.parentTeamId)) throw new WorkspaceApiError('VALIDATION', 'Parent team not found.');
    const id = slugify(input.name);
    if (this.workspace.teams.some((team) => team.id === id)) throw new WorkspaceApiError('CONFLICT', 'A team with that name already exists.');
    const team: Team = { ...input, id, meetingSections: input.meetingSections ?? meetingSectionsFor({ meetingSections: [] }), escalationUserIds: input.escalationUserIds ?? [], memberCount: 0, active: true };
    this.workspace.teams.push(team);
    if (team.nodeType === 'operational') {
      this.workspace.meetings.push({ id: `meeting-${team.id}-current`, teamId: team.id, label: `${team.shortName} L10`, dateLabel: `This week · ${team.meetingDay}`, status: 'upcoming', facilitatorId: team.escalationUserIds[0] ?? this.workspace.currentUser.id, attendeeIds: [], lastRating: 0, agendaProgress: 0, agendaTotal: meetingSectionsFor(team).length, idsSolved: 0, idsTotal: 0, recap: '', startedAt: undefined, closedAt: undefined, sectionNotes: {}, idsIssueIds: [], createdTodoIds: [], idsNotes: [], } as Workspace['meetings'][number]);
    }
    this.audit('Created team', id, input.name, 'team');
    return this.result();
  }

  async updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) {
    this.requireAdmin();
    const team = this.workspace.teams.find((item) => item.id === teamId);
    if (!team) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    if (teamId === 'leadership' && input.parentTeamId !== undefined && input.parentTeamId !== null) throw new WorkspaceApiError('VALIDATION', 'Leadership Team must remain the hierarchy root.');
    if (teamId !== 'leadership' && input.parentTeamId === null) throw new WorkspaceApiError('VALIDATION', 'Teams must remain under the Leadership Team hierarchy.');
    if (input.parentTeamId === teamId || (input.parentTeamId && this.descendantIds(teamId).includes(input.parentTeamId))) throw new WorkspaceApiError('VALIDATION', 'A team cannot be its own ancestor.');
    if (input.parentTeamId && !this.workspace.teams.some((item) => item.id === input.parentTeamId)) throw new WorkspaceApiError('VALIDATION', 'Parent team not found.');
    if (team.nodeType === 'operational' && input.nodeType === 'grouping' && (this.workspace.rocks.some((rock) => rock.teamId === teamId) || this.workspace.todos.some((todo) => todo.teamId === teamId) || activeIssues(this.workspace.issues).some((issue) => issue.teamId === teamId))) throw new WorkspaceApiError('VALIDATION', 'Resolve active work before changing this node to grouping-only.');
    if (input.meetingSections && (!input.meetingSections.some((section) => section.id === 'ids' && section.enabled) || !input.meetingSections.some((section) => section.id === 'conclude' && section.enabled))) throw new WorkspaceApiError('VALIDATION', 'IDS and Conclude must remain enabled for every L10.');
    if (input.meetingSections?.some((section) => !Number.isInteger(section.duration) || section.duration < 1 || section.duration > 180)) throw new WorkspaceApiError('VALIDATION', 'Meeting section durations must be whole minutes between 1 and 180.');
    if (input.escalationUserIds?.some((userId) => !this.workspace.users.some((user) => user.id === userId && user.active))) throw new WorkspaceApiError('VALIDATION', 'Every escalation recipient must be an active user.');
    Object.assign(team, input);
    this.audit('Updated team', team.id, team.name, 'team');
    return this.result();
  }

  async createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) {
    this.requireAdmin();
    const timestamp = nowIso();
    const id = slugify(input.email.split('@')[0]);
    if (this.workspace.users.some((user) => user.id === id)) throw new WorkspaceApiError('CONFLICT', 'A local user with that email already exists.');
    this.workspace.users.push({ id, name: input.name, initials: input.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(), email: input.email, accent: input.accent, active: true, platformCapabilities: input.platformAdmin ? ['PlatformAdmin'] : [], createdAt: timestamp, updatedAt: timestamp });
    this.audit('Created local user', id, input.email, 'profile');
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

  async closeMeeting(teamId: string, recap: string, rating: number) {
    this.requireWrite(teamId);
    const meeting = this.workspace.meetings.find((item) => item.teamId === teamId && item.status !== 'closed');
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    if (meeting.status === 'closed') throw new WorkspaceApiError('CONFLICT', 'This meeting is already closed.');
    const activeTeam = this.workspace.teams.find((team) => team.id === teamId);
    if (!activeTeam) throw new WorkspaceApiError('NOT_FOUND', 'Team not found.');
    const timestamp = nowIso();
    const sections = meetingSectionsFor(activeTeam);
    meeting.status = 'closed';
    meeting.closedAt = timestamp;
    meeting.agendaProgress = sections.length;
    meeting.agendaTotal = sections.length;
    meeting.recap = meetingRecap(this.workspace, activeTeam, meeting, recap);
    meeting.lastRating = Math.min(10, Math.max(0, rating));
    meeting.idsTotal = meeting.idsIssueIds.length;
    meeting.idsSolved = meeting.idsIssueIds.filter((issueId) => this.workspace.issues.find((issue) => issue.id === issueId)?.status === 'solved').length;
    advanceIssueEscalations(this.workspace, activeTeam, meeting, timestamp, this.notify.bind(this));
    const nextDate = new Date(new Date(timestamp).getTime() + 7 * DAY);
    const carriedIssueIds = meeting.idsIssueIds.filter((issueId) => this.workspace.issues.find((issue) => issue.id === issueId)?.status !== 'solved');
    const nextMeeting: Workspace['meetings'][number] = { id: `meeting-${activeTeam.id}-${nextDate.toISOString().slice(0, 10)}-${Date.now()}`, teamId: activeTeam.id, label: `${activeTeam.shortName} L10`, dateLabel: `${activeTeam.meetingDay} · ${nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, status: 'upcoming', facilitatorId: activeTeam.escalationUserIds[0] ?? meeting.facilitatorId, attendeeIds: [...meeting.attendeeIds], lastRating: meeting.lastRating, agendaProgress: 0, agendaTotal: sections.length, idsSolved: 0, idsTotal: carriedIssueIds.length, recap: '', sectionNotes: {}, idsIssueIds: carriedIssueIds, createdTodoIds: [], idsNotes: [] };
    this.workspace.meetings.push(nextMeeting);
    this.audit('Closed L10 meeting', meeting.id, recap || 'Meeting closed without a recap.', 'meeting');
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
  headlines: Workspace['headlines'];
  audit: Array<{ id: string; actorId: string; action: string; target: string; detail: string; createdAt: string; eventType?: string; type?: string }>;
  quarter: QuarterDto;
  etag: string;
};

type QuarterDto = Workspace['quarter'];

function codeForResponse(value: unknown): WorkspaceApiError['code'] {
  return value === 'NOT_FOUND' || value === 'FORBIDDEN' || value === 'CONFLICT' || value === 'VALIDATION' || value === 'UNAVAILABLE' ? value : 'UNAVAILABLE';
}

function serverTeam(team: Team & { teamId?: string }): Team {
  return { ...team, id: team.id || team.teamId || '', memberCount: team.memberCount ?? 0 };
}

function serverMembership(membership: TeamMembership): TeamMembership {
  return membership;
}

function mapSnapshot(snapshot: ApiSnapshot): Workspace {
  const teams = snapshot.teams.map(serverTeam);
  const tasksByRock = new Map<string, RockTask[]>();
  for (const task of snapshot.tasks) tasksByRock.set(task.rockId, [...(tasksByRock.get(task.rockId) ?? []), task]);
  return {
    environment: snapshot.environmentId,
    currentUser: snapshot.user,
    quarter: snapshot.quarter,
    settings: snapshot.settings,
    teams,
    users: snapshot.users,
    memberships: snapshot.memberships.map(serverMembership),
    rocks: snapshot.rocks.map((rock) => ({ ...rock, id: rock.id, tasks: tasksByRock.get(rock.id) ?? [] })),
    todos: snapshot.todos,
    issues: snapshot.issues,
    messages: snapshot.messages,
    transfers: snapshot.transfers,
    notifications: snapshot.notifications,
    metrics: snapshot.metrics,
    headlines: snapshot.headlines,
    meetings: snapshot.meetings,
    activity: snapshot.audit.map((event) => ({ id: event.id, actorId: event.actorId, action: event.action, target: event.target, detail: event.detail, createdAt: event.createdAt, type: (event.type ?? event.eventType) === 'admin' ? 'team' : (event.type ?? event.eventType ?? 'team') as Workspace['activity'][number]['type'] })),
  };
}

/** HTTP adapter used when VITE_LOCAL_POC_MODE=false. Cookies are sent by the
 * browser, while the API remains the authority for environment access. */
export class HttpWorkspaceApi implements WorkspaceApi {
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
    return { currentEnvironment: session.currentEnvironment, availableEnvironments: session.availableEnvironments, canSwitchToTest: session.canSwitchToTest };
  }

  async getEnvironmentAccess(): Promise<EnvironmentAccess[]> {
    const response = await this.request<{ access: EnvironmentAccess[] }>('/admin/environment-access');
    return response.access;
  }

  async updateEnvironmentAccess(userId: string, testAllowed: boolean): Promise<EnvironmentAccess[]> {
    await this.request(`/admin/environment-access/${encodeURIComponent(userId)}`, 'PATCH', { testAllowed });
    return this.getEnvironmentAccess();
  }

  async getWorkspace(): Promise<Workspace> {
    return mapSnapshot(await this.request<ApiSnapshot>('/workspace'));
  }

  async getCompanyOverview(): Promise<CompanyOverview> {
    const overview = await this.request<{ teams: CompanyOverview['teams']; issues: Issue[]; rocks: Rock[]; todos: Todo[] }>('/company/overview');
    return { teams: overview.teams, issues: overview.issues, rocks: overview.rocks.map((rock) => ({ ...rock, tasks: rock.tasks ?? [] })), todos: overview.todos };
  }

  private async mutate(path: string, method: string, body?: unknown, expectedVersion?: number) {
    await this.request(path, method, body, expectedVersion);
    return this.getWorkspace();
  }

  async updateRockStatus(rockId: string, status: RockStatus, expectedVersion?: number) { return this.mutate(`/rocks/${rockId}/status`, 'PATCH', { status }, expectedVersion); }
  async updateRock(rockId: string, input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>, expectedVersion?: number) { return this.mutate(`/rocks/${rockId}`, 'PATCH', input, expectedVersion); }
  async addRock(input: Pick<Rock, 'title' | 'description' | 'ownerId' | 'dueDate' | 'priority' | 'teamId'> & { notes?: string }) { return this.mutate(`/teams/${input.teamId}/rocks`, 'POST', input); }
  async addRockTask(rockId: string, input: Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>) { return this.mutate(`/rocks/${rockId}/tasks`, 'POST', input); }
  async updateRockTask(taskId: string, input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>, expectedVersion?: number) { return this.mutate(`/rock-tasks/${taskId}`, 'PATCH', input, expectedVersion); }
  async convertRockTaskToTodo(taskId: string) { return this.mutate(`/rock-tasks/${taskId}/todo`, 'POST'); }
  async updateTodoStatus(todoId: string, status: TodoStatus, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/status`, 'PATCH', { status }, expectedVersion); }
  async updateTodo(todoId: string, input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>, expectedVersion?: number) { return this.mutate(`/todos/${todoId}`, 'PATCH', input, expectedVersion); }
  async moveTodoForward(todoId: string, dueDate: string, expectedVersion?: number) { return this.mutate(`/todos/${todoId}/move-forward`, 'POST', { dueDate }, expectedVersion); }
  async addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'> & { notes?: string; linkedRockTaskId?: string }) { return this.mutate(`/teams/${input.teamId}/todos`, 'POST', input); }
  async startIssue(issueId: string) { return this.mutate(`/issues/${issueId}/ids`, 'POST'); }
  async solveIssue(issueId: string) { return this.mutate(`/issues/${issueId}/solve`, 'POST'); }
  async addIssue(input: Pick<Issue, 'title' | 'detail' | 'category' | 'teamId' | 'raisedById'> & { horizon?: IssueHorizon; priority?: number; ownerId?: string; linkedRockId?: string; idsNote?: string }) { return this.mutate(`/teams/${input.teamId}/issues`, 'POST', input); }
  async updateIssue(issueId: string, input: Partial<Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, expectedVersion?: number) { return this.mutate(`/issues/${issueId}`, 'PATCH', input, expectedVersion); }
  async addMeetingIssueNote(issueId: string, meetingId: string, note: string, expectedVersion?: number) {
    const workspace = await this.getWorkspace();
    const issue = workspace.issues.find((candidate) => candidate.id === issueId);
    if (!issue) throw new WorkspaceApiError('NOT_FOUND', 'Issue not found.');
    return this.mutate(`/teams/${issue.teamId}/meetings/${meetingId}/issues/${issueId}/notes`, 'POST', { note }, expectedVersion);
  }
  async requestIssueTransfer(issueId: string, destinationTeamId: string, note?: string) { return this.mutate(`/issues/${issueId}/transfers`, 'POST', { destinationTeamId, note }); }
  async acceptIssueTransfer(transferId: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/accept`, 'POST', undefined, expectedVersion); }
  async rejectIssueTransfer(transferId: string, message: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/reject`, 'POST', { message }, expectedVersion); }
  async cancelIssueTransfer(transferId: string, expectedVersion?: number) { return this.mutate(`/issue-transfers/${transferId}/cancel`, 'POST', undefined, expectedVersion); }
  async sendTeamMessage(input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>) { return this.mutate(`/teams/${input.fromTeamId}/messages`, 'POST', input); }
  async markMessageRead(messageId: string, expectedVersion?: number) { return this.mutate(`/messages/${messageId}/read`, 'POST', undefined, expectedVersion); }
  async createIssueFromMessage(messageId: string, input: Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId'>) { return this.mutate(`/messages/${messageId}/issue`, 'POST', input); }
  async markNotificationRead(notificationId: string) { return this.mutate(`/notifications/${notificationId}/read`, 'PATCH'); }
  async updateProfile(input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>) { return this.mutate('/profile', 'PATCH', input); }
  async createTeam(input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) { return this.mutate('/admin/teams', 'POST', input); }
  async updateTeam(teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) { return this.mutate(`/admin/teams/${teamId}`, 'PATCH', input); }
  async createUser(input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) { return this.mutate('/admin/users', 'POST', input); }
  async upsertMembership(input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>) { return this.mutate('/admin/memberships', 'PUT', input); }
  async updateAgeSettings(settings: IssueAgeSettings) { return this.mutate('/admin/settings/aging', 'PUT', settings); }
  async closeMeeting(teamId: string, recap: string, rating: number) {
    const workspace = await this.getWorkspace();
    const meeting = workspace.meetings.find((candidate) => candidate.teamId === teamId && candidate.status !== 'closed');
    if (!meeting) throw new WorkspaceApiError('NOT_FOUND', 'Meeting not found.');
    return this.mutate(`/teams/${teamId}/meetings/${meeting.id}/close`, 'POST', { recap, rating }, meeting.version);
  }
}

export const workspaceApi: WorkspaceApi = import.meta.env.VITE_LOCAL_POC_MODE === 'false' ? new HttpWorkspaceApi() : new LocalWorkspaceApi();
