import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryWorkspaceRepository, RepositoryError } from './repository.js';
import { DEFAULT_MEETING_SECTIONS } from '../domain.js';

async function rejectsWithCode(operation: Promise<unknown>, code: RepositoryError['code']) {
  await assert.rejects(operation, (error: unknown) => error instanceof RepositoryError && error.code === code);
}

test('team workspaces enforce direct membership while Leadership can drill down read-only', async () => {
  const repository = new MemoryWorkspaceRepository();

  const projects = await repository.getTeamWorkspace('projects', 'marcus-lee');
  assert.equal(projects.team.parentTeamId, 'professional-services');
  assert.equal(projects.membership?.role, 'TeamLead');
  assert.ok(projects.rocks.length > 0);

  const leadershipView = await repository.getTeamWorkspace('projects', 'ava-khan');
  assert.equal(leadershipView.membership, null);
  assert.ok(leadershipView.rocks.length > 0);
  await rejectsWithCode(repository.updateRockStatus('rock-project-kickoff', 'off-track', 'ava-khan'), 'FORBIDDEN');
  await rejectsWithCode(repository.getTeamWorkspace('projects', 'priya-shah'), 'FORBIDDEN');
});

test('PlatformAdmin can administer configuration without receiving work-data access', async () => {
  const repository = new MemoryWorkspaceRepository();
  const user = await repository.createUser({ name: 'Platform Only', email: 'platform-only@bremmar.com', accent: '#123456', platformAdmin: true }, 'ava-khan');

  const snapshot = await repository.getAdminSnapshot(user.id);
  assert.equal(snapshot.users.some((candidate) => candidate.id === user.id), true);
  await rejectsWithCode(repository.getTeamWorkspace('projects', user.id), 'FORBIDDEN');
  await rejectsWithCode(repository.getCompanyOverview(user.id), 'FORBIDDEN');
});

test('created directory users use the Entra object ID as their stable application key', async () => {
  const repository = new MemoryWorkspaceRepository();
  const user = await repository.createUser({ name: 'Directory User', email: 'directory-user@bremmar.com', accent: '#123456', identityId: 'CA795A1D-6402-4335-9141-D40E7F078812' }, 'ava-khan');
  assert.equal(user.id, 'ca795a1d-6402-4335-9141-d40e7f078812');
  assert.equal((await repository.getUser(user.id))?.email, 'directory-user@bremmar.com');
});

test('Issue transfers preserve identity, original age, and first-decision semantics', async () => {
  const repository = new MemoryWorkspaceRepository();
  const before = await repository.getIssue('issue-project-scope', 'marcus-lee');
  const requested = await repository.requestIssueTransfer({ issueId: before.id, destinationTeamId: 'cybersecurity', requestedById: 'marcus-lee', idempotencyKey: 'handoff-1' });
  const repeated = await repository.requestIssueTransfer({ issueId: before.id, destinationTeamId: 'cybersecurity', requestedById: 'marcus-lee', idempotencyKey: 'handoff-1' });
  assert.equal(repeated.id, requested.id);

  await repository.acceptIssueTransfer(requested.id, 'priya-shah', requested.version);
  await rejectsWithCode(repository.rejectIssueTransfer(requested.id, 'priya-shah', 'Too late.'), 'CONFLICT');

  const destination = await repository.getTeamWorkspace('cybersecurity', 'priya-shah');
  const transferred = destination.issues.find((issue) => issue.id === before.id);
  assert.equal(transferred?.teamId, 'cybersecurity');
  assert.equal(transferred?.createdAt, before.createdAt);
  assert.equal(transferred?.ageInDays >= before.ageInDays, true);
  const source = await repository.getTeamWorkspace('projects', 'marcus-lee');
  assert.equal(source.issues.some((issue) => issue.id === before.id), false);
});

test('Issue rejection requires a message and returns the source copy unassigned', async () => {
  const repository = new MemoryWorkspaceRepository();
  const transfer = await repository.requestIssueTransfer({ issueId: 'issue-project-scope', destinationTeamId: 'cybersecurity', requestedById: 'marcus-lee', idempotencyKey: 'reject-1' });
  await rejectsWithCode(repository.rejectIssueTransfer(transfer.id, 'priya-shah', '  '), 'VALIDATION');
  await repository.rejectIssueTransfer(transfer.id, 'priya-shah', 'Cybersecurity needs a clearer owner.', transfer.version);

  const source = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const issue = source.issues.find((candidate) => candidate.id === 'issue-project-scope');
  assert.equal(issue?.assignmentState, 'unassigned');
  assert.equal(issue?.currentTeamId, null);
  assert.equal(issue?.ownerId, undefined);
  assert.equal((await repository.getIssueTransfer(transfer.id)).rejectionMessage, 'Cybersecurity needs a clearer owner.');
});

test('Rock Task conversion is idempotent and keeps linked To-Do fields synchronized', async () => {
  const repository = new MemoryWorkspaceRepository();
  const task = await repository.createRockTask({ rockId: 'rock-project-kickoff', title: 'Run the pilot', assigneeId: 'marcus-lee', assignedAt: '2026-09-02', startDate: '2026-09-03', dueDate: '2026-09-10' }, 'marcus-lee');
  const first = await repository.convertRockTaskToTodo(task.id, 'marcus-lee');
  const second = await repository.convertRockTaskToTodo(task.id, 'marcus-lee');
  assert.equal(first.todo.id, second.todo.id);

  await repository.updateRockTask(task.id, { status: 'done', assigneeId: 'maya-green', dueDate: '2026-09-12' }, 'marcus-lee', first.task.version);
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const linked = workspace.todos.find((todo) => todo.id === first.todo.id);
  assert.deepEqual({ status: linked?.status, ownerId: linked?.ownerId, dueDate: linked?.dueDate }, { status: 'done', ownerId: 'maya-green', dueDate: '2026-09-12' });
  await repository.updateTodo(first.todo.id, { status: 'open', ownerId: 'marcus-lee', dueDate: '2026-09-13' }, 'marcus-lee', linked?.version);
  const synchronized = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const synchronizedTask = synchronized.tasks.find((candidate) => candidate.id === task.id);
  assert.deepEqual({ status: synchronizedTask?.status, assigneeId: synchronizedTask?.assigneeId, dueDate: synchronizedTask?.dueDate }, { status: 'open', assigneeId: 'marcus-lee', dueDate: '2026-09-13' });
});

test('solving an Issue creates an idempotent follow-up To-Do in the same team workspace', async () => {
  const repository = new MemoryWorkspaceRepository();
  await repository.solveIssue('issue-project-scope', 'marcus-lee');
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');
  assert.equal(workspace.todos.filter((todo) => todo.id === 'todo-follow-up-issue-project-scope').length, 1);
});

test('stale versions are rejected and grouping conversion cannot hide active work', async () => {
  const repository = new MemoryWorkspaceRepository();
  const issue = await repository.getIssue('issue-project-scope', 'marcus-lee');
  await repository.updateIssue(issue.id, { detail: 'Updated context.' }, 'marcus-lee', issue.version);
  await rejectsWithCode(repository.updateIssue(issue.id, { detail: 'Stale edit.' }, 'marcus-lee', issue.version), 'CONFLICT');
  await rejectsWithCode(repository.updateTeam('projects', { nodeType: 'grouping' }, 'ava-khan'), 'VALIDATION');
});

test('avatar validation and configurable aging settings stay behind the admin boundary', async () => {
  const repository = new MemoryWorkspaceRepository();
  await rejectsWithCode(repository.updateUserProfile({ avatarDataUrl: 'not-an-avatar' }, 'ava-khan'), 'VALIDATION');
  await repository.updateAgeSettings({ agingDays: 5, staleDays: 10, criticalDays: 20 }, 'ava-khan', 1);
  const snapshot = await repository.getAdminSnapshot('ava-khan');
  assert.deepEqual(snapshot.settings, { agingDays: 5, staleDays: 10, criticalDays: 20, version: 2 });
  await rejectsWithCode(repository.updateAgeSettings({ agingDays: 6, staleDays: 12, criticalDays: 24 }, 'ava-khan', 1), 'CONFLICT');
});

test('To-Do due-date edits roll incomplete work forward and leave earlier, unchanged, and completed edits ordinary', async () => {
  const repository = new MemoryWorkspaceRepository();
  let todo = (await repository.getTeamWorkspace('projects', 'marcus-lee')).todos.find((item) => item.id === 'todo-project-kickoff')!;
  todo = await repository.updateTodo(todo.id, { dueDate: '2026-09-10', status: 'done' }, 'marcus-lee', todo.version);
  assert.deepEqual({ dueDate: todo.dueDate, status: todo.status, carryForwardCount: todo.carryForwardCount }, { dueDate: '2026-09-10', status: 'open', carryForwardCount: 1 });
  todo = await repository.updateTodo(todo.id, { dueDate: '2026-09-06' }, 'marcus-lee', todo.version);
  todo = await repository.updateTodo(todo.id, { dueDate: todo.dueDate }, 'marcus-lee', todo.version);
  assert.equal(todo.carryForwardCount, 1);

  let completed = await repository.createTodo({ teamId: 'projects', title: 'Completed commitment', ownerId: 'marcus-lee', dueDate: '2026-09-05' }, 'marcus-lee');
  completed = await repository.updateTodo(completed.id, { status: 'done' }, 'marcus-lee', completed.version);
  completed = await repository.updateTodo(completed.id, { dueDate: '2099-09-30' }, 'marcus-lee', completed.version);
  assert.deepEqual({ status: completed.status, carryForwardCount: completed.carryForwardCount, dueDate: completed.dueDate }, { status: 'done', carryForwardCount: 0, dueDate: '2099-09-30' });
});

test('linked Rock Tasks follow automatic To-Do rollover and the fourth rollover creates one Issue', async () => {
  const repository = new MemoryWorkspaceRepository();
  const task = await repository.createRockTask({ rockId: 'rock-project-kickoff', title: 'Run the pilot', assigneeId: 'marcus-lee', assignedAt: '2026-09-02', startDate: '2026-09-03', dueDate: '2026-09-10' }, 'marcus-lee');
  const converted = await repository.convertRockTaskToTodo(task.id, 'marcus-lee');
  const rolled = await repository.updateTodo(converted.todo.id, { dueDate: '2026-09-17' }, 'marcus-lee', converted.todo.version);
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const synchronizedTask = workspace.tasks.find((candidate) => candidate.id === task.id)!;
  assert.deepEqual({ status: rolled.status, dueDate: rolled.dueDate, carryForwardCount: rolled.carryForwardCount }, { status: 'open', dueDate: '2026-09-17', carryForwardCount: 1 });
  assert.deepEqual({ status: synchronizedTask.status, dueDate: synchronizedTask.dueDate }, { status: 'open', dueDate: '2026-09-17' });

  let todo = (await repository.getTeamWorkspace('projects', 'marcus-lee')).todos.find((item) => item.id === 'todo-project-kickoff')!;
  for (let count = 0; count < 4; count += 1) todo = await repository.updateTodo(todo.id, { dueDate: `2099-09-${String(10 + count).padStart(2, '0')}` }, 'marcus-lee', todo.version);
  const issue = (await repository.getTeamWorkspace('projects', 'marcus-lee')).issues.find((item) => item.sourceTodoId === todo.id);
  assert.equal(todo.carryForwardCount, 4);
  assert.equal(todo.flagged, true);
  assert.equal(issue?.sourceTodoId, todo.id);
  assert.equal((await repository.getTeamWorkspace('projects', 'marcus-lee')).issues.filter((item) => item.sourceTodoId === todo.id).length, 1);
});

test('weekly scorecard definitions and results are team-scoped, versioned, and trend-aware', async () => {
  const repository = new MemoryWorkspaceRepository();
  const week = (await repository.getTeamWorkspace('projects', 'marcus-lee')).meetings[0].weekStartDate;
  const metric = await repository.createScorecardMetric({ teamId: 'projects', label: 'Pilot completion rate', target: '90%', unit: 'percent', ownerId: 'marcus-lee' }, 'marcus-lee');
  assert.deepEqual({ kind: metric.kind, teamId: metric.teamId, pk: metric.pk, version: metric.version }, { kind: 'scorecardMetric', teamId: 'projects', pk: 'team:projects', version: 1 });
  const priorWeek = new Date(`${week}T12:00:00Z`);
  priorWeek.setUTCDate(priorWeek.getUTCDate() - 7);
  const prior = await repository.upsertScorecardResult(metric.id, priorWeek.toISOString().slice(0, 10), { actual: '80%', status: 'off-track' }, 'marcus-lee');
  const current = await repository.upsertScorecardResult(metric.id, week, { actual: '95%', status: 'on-track' }, 'marcus-lee');
  assert.deepEqual({ actual: current.actual, status: current.status, trend: current.trend, trendLabel: current.trendLabel, version: current.version }, { actual: '95%', status: 'on-track', trend: 'up', trendLabel: '+15 vs prior week', version: 1 });
  const editedMetric = await repository.updateScorecardMetric(metric.id, { target: '92%' }, 'marcus-lee', metric.version);
  assert.equal(editedMetric.version, 2);
  await rejectsWithCode(repository.updateScorecardMetric(metric.id, { target: '93%' }, 'marcus-lee', metric.version), 'CONFLICT');
  const editedResult = await repository.upsertScorecardResult(metric.id, week, { actual: '96%', status: 'on-track' }, 'marcus-lee', current.version);
  assert.equal(editedResult.version, 2);
  assert.equal((await repository.getTeamWorkspace('projects', 'marcus-lee')).scorecardResults.filter((result) => result.metricId === metric.id && result.weekStartDate === week).length, 1);
  await rejectsWithCode(repository.upsertScorecardResult(metric.id, week, { actual: '97%', status: 'on-track' }, 'marcus-lee', current.version), 'CONFLICT');
  const snapshot = await repository.getWorkspaceSnapshot('marcus-lee');
  assert.equal(snapshot.metrics.some((item) => item.id === metric.id), true);
  assert.equal(snapshot.scorecardResults.some((item) => item.id === prior.id), true);
  assert.equal(repository.exportWorkspaceRecords().filter((record) => record.kind === 'scorecardResult' && record.pk === 'team:projects').length >= 2, true);
});

test('scorecard writes enforce TeamLead/Member access, keep Viewers read-only, and reject grouping-only nodes', async () => {
  const repository = new MemoryWorkspaceRepository();
  const metric = await repository.createScorecardMetric({ teamId: 'projects', label: 'Authorization metric', target: '1', unit: 'item', ownerId: 'marcus-lee' }, 'marcus-lee');
  const week = (await repository.getTeamWorkspace('projects', 'marcus-lee')).meetings[0].weekStartDate;
  await rejectsWithCode(repository.updateScorecardMetric(metric.id, { target: '2' }, 'priya-shah', metric.version), 'FORBIDDEN');
  await rejectsWithCode(repository.upsertScorecardResult(metric.id, week, { actual: '1', status: 'on-track' }, 'priya-shah'), 'FORBIDDEN');
  await repository.upsertMembership({ userId: 'maya-green', teamId: 'projects', role: 'Viewer' }, 'ava-khan');
  await rejectsWithCode(repository.createScorecardMetric({ teamId: 'projects', label: 'Viewer metric', target: '1', unit: 'item', ownerId: 'maya-green' }, 'maya-green'), 'FORBIDDEN');
  await rejectsWithCode(repository.upsertScorecardResult(metric.id, week, { actual: '1', status: 'on-track' }, 'ava-khan'), 'FORBIDDEN');
  const grouping = await repository.createTeam({ teamId: 'grouping-only', name: 'Grouping Only', shortName: 'Group', description: 'No direct work.', parentTeamId: 'leadership', nodeType: 'grouping', meetingDay: 'Monday', meetingTime: '9:00 AM', accent: '#4c8f86', initials: 'GO', meetingSections: DEFAULT_MEETING_SECTIONS, escalationUserIds: [] }, 'ava-khan');
  assert.equal(grouping.nodeType, 'grouping');
  await repository.upsertMembership({ userId: 'ava-khan', teamId: 'grouping-only', role: 'Member' }, 'ava-khan');
  await rejectsWithCode(repository.createScorecardMetric({ teamId: 'grouping-only', label: 'Invalid metric', target: '1', unit: 'item', ownerId: 'ava-khan' }, 'ava-khan'), 'VALIDATION');
});

test('meeting recaps use the matching Monday-start weekly scorecard result', async () => {
  const repository = new MemoryWorkspaceRepository();
  const before = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const meeting = before.meetings[0];
  const metric = before.metrics.find((item) => item.id === 'metric-project-kickoffs')!;
  const existing = before.scorecardResults.find((result) => result.metricId === metric.id && result.weekStartDate === meeting.weekStartDate)!;
  await repository.upsertScorecardResult(metric.id, meeting.weekStartDate, { actual: '70%', status: 'off-track' }, 'marcus-lee', existing.version);
  const closed = await repository.closeMeeting('projects', meeting.id, 'Weekly review complete.', 9, 'marcus-lee', meeting.version);
  assert.match(closed.recap, /Scorecard: off-track/);
  assert.match(closed.recap, /70%/);
  assert.match(closed.recap, new RegExp(meeting.weekStartDate));
});

test('team messages can be read and converted into an editable Issue in the receiving workspace', async () => {
  const repository = new MemoryWorkspaceRepository();
  const sent = await repository.sendTeamMessage({ fromTeamId: 'projects', toTeamId: 'leadership', subject: 'Confirm kickoff owner', body: 'Please choose the receiving owner before the customer meeting.', senderId: 'marcus-lee' });
  assert.equal(sent.status, 'unread');
  const read = await repository.markMessageRead(sent.id, 'ava-khan', sent.version);
  assert.equal(read.status, 'read');
  const issue = await repository.createIssueFromMessage({ messageId: sent.id, title: 'Kickoff owner needs confirmation', detail: 'Please choose the receiving owner before the customer meeting.', category: 'Cross-team', priority: 2, horizon: 'short-term', ownerId: 'ava-khan' }, 'ava-khan');
  assert.deepEqual({ teamId: issue.teamId, title: issue.title }, { teamId: 'leadership', title: 'Kickoff owner needs confirmation' });
  assert.equal((await repository.getTeamWorkspace('leadership', 'ava-khan')).messages.find((message) => message.id === sent.id)?.status, 'converted');
});

test('meeting IDS notes update the Issue and the closed recap includes the complete meeting record', async () => {
  const repository = new MemoryWorkspaceRepository();
  const issue = await repository.createIssue({ teamId: 'leadership', title: 'The owner matrix needs a decision', detail: 'The team needs one accountable owner.', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const before = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const meeting = before.meetings[0];
  const noted = await repository.addMeetingIssueNote(issue.id, meeting.id, 'Decided to publish the owner matrix with the onboarding checklist.', 'ava-khan', issue.version);
  assert.equal(noted.issue.status, 'in-ids');
  assert.match(noted.issue.idsNote ?? '', /publish the owner matrix/);
  const closed = await repository.closeMeeting('leadership', meeting.id, 'Keep the decision visible.', 9, 'ava-khan', noted.meeting.version);
  assert.match(closed.recap, /Rock Review:/);
  assert.match(closed.recap, /To-Do Review:/);
  assert.match(closed.recap, /IDS:/);
  assert.match(closed.recap, /publish the owner matrix/);
});

test('administrators can disable a team Scorecard while retaining IDS and Conclude', async () => {
  const repository = new MemoryWorkspaceRepository();
  const saved = await repository.updateTeam('cybersecurity', { meetingSections: DEFAULT_MEETING_SECTIONS.map((section) => section.id === 'scorecard' ? { ...section, enabled: false } : section), escalationUserIds: ['priya-shah', 'ava-khan'] }, 'ava-khan');
  assert.equal(saved.meetingSections.find((section) => section.id === 'scorecard')?.enabled, false);
  assert.equal(saved.meetingSections.find((section) => section.id === 'ids')?.enabled, true);
  assert.deepEqual(saved.escalationUserIds, ['priya-shah', 'ava-khan']);

  const created = await repository.createTeam({ name: 'Quality Assurance', shortName: 'QA', description: 'Quality controls.', parentTeamId: 'leadership', nodeType: 'operational', meetingDay: 'Friday', meetingTime: '9:00 AM', accent: '#4c8f86', initials: 'QA', meetingSections: DEFAULT_MEETING_SECTIONS, escalationUserIds: ['ava-khan'] }, 'ava-khan');
  const workspace = await repository.getTeamWorkspace(created.teamId, 'ava-khan');
  assert.equal(workspace.meetings.length, 1);
  assert.equal(workspace.meetings[0].agendaTotal, DEFAULT_MEETING_SECTIONS.length);
});

test('an unresolved Issue is scheduled for escalation after three meetings', async () => {
  const repository = new MemoryWorkspaceRepository();
  const issue = await repository.createIssue({ teamId: 'leadership', title: 'Escalation test Issue', detail: 'This should route after three meetings.', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const state = repository as unknown as { issues: Array<{ id: string; meetingsPassed: number }>; meetings: Array<{ id: string; teamId: string; status: 'upcoming' | 'in-progress' | 'closed'; idsIssueIds: string[]; version: number }> };
  const meeting = state.meetings.find((candidate) => candidate.teamId === 'leadership')!;
  meeting.idsIssueIds = [issue.id];
  for (let count = 0; count < 3; count += 1) {
    meeting.status = 'upcoming';
    const closed = await repository.closeMeeting('leadership', meeting.id, `Meeting ${count + 1}`, 8, 'ava-khan', meeting.version);
    if (count < 2) meeting.status = 'upcoming';
    else assert.equal(closed.status, 'closed');
  }
  const storedIssue = state.issues.find((candidate) => candidate.id === issue.id)! as typeof issue;
  assert.equal(storedIssue.meetingsPassed, 3);
  assert.equal(storedIssue.escalationState, 'scheduled');
  assert.ok(storedIssue.escalationDueAt);
});
