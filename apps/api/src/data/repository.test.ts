import assert from 'node:assert/strict';
import test from 'node:test';
import type { Container } from '@azure/cosmos';
import { CosmosWorkspaceRepository, MemoryWorkspaceRepository, RepositoryError } from './repository.js';
import { DEFAULT_MEETING_SECTIONS, issueMeetingBand, meetingScheduledAt, type MeetingAiSummary, type MeetingRecord, type MeetingSkipReason, type WorkspaceRecord } from '../domain.js';
import { sanitizeTodoNotes } from '../richText.js';

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

test('administrators can edit another user without changing the stable user ID', async () => {
  const repository = new MemoryWorkspaceRepository();
  const before = await repository.getUser('marcus-lee');
  assert.ok(before);

  const updated = await repository.updateUser('marcus-lee', { name: 'Marcus Lee-Smith', email: 'marcus.smith@bremmar.com', platformAdmin: true }, 'ava-khan', before.version);
  assert.deepEqual({ id: updated.id, name: updated.name, email: updated.email, initials: updated.initials, platformCapabilities: updated.platformCapabilities, version: updated.version }, {
    id: 'marcus-lee', name: 'Marcus Lee-Smith', email: 'marcus.smith@bremmar.com', initials: 'ML', platformCapabilities: ['PlatformAdmin'], version: before.version + 1,
  });
  assert.equal((await repository.getAdminSnapshot('ava-khan')).users.find((user) => user.id === updated.id)?.email, updated.email);

  await rejectsWithCode(repository.updateUser('marcus-lee', { name: 'Stale edit' }, 'ava-khan', before.version), 'CONFLICT');
  await rejectsWithCode(repository.updateUser('marcus-lee', { email: 'ava@bremmar.com' }, 'ava-khan', updated.version), 'CONFLICT');
  await rejectsWithCode(repository.updateUser('marcus-lee', { name: 'Unauthorized edit' }, 'maya-green', updated.version), 'FORBIDDEN');
});

test('directory user edits cannot move an Entra profile to another identity', async () => {
  const repository = new MemoryWorkspaceRepository();
  const user = await repository.createUser({ name: 'Directory User', email: 'directory-user@bremmar.com', accent: '#123456', identityId: 'CA795A1D-6402-4335-9141-D40E7F078812' }, 'ava-khan');
  await rejectsWithCode(repository.updateUser(user.id, { email: 'renamed-user@bremmar.com', identityId: '7D9C5B48-7F6C-4CC5-A3D2-6D9E3E2C12C4' }, 'ava-khan', user.version), 'CONFLICT');
  const unchanged = await repository.getUser(user.id);
  assert.equal(unchanged?.email, 'directory-user@bremmar.com');
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

test('Rock Tasks can be edited and deleted while a linked To-Do remains as standalone work', async () => {
  const repository = new MemoryWorkspaceRepository();
  const task = await repository.createRockTask({ rockId: 'rock-project-kickoff', title: 'Run the pilot', assigneeId: 'marcus-lee', assignedAt: '2026-09-02', startDate: '2026-09-03', dueDate: '2026-09-10' }, 'marcus-lee');
  const edited = await repository.updateRockTask(task.id, { title: 'Run the revised pilot', notes: 'Capture the handoff feedback.', dueDate: '2026-09-12', status: 'in-progress' }, 'marcus-lee', task.version);
  const converted = await repository.convertRockTaskToTodo(edited.id, 'marcus-lee');
  const deleted = await repository.deleteRockTask(edited.id, 'marcus-lee', converted.task.version);
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');

  assert.deepEqual(deleted, { deletedTaskId: task.id, rockId: 'rock-project-kickoff', rockVersion: 2 });
  assert.equal(workspace.tasks.some((candidate) => candidate.id === task.id), false);
  const keptTodo = workspace.todos.find((todo) => todo.id === converted.todo.id);
  assert.equal(keptTodo?.linkedRockTaskId, undefined);
  assert.equal(keptTodo?.origin, 'Team workspace · former Rock Task');
  assert.equal(keptTodo?.version, converted.todo.version + 1);
});

test('solving an Issue creates an idempotent follow-up To-Do in the same team workspace', async () => {
  const repository = new MemoryWorkspaceRepository();
  await repository.solveIssue('issue-project-scope', { createFollowUpTodo: true }, 'marcus-lee');
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
  const issue = await repository.createIssueFromMessage({ messageId: sent.id, title: 'Kickoff owner needs confirmation', detail: 'Please choose the receiving owner before the customer meeting.', priority: 2, horizon: 'short-term', ownerId: 'ava-khan' }, 'ava-khan');
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
  assert.equal(workspace.meetings.length, 4);
  assert.equal(workspace.meetings[0].agendaTotal, DEFAULT_MEETING_SECTIONS.length);
});

test('team cadence is persisted and the current meeting can be moved with optimistic concurrency', async () => {
  const repository = new MemoryWorkspaceRepository();
  const created = await repository.createTeam({ name: 'Monthly Operations', shortName: 'Monthly Ops', description: 'A monthly operating team.', parentTeamId: 'leadership', nodeType: 'operational', meetingCadence: 'monthly', meetingDay: '31', meetingTime: '10:00 AM', accent: '#4c8f86', initials: 'MO', meetingSections: DEFAULT_MEETING_SECTIONS, escalationUserIds: ['ava-khan'] }, 'ava-khan');
  await repository.upsertMembership({ userId: 'ava-khan', teamId: created.teamId, role: 'TeamLead' }, 'ava-khan');
  const before = await repository.getTeamWorkspace(created.teamId, 'ava-khan');
  const meeting = before.meetings[0];
  assert.equal(before.team.meetingCadence, 'monthly');
  assert.equal(meeting.scheduledTime, '10:00 AM');
  assert.match(meeting.scheduledDate, /^\d{4}-\d{2}-\d{2}$/);

  const moved = await repository.updateMeetingSchedule(created.teamId, meeting.id, { scheduledDate: '2026-09-21', scheduledTime: '2:30 PM' }, 'ava-khan', meeting.version);
  assert.deepEqual({ scheduledDate: moved.scheduledDate, scheduledTime: moved.scheduledTime, dateLabel: moved.dateLabel, weekStartDate: moved.weekStartDate, version: moved.version }, { scheduledDate: '2026-09-21', scheduledTime: '2:30 PM', dateLabel: 'Monday · Sep 21', weekStartDate: '2026-09-21', version: (meeting.version ?? 1) + 1 });
  await rejectsWithCode(repository.updateMeetingSchedule(created.teamId, meeting.id, { scheduledDate: '2026-09-22', scheduledTime: '2:30 PM' }, 'ava-khan', meeting.version), 'CONFLICT');

  const closed = await repository.closeMeeting(created.teamId, meeting.id, 'Monthly review complete.', 9, 'ava-khan', moved.version);
  assert.equal(closed.status, 'closed');
  const after = await repository.getTeamWorkspace(created.teamId, 'ava-khan');
  assert.equal(after.meetings.some((item) => item.status === 'upcoming'), true);
  assert.equal(after.meetings.find((item) => item.status === 'upcoming')?.scheduledTime, '10:00 AM');
});

test('new-team writes fall back to ordinary Cosmos creates when transactional batches are rejected', async () => {
  const seed = new MemoryWorkspaceRepository().exportWorkspaceRecords();
  const created: WorkspaceRecord[] = [];
  let batchCalls = 0;
  const container = {
    items: {
      query: (_spec: unknown, options?: { partitionKey?: string }) => ({ fetchAll: async () => ({ resources: seed.filter((record) => !options?.partitionKey || record.pk === options.partitionKey) }) }),
      batch: async (operations: unknown[]) => { batchCalls += 1; return { result: operations.map(() => ({ statusCode: 400 })) }; },
      create: async (record: WorkspaceRecord) => { created.push(record); return { resource: { ...record, _etag: `etag-${created.length}` } }; },
    },
  } as unknown as Container;
  const repository = new CosmosWorkspaceRepository(container);

  const team = await repository.createTeam({ name: 'Batch Fallback', shortName: 'Fallback', description: 'Verifies ordinary writes remain available.', parentTeamId: 'leadership', nodeType: 'operational', meetingCadence: 'weekly', meetingDay: 'Friday', meetingTime: '9:00 AM', accent: '#4c8f86', initials: 'BF', meetingSections: DEFAULT_MEETING_SECTIONS, escalationUserIds: [] }, 'ava-khan');
  assert.equal(team.name, 'Batch Fallback');
  assert.equal(batchCalls, 2);
  assert.equal(created.some((record) => record.kind === 'team' && record.id === team.teamId), true);
  assert.equal(created.filter((record) => record.kind === 'meeting' && record.teamId === team.teamId).length, 4);
});

test('unresolved Issues use meeting health, count non-IDS Issues, and escalate once at four meetings', async () => {
  const repository = new MemoryWorkspaceRepository();
  const issue = await repository.createIssue({ teamId: 'leadership', title: 'Escalation test Issue', detail: 'This should route after four meetings.', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const nonIds = await repository.createIssue({ teamId: 'leadership', title: 'Non-IDS Issue', detail: 'This is not manually added to IDS.', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const state = repository as unknown as { issues: Array<{ id: string; createdAt: string; status: 'open' | 'in-ids' | 'solved'; meetingsPassed: number; meetingBand: string; escalationState: string; escalationDueAt?: string }>; meetings: Array<{ id: string; teamId: string; status: 'upcoming' | 'in-progress' | 'closed'; startedAt?: string; idsIssueIds: string[]; version: number }>; notifications: Array<{ type: string; issueId?: string }> };
  const issueRecord = state.issues.find((candidate) => candidate.id === issue.id)!;
  const nonIdsRecord = state.issues.find((candidate) => candidate.id === nonIds.id)!;
  const oldCreatedAt = new Date(Date.now() - 60_000).toISOString();
  issueRecord.createdAt = oldCreatedAt;
  nonIdsRecord.createdAt = oldCreatedAt;

  for (let count = 0; count < 4; count += 1) {
    const meeting = state.meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming')!;
    const started = await repository.startMeeting('leadership', meeting.id, 'ava-khan', meeting.version);
    const closed = await repository.closeMeeting('leadership', meeting.id, `Meeting ${count + 1}`, 8, 'ava-khan', started.version);
    assert.equal(closed.status, 'closed');
  }

  assert.equal(issueRecord.meetingsPassed, 4);
  assert.equal(issueRecord.meetingBand, 'red');
  assert.equal(issueRecord.escalationState, 'escalated');
  assert.equal(issueRecord.escalationDueAt, undefined);
  assert.equal(nonIdsRecord.meetingsPassed, 4);
  assert.equal(state.notifications.filter((notification) => notification.type === 'issue-escalation' && notification.issueId === issue.id).length, 1);
});

test('off-track Scorecard results convert to one provenance-linked Issue', async () => {
  const repository = new MemoryWorkspaceRepository();
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const metric = workspace.metrics.find((candidate) => candidate.id === 'metric-project-kickoffs')!;
  const result = workspace.scorecardResults.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === workspace.meetings[0].weekStartDate)!;
  const offTrack = await repository.upsertScorecardResult(metric.id, result.weekStartDate, { actual: '70%', status: 'off-track' }, 'marcus-lee', result.version);

  const first = await repository.createIssueFromScorecard(metric.id, offTrack.weekStartDate, 'marcus-lee', offTrack.version);
  const repeated = await repository.createIssueFromScorecard(metric.id, offTrack.weekStartDate, 'marcus-lee', offTrack.version);

  assert.equal(first.id, repeated.id);
  assert.equal(first.id, `issue-scorecard-${metric.id}-${offTrack.weekStartDate}`);
  assert.deepEqual({ teamId: first.teamId, ownerId: first.ownerId, linkedScorecardMetricId: first.linkedScorecardMetricId, linkedScorecardWeekStartDate: first.linkedScorecardWeekStartDate }, { teamId: 'projects', ownerId: metric.ownerId, linkedScorecardMetricId: metric.id, linkedScorecardWeekStartDate: offTrack.weekStartDate });
  assert.match(first.detail, new RegExp(offTrack.weekStartDate));
  assert.equal((await repository.getTeamWorkspace('projects', 'marcus-lee')).issues.filter((issue) => issue.linkedScorecardMetricId === metric.id && issue.linkedScorecardWeekStartDate === offTrack.weekStartDate).length, 1);
  await rejectsWithCode(repository.createIssueFromScorecard(metric.id, '2026-08-17', 'marcus-lee'), 'VALIDATION');
});

test('off-track Rocks convert to one owner- and priority-preserving Issue', async () => {
  const repository = new MemoryWorkspaceRepository();
  const first = await repository.createIssueFromRock('rock-cyber-readiness', 'priya-shah', 1);
  const repeated = await repository.createIssueFromRock('rock-cyber-readiness', 'priya-shah', 1);

  assert.equal(first.id, repeated.id);
  assert.equal(first.id, 'issue-rock-rock-cyber-readiness');
  assert.deepEqual({ teamId: first.teamId, ownerId: first.ownerId, priority: first.priority, linkedRockId: first.linkedRockId }, { teamId: 'cybersecurity', ownerId: 'priya-shah', priority: 1, linkedRockId: 'rock-cyber-readiness' });
  assert.equal((await repository.getTeamWorkspace('cybersecurity', 'priya-shah')).issues.filter((issue) => issue.linkedRockId === 'rock-cyber-readiness').length, 1);
  await rejectsWithCode(repository.createIssueFromRock('rock-project-kickoff', 'marcus-lee', 1), 'VALIDATION');
});

test('meeting section notes and IDS ordering are versioned, auditable, and closed meetings are immutable', async () => {
  const repository = new MemoryWorkspaceRepository();
  const firstIssue = await repository.createIssue({ teamId: 'leadership', title: 'First decision', raisedById: 'ava-khan', ownerId: 'ava-khan', priority: 2 }, 'ava-khan');
  const secondIssue = await repository.createIssue({ teamId: 'leadership', title: 'Second decision', raisedById: 'ava-khan', ownerId: 'ava-khan', priority: 5 }, 'ava-khan');
  await repository.startIssue(firstIssue.id, 'ava-khan', firstIssue.version);
  await repository.startIssue(secondIssue.id, 'ava-khan', secondIssue.version);
  let workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  let meeting = workspace.meetings[0];

  meeting = await repository.updateMeetingSectionNote('leadership', meeting.id, 'scorecard', 'The facilitator captured the weekly variance.', 'ava-khan', meeting.version);
  meeting = await repository.updateMeetingSectionNote('leadership', meeting.id, 'headlines', 'A customer renewal needs an owner before Friday.', 'ava-khan', meeting.version);
  assert.deepEqual(meeting.sectionNotes, { scorecard: 'The facilitator captured the weekly variance.', headlines: 'A customer renewal needs an owner before Friday.' });
  await rejectsWithCode(repository.updateMeetingSectionNote('leadership', meeting.id, 'scorecard', 'Stale note', 'ava-khan', meeting.version - 1), 'CONFLICT');

  const reordered = await repository.reorderMeetingIssues('leadership', meeting.id, [secondIssue.id, firstIssue.id], 'ava-khan', meeting.version);
  assert.deepEqual(reordered.idsIssueIds, [secondIssue.id, firstIssue.id]);
  assert.deepEqual({ firstPriority: (await repository.getIssue(firstIssue.id, 'ava-khan')).priority, secondPriority: (await repository.getIssue(secondIssue.id, 'ava-khan')).priority }, { firstPriority: 2, secondPriority: 5 });
  await rejectsWithCode(repository.reorderMeetingIssues('leadership', meeting.id, [firstIssue.id, secondIssue.id], 'ava-khan', meeting.version), 'CONFLICT');

  const closed = await repository.closeMeeting('leadership', meeting.id, 'Two decisions recorded.', 9, 'ava-khan', reordered.version);
  assert.deepEqual(closed.actionSummary, { todosCreated: 0, issuesReviewedInIds: 2, issuesAddedToIds: 2, issuesSolved: 0 });
  assert.match(closed.recap, /Actions: 0 To-Dos created · 2 Issues reviewed in IDS · 2 Issues added to IDS · 0 Issues solved\./);
  const nextMeeting = (await repository.getTeamWorkspace('leadership', 'ava-khan')).meetings.find((candidate) => candidate.status === 'upcoming')!;
  assert.deepEqual(nextMeeting.idsIssueIds, [secondIssue.id, firstIssue.id]);
  assert.deepEqual(nextMeeting.idsAddedIssueIds, []);
  await rejectsWithCode(repository.updateMeetingSectionNote('leadership', closed.id, 'scorecard', 'Too late', 'ava-khan', closed.version), 'CONFLICT');
});

test('meeting action summary counts solved Issues and their follow-up To-Do', async () => {
  const repository = new MemoryWorkspaceRepository();
  const issue = await repository.createIssue({ teamId: 'leadership', title: 'Decision to solve', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  await repository.startIssue(issue.id, 'ava-khan', issue.version);
  const workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const closed = await repository.closeMeeting('leadership', workspace.meetings[0].id, 'Solved during IDS.', 10, 'ava-khan', workspace.meetings[0].version);
  assert.deepEqual(closed.actionSummary, { todosCreated: 0, issuesReviewedInIds: 1, issuesAddedToIds: 1, issuesSolved: 0 });

  const repositoryWithSolve = new MemoryWorkspaceRepository();
  const solveIssue = await repositoryWithSolve.createIssue({ teamId: 'leadership', title: 'Solved decision', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const startedIssue = await repositoryWithSolve.startIssue(solveIssue.id, 'ava-khan', solveIssue.version);
  await repositoryWithSolve.solveIssue(solveIssue.id, { createFollowUpTodo: true }, 'ava-khan', startedIssue.version);
  const beforeClose = await repositoryWithSolve.getTeamWorkspace('leadership', 'ava-khan');
  const solvedMeeting = await repositoryWithSolve.closeMeeting('leadership', beforeClose.meetings[0].id, 'Solved and followed up.', 10, 'ava-khan', beforeClose.meetings[0].version);
  assert.deepEqual(solvedMeeting.actionSummary, { todosCreated: 1, issuesReviewedInIds: 1, issuesAddedToIds: 1, issuesSolved: 1 });
  assert.match(solvedMeeting.recap, /Created To-Dos: Follow up on the solution: Solved decision/);
});

test('embedded To-Do checklists default to the owner, validate Supporters, and use parent versions', async () => {
  const repository = new MemoryWorkspaceRepository();
  const before = (await repository.getTeamWorkspace('projects', 'marcus-lee')).todos.find((todo) => todo.id === 'todo-project-kickoff')!;
  const added = await repository.addTodoChecklistItem(before.id, 'Confirm the handoff owner', undefined, 'marcus-lee', before.version);
  assert.deepEqual(added.checklist[0], { ...added.checklist[0], text: 'Confirm the handoff owner', completed: false, supporterId: 'marcus-lee' });
  assert.equal(added.version, before.version + 1);

  const completed = await repository.updateTodoChecklistItem(before.id, added.checklist[0].id, { completed: true }, 'marcus-lee', added.version);
  assert.equal(completed.checklist[0].completed, true);
  assert.equal(completed.status, before.status);
  const assigned = await repository.updateTodoChecklistItem(before.id, added.checklist[0].id, { supporterId: 'maya-green' }, 'marcus-lee', completed.version);
  assert.equal(assigned.checklist[0].supporterId, 'maya-green');
  await rejectsWithCode(repository.updateTodoChecklistItem(before.id, added.checklist[0].id, { supporterId: 'priya-shah' }, 'marcus-lee', assigned.version), 'VALIDATION');
  await rejectsWithCode(repository.deleteTodoChecklistItem(before.id, added.checklist[0].id, 'marcus-lee', assigned.version - 1), 'CONFLICT');
  const deleted = await repository.deleteTodoChecklistItem(before.id, added.checklist[0].id, 'marcus-lee', assigned.version);
  assert.equal(deleted.checklist.length, 0);
});

test('To-Do notes accept the small rich-text subset and safely convert legacy text', async () => {
  const repository = new MemoryWorkspaceRepository();
  const todo = await repository.createTodo({ teamId: 'projects', title: 'Rich notes', ownerId: 'marcus-lee', dueDate: ' 2026-09-10 ', notes: '<p><strong>Owner</strong></p><script>alert(1)</script><a href="javascript:bad">unsafe</a>' }, 'marcus-lee');
  assert.match(todo.notes, /<strong>Owner<\/strong>/);
  assert.doesNotMatch(todo.notes, /script|javascript|<a/i);
  const legacy = await repository.updateTodo(todo.id, { notes: 'First line\nSecond line' }, 'marcus-lee', todo.version);
  assert.equal(legacy.notes, '<p>First line<br />Second line</p>');
  assert.equal(todo.dueDate, '2026-09-10');
  assert.doesNotMatch(sanitizeTodoNotes('<p>ok</p><img src=x onerror=alert(1)>'), /img|onerror/i);
});

test('Rock Notes and Issue Original Context use the same safe rich-text subset', async () => {
  const repository = new MemoryWorkspaceRepository();
  const rock = await repository.createRock({ teamId: 'projects', title: 'Rich Rock', ownerId: 'marcus-lee', notes: '<p><strong>Outcome</strong></p><script>alert(1)</script><a href="javascript:bad">unsafe</a>' }, 'marcus-lee');
  assert.match(rock.notes, /<strong>Outcome<\/strong>/);
  assert.doesNotMatch(rock.notes, /script|javascript|<a/i);

  const updatedRock = await repository.updateRock(rock.id, { notes: '<p><em>Next step</em></p><img src=x onerror=alert(1)>' }, 'marcus-lee', rock.version);
  assert.match(updatedRock.notes, /<em>Next step<\/em>/);
  assert.doesNotMatch(updatedRock.notes, /img|onerror/i);

  const issue = await repository.createIssue({ teamId: 'projects', title: 'Rich Issue', detail: '<p><strong>Context</strong></p><script>alert(1)</script><a href="javascript:bad">unsafe</a>', raisedById: 'marcus-lee', ownerId: 'marcus-lee' }, 'marcus-lee');
  assert.match(issue.detail, /<strong>Context<\/strong>/);
  assert.doesNotMatch(issue.detail, /script|javascript|<a/i);

  const updatedIssue = await repository.updateIssue(issue.id, { detail: '<p><em>Decision needed</em></p><img src=x onerror=alert(1)>' }, 'marcus-lee', issue.version);
  assert.match(updatedIssue.detail, /<em>Decision needed<\/em>/);
  assert.doesNotMatch(updatedIssue.detail, /img|onerror/i);
});

test('Issue resolution records the follow-up choice, source link, and idempotent history', async () => {
  const repository = new MemoryWorkspaceRepository();
  const noTodo = await repository.getIssue('issue-project-scope', 'marcus-lee');
  const solvedWithoutTodo = await repository.solveIssue(noTodo.id, { createFollowUpTodo: false, resolutionNote: 'Closed in the customer review; no commitment required.' }, 'marcus-lee', noTodo.version);
  assert.equal(solvedWithoutTodo.status, 'solved');
  assert.match(solvedWithoutTodo.idsNote ?? '', /Follow-up To-Do not created/);
  assert.match(solvedWithoutTodo.idsNote ?? '', /no commitment required/);
  const repeated = await repository.solveIssue(noTodo.id, { createFollowUpTodo: true, resolutionNote: 'Must not be appended twice.' }, 'marcus-lee', noTodo.version);
  assert.equal(repeated.version, solvedWithoutTodo.version);
  assert.doesNotMatch(repeated.idsNote ?? '', /Must not be appended twice/);

  const withTodo = await repository.getIssue('issue-cyber-owners', 'priya-shah');
  const solvedWithTodo = await repository.solveIssue(withTodo.id, { createFollowUpTodo: true }, 'priya-shah', withTodo.version);
  const workspace = await repository.getTeamWorkspace('cybersecurity', 'priya-shah');
  const followUp = workspace.todos.find((todo) => todo.sourceIssueId === withTodo.id);
  assert.equal(followUp?.ownerId, 'priya-shah');
  assert.equal(solvedWithTodo.status, 'solved');
  assert.match(solvedWithTodo.idsNote ?? '', /Follow-up To-Do created/);
});

test('Issue meeting health bands and close-time boundaries are based on total meetings', async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((count) => issueMeetingBand(count, 'open')), ['neutral', 'green', 'yellow', 'orange', 'red', 'red']);
  assert.equal(issueMeetingBand(4, 'solved'), 'neutral');

  const repository = new MemoryWorkspaceRepository();
  const preExisting = await repository.createIssue({ teamId: 'leadership', title: 'Pre-existing outside IDS', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const solvedDuring = await repository.createIssue({ teamId: 'leadership', title: 'Solved during meeting', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const state = repository as unknown as { issues: Array<{ id: string; createdAt: string; meetingsPassed: number; status: 'open' | 'in-ids' | 'solved'; version: number }>; meetings: Array<{ id: string; teamId: string; status: 'upcoming' | 'in-progress' | 'closed'; version: number }> };
  const meeting = state.meetings.find((candidate) => candidate.teamId === 'leadership')!;
  const old = new Date(Date.now() - 60_000).toISOString();
  state.issues.find((issue) => issue.id === preExisting.id)!.createdAt = old;
  state.issues.find((issue) => issue.id === solvedDuring.id)!.createdAt = old;
  const started = await repository.startMeeting('leadership', meeting.id, 'ava-khan', meeting.version);
  const createdDuring = await repository.createIssue({ teamId: 'leadership', title: 'Created during meeting', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
  const createdRecord = state.issues.find((issue) => issue.id === createdDuring.id)!;
  createdRecord.createdAt = new Date(new Date(started.startedAt!).getTime() + 1_000).toISOString();
  await repository.solveIssue(solvedDuring.id, { createFollowUpTodo: false }, 'ava-khan', state.issues.find((issue) => issue.id === solvedDuring.id)!.version);
  await repository.closeMeeting('leadership', meeting.id, 'Boundary test.', 8, 'ava-khan', state.meetings.find((candidate) => candidate.id === meeting.id)!.version);

  assert.equal(state.issues.find((issue) => issue.id === preExisting.id)!.meetingsPassed, 1);
  assert.equal(state.issues.find((issue) => issue.id === solvedDuring.id)!.meetingsPassed, 0);
  assert.equal(state.issues.find((issue) => issue.id === createdDuring.id)!.meetingsPassed, 0);
});

test('meeting history allows descendant review while keeping descendant records read-only', async () => {
  const repository = new MemoryWorkspaceRepository();
  await repository.upsertMembership({ userId: 'marcus-lee', teamId: 'professional-services', role: 'TeamLead' }, 'ava-khan');

  const parentReview = await repository.getMeetingReview('marcus-lee', { filter: 'all' });
  assert.equal(parentReview.items.some((item) => item.team.teamId === 'professional-services'), true);
  assert.equal(parentReview.items.some((item) => item.team.teamId === 'projects'), true);
  assert.equal(parentReview.items.some((item) => item.team.teamId === 'cybersecurity'), true);
  assert.equal(parentReview.items.some((item) => item.team.teamId === 'leadership'), false);

  const childMeeting = parentReview.items.find((item) => item.team.teamId === 'cybersecurity')!.meeting;
  assert.equal((await repository.getMeeting('cybersecurity', childMeeting.id, 'marcus-lee')).id, childMeeting.id);
  await rejectsWithCode(repository.startMeeting('cybersecurity', childMeeting.id, 'marcus-lee', childMeeting.version), 'FORBIDDEN');
  await rejectsWithCode(repository.updateMeetingSchedule('cybersecurity', childMeeting.id, { scheduledDate: '2099-01-05', scheduledTime: '2:30 PM' }, 'marcus-lee', childMeeting.version), 'FORBIDDEN');
  await rejectsWithCode(repository.skipMeeting('cybersecurity', childMeeting.id, 'other', 'Parent review only.', 'marcus-lee', childMeeting.version), 'FORBIDDEN');

  const leadershipReview = await repository.getMeetingReview('ava-khan', { filter: 'all' });
  assert.equal(new Set(leadershipReview.items.map((item) => item.team.teamId)).size, 7);
});

test('meeting occurrences record immutable starts, skip reasons, audit events, and a four-item cadence window', async () => {
  const repository = new MemoryWorkspaceRepository();
  let workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const upcoming = () => workspace.meetings.filter((meeting) => meeting.status === 'upcoming' && meetingScheduledAt(meeting) >= Date.now()).sort((left, right) => `${left.scheduledDate}T${left.scheduledTime}`.localeCompare(`${right.scheduledDate}T${right.scheduledTime}`));
  assert.equal(upcoming().length, 4);

  const first = upcoming()[0];
  const started = await repository.startMeeting('leadership', first.id, 'ava-khan', first.version);
  assert.equal(started.status, 'in-progress');
  assert.match(started.startedAt ?? '', /T/);
  const resumed = await repository.startMeeting('leadership', first.id, 'ava-khan', first.version);
  assert.equal(resumed.startedAt, started.startedAt);
  assert.equal(resumed.version, started.version);
  const closed = await repository.closeMeeting('leadership', first.id, 'The team left with clear owners.', 8, 'ava-khan', resumed.version);
  assert.equal(closed.status, 'closed');
  workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  assert.equal(upcoming().length, 4);
  assert.equal(workspace.meetings.some((meeting) => meeting.id === first.id && meeting.status === 'closed'), true);

  const skippedCandidate = upcoming()[0];
  await rejectsWithCode(repository.skipMeeting('leadership', skippedCandidate.id, 'invalid' as unknown as MeetingSkipReason, '', 'ava-khan', skippedCandidate.version), 'VALIDATION');
  const skipped = await repository.skipMeeting('leadership', skippedCandidate.id, 'public-holiday', 'Office closed for the bank holiday.', 'ava-khan', skippedCandidate.version);
  assert.deepEqual({ status: skipped.status, skipReason: skipped.skipReason, skipNote: skipped.skipNote, skippedById: skipped.skippedById }, { status: 'skipped', skipReason: 'public-holiday', skipNote: 'Office closed for the bank holiday.', skippedById: 'ava-khan' });
  workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  assert.equal(upcoming().length, 4);
  assert.equal((await repository.getMeetingReview('ava-khan', { filter: 'skipped' })).items.some((item) => item.meeting.id === skipped.id), true);
  assert.equal(repository.exportWorkspaceRecords().some((record) => record.kind === 'auditEvent' && 'target' in record && record.target === skipped.id && 'action' in record && record.action === 'Skipped L10 meeting'), true);
  assert.equal((await repository.getMeetingSummaryJob('leadership', skipped.id, 'ava-khan')), null);
  assert.equal((await repository.getMeetingReview('ava-khan', { status: 'skipped', teamId: 'leadership' })).items.some((item) => item.meeting.id === skipped.id), true);
});

test('L10 starts store the facilitator, record section and overall timing, and retain attendee ratings', async () => {
  const repository = new MemoryWorkspaceRepository();
  await repository.upsertMembership({ userId: 'marcus-lee', teamId: 'leadership', role: 'Member' }, 'ava-khan');
  let workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const meeting = workspace.meetings.find((candidate) => candidate.status === 'upcoming')!;
  const started = await repository.startMeeting('leadership', meeting.id, 'ava-khan', meeting.version, 'marcus-lee');
  assert.equal(started.facilitatorId, 'marcus-lee');
  assert.equal(started.attendeeIds.includes('marcus-lee'), true);

  const state = repository as unknown as { meetings: MeetingRecord[] };
  const stored = state.meetings.find((candidate) => candidate.id === meeting.id)!;
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  stored.startedAt = startedAt;
  stored.activeSectionStartedAt = startedAt;
  const transitioned = await repository.transitionMeetingSection('leadership', meeting.id, 'segue', 'scorecard', 'ava-khan', started.version);
  stored.activeSectionStartedAt = new Date(Date.now() - 90_000).toISOString();
  const ratings = transitioned.attendeeIds.map((attendeeId) => ({ attendeeId, rating: 9 }));

  const closed = await repository.closeMeeting('leadership', meeting.id, 'The team left with clear owners.', 8, 'ava-khan', transitioned.version, ratings);
  assert.equal((closed.durationSeconds ?? 0) >= 110, true);
  assert.equal((closed.sectionDurations?.segue ?? 0) >= 110, true);
  assert.equal((closed.sectionDurations?.scorecard ?? 0) >= 80, true);
  assert.deepEqual(closed.attendeeRatings, ratings);
  assert.match(closed.recap, /Facilitator ID: marcus-lee/);

  workspace = await repository.getTeamWorkspace('leadership', 'marcus-lee');
  const job = await repository.getMeetingSummaryJob('leadership', meeting.id, 'marcus-lee');
  assert.equal(job?.contextSnapshot.facilitatorId, 'marcus-lee');
  assert.deepEqual(job?.contextSnapshot.attendeeRatings, ratings);
  assert.equal(workspace.meetings.find((candidate) => candidate.id === meeting.id)?.status, 'closed');
});

test('TeamLeads can change an in-progress facilitator while Members cannot', async () => {
  const repository = new MemoryWorkspaceRepository();
  await repository.upsertMembership({ userId: 'marcus-lee', teamId: 'leadership', role: 'Member' }, 'ava-khan');
  const workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const meeting = workspace.meetings.find((candidate) => candidate.status === 'upcoming')!;
  const started = await repository.startMeeting('leadership', meeting.id, 'ava-khan', meeting.version, 'marcus-lee');
  const changed = await repository.startMeeting('leadership', meeting.id, 'ava-khan', started.version, 'ava-khan');

  assert.equal(changed.facilitatorId, 'ava-khan');
  assert.equal(changed.attendeeIds.includes('ava-khan'), true);
  await rejectsWithCode(repository.startMeeting('leadership', meeting.id, 'marcus-lee', changed.version, 'marcus-lee'), 'FORBIDDEN');
});

test('IDS selection is capped at five and parked Issues carry into the next meeting', async () => {
  const repository = new MemoryWorkspaceRepository();
  const createdIds: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const issue = await repository.createIssue({ teamId: 'leadership', title: `Selection test ${index}`, detail: 'Keep the IDS selection focused.', raisedById: 'ava-khan', ownerId: 'ava-khan' }, 'ava-khan');
    createdIds.push(issue.id);
  }
  let workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const meeting = workspace.meetings.find((candidate) => candidate.status === 'upcoming')!;
  await rejectsWithCode(repository.setMeetingIssueSelection('leadership', meeting.id, createdIds, 'ava-khan', meeting.version), 'VALIDATION');
  await repository.setMeetingIssueSelection('leadership', meeting.id, createdIds.slice(0, 2), 'ava-khan', meeting.version);
  const selected = (await repository.getTeamWorkspace('leadership', 'ava-khan')).issues.find((issue) => issue.id === createdIds[0])!;
  const parked = await repository.parkIssue(selected.id, 'ava-khan', selected.version);
  assert.equal(parked.status, 'parked');
  assert.match(parked.idsNote ?? '', /Parked for a future IDS conversation/);

  const afterPark = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const current = afterPark.meetings.find((candidate) => candidate.id === meeting.id)!;
  await repository.closeMeeting('leadership', meeting.id, 'Parked for the next L10.', 8, 'ava-khan', current.version);
  workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const nextMeeting = workspace.meetings.find((candidate) => candidate.status === 'upcoming');
  assert.equal(nextMeeting?.idsIssueIds.includes(selected.id), true);
});

test('one-off meeting rescheduling preserves the nominal cadence and checks future conflicts', async () => {
  const repository = new MemoryWorkspaceRepository();
  const workspace = await repository.getTeamWorkspace('leadership', 'ava-khan');
  const meetings = workspace.meetings.filter((meeting) => meeting.status === 'upcoming').sort((left, right) => `${left.scheduledDate}T${left.scheduledTime}`.localeCompare(`${right.scheduledDate}T${right.scheduledTime}`));
  const first = meetings[0];
  const second = meetings[1];
  const nominalDate = first.recurrenceDate;
  const moved = await repository.updateMeetingSchedule('leadership', first.id, { scheduledDate: '2099-01-05', scheduledTime: '2:30 PM' }, 'ava-khan', first.version);
  assert.deepEqual({ scheduledDate: moved.scheduledDate, scheduledTime: moved.scheduledTime, recurrenceDate: moved.recurrenceDate }, { scheduledDate: '2099-01-05', scheduledTime: '2:30 PM', recurrenceDate: nominalDate });
  await rejectsWithCode(repository.updateMeetingSchedule('leadership', second.id, { scheduledDate: moved.scheduledDate, scheduledTime: moved.scheduledTime }, 'ava-khan', second.version), 'CONFLICT');
  await rejectsWithCode(repository.updateMeetingSchedule('leadership', first.id, { scheduledDate: '2000-01-05', scheduledTime: '2:30 PM' }, 'ava-khan', moved.version), 'VALIDATION');
});

test('meeting close snapshots context and moves AI summaries through queued, generating, ready, and replay-safe states', async () => {
  const repository = new MemoryWorkspaceRepository();
  const before = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const started = await repository.startMeeting('projects', before.meetings[0].id, 'marcus-lee', before.meetings[0].version);
  const closed = await repository.closeMeeting('projects', started.id, 'The implementation owner is confirmed.', 9, 'marcus-lee', started.version);
  assert.equal(closed.aiSummaryStatus, 'queued');
  assert.equal(closed.aiSummarySource, 'close');
  const queuedJob = await repository.getMeetingSummaryJob('projects', closed.id, 'marcus-lee');
  assert.equal(queuedJob?.status, 'queued');
  assert.equal(queuedJob?.attempt, 1);
  assert.equal(queuedJob?.pk, 'team:projects');
  assert.equal(queuedJob?.contextSnapshot.closedAt, closed.closedAt);
  assert.equal(queuedJob?.contextSnapshot.recap, closed.recap);

  const state = repository as unknown as { rocks: Array<{ id: string; title: string }>; summaryJobs: Array<{ id: string; contextSnapshot: { rocks: Array<{ id: string; title: string }> } }> };
  const snapshotTitle = queuedJob?.contextSnapshot.rocks[0]?.title;
  if (state.rocks[0]) state.rocks[0].title = 'Changed after close';
  assert.equal(state.summaryJobs.find((job) => job.id === queuedJob?.id)?.contextSnapshot.rocks[0]?.title, snapshotTitle);

  const generating = await repository.updateMeetingSummaryDispatch(queuedJob!.id, 'generating', undefined, 'ai-worker');
  assert.equal(generating.status, 'generating');
  assert.equal((await repository.getMeeting('projects', closed.id, 'marcus-lee')).aiSummaryStatus, 'generating');
  const summary: MeetingAiSummary = { executiveSummary: 'The team aligned delivery ownership and the next customer milestone.', decisions: ['Keep one accountable owner for each implementation handoff.'], commitments: ['Publish the revised kickoff checklist.'], risks: ['The next milestone depends on security review timing.'], nextFocus: ['Review the first pilot outcome next week.'], generatedAt: new Date().toISOString(), source: 'close' };
  const ready = await repository.completeMeetingSummary(queuedJob!.id, 'ready', summary, undefined, 1);
  assert.equal(ready.aiSummaryStatus, 'ready');
  assert.equal(ready.aiSummary?.executiveSummary, summary.executiveSummary);
  assert.deepEqual(ready.aiSummary?.decisions, summary.decisions);
  await rejectsWithCode(repository.completeMeetingSummary(queuedJob!.id, 'ready', summary, undefined, 1), 'CONFLICT');

  const regenerated = await repository.requestMeetingSummary('projects', closed.id, 'marcus-lee', ready.version);
  const regeneratedJob = await repository.getMeetingSummaryJob('projects', closed.id, 'marcus-lee');
  assert.equal(regenerated.aiSummaryStatus, 'queued');
  assert.equal(regenerated.version, ready.version + 1);
  assert.deepEqual({ source: regeneratedJob?.source, attempt: regeneratedJob?.attempt, status: regeneratedJob?.status }, { source: 'close', attempt: 2, status: 'queued' });
});

test('summary retry and regeneration require a direct editor, while legacy meetings can be generated from persisted data', async () => {
  const repository = new MemoryWorkspaceRepository();
  const cyber = await repository.getTeamWorkspace('cybersecurity', 'priya-shah');
  const started = await repository.startMeeting('cybersecurity', cyber.meetings[0].id, 'priya-shah', cyber.meetings[0].version);
  const closed = await repository.closeMeeting('cybersecurity', started.id, 'Security ownership was clarified.', 8, 'priya-shah', started.version);
  const job = await repository.getMeetingSummaryJob('cybersecurity', closed.id, 'priya-shah');
  await repository.completeMeetingSummary(job!.id, 'failed', undefined, 'Worker timeout.', 1);
  const failed = await repository.getMeeting('cybersecurity', closed.id, 'priya-shah');
  assert.equal(failed.aiSummaryStatus, 'failed');
  await rejectsWithCode(repository.requestMeetingSummary('cybersecurity', closed.id, 'ava-khan', failed.version), 'FORBIDDEN');
  const retried = await repository.requestMeetingSummary('cybersecurity', closed.id, 'priya-shah', failed.version);
  const retriedJob = await repository.getMeetingSummaryJob('cybersecurity', closed.id, 'priya-shah');
  assert.equal(retried.aiSummaryStatus, 'queued');
  assert.deepEqual({ source: retriedJob?.source, attempt: retriedJob?.attempt, status: retriedJob?.status }, { source: 'close', attempt: 2, status: 'queued' });

  const legacyRepository = new MemoryWorkspaceRepository();
  const legacyWorkspace = await legacyRepository.getTeamWorkspace('projects', 'marcus-lee');
  const legacyStarted = await legacyRepository.startMeeting('projects', legacyWorkspace.meetings[0].id, 'marcus-lee', legacyWorkspace.meetings[0].version);
  const legacyClosed = await legacyRepository.closeMeeting('projects', legacyStarted.id, 'Legacy record retained for review.', 7, 'marcus-lee', legacyStarted.version);
  const legacyState = legacyRepository as unknown as { meetings: Array<{ id: string; aiSummaryStatus?: string; aiSummary?: unknown; aiSummaryRequestedAt?: string; aiSummarySource?: string; aiSummaryJobId?: string }>; summaryJobs: unknown[] };
  const legacyMeeting = legacyState.meetings.find((meeting) => meeting.id === legacyClosed.id)!;
  Object.assign(legacyMeeting, { aiSummaryStatus: undefined, aiSummary: undefined, aiSummaryRequestedAt: undefined, aiSummarySource: undefined, aiSummaryJobId: undefined });
  legacyState.summaryJobs.length = 0;
  const generatedLegacy = await legacyRepository.requestMeetingSummary('projects', legacyClosed.id, 'marcus-lee', legacyClosed.version);
  const legacyJob = await legacyRepository.getMeetingSummaryJob('projects', legacyClosed.id, 'marcus-lee');
  assert.equal(generatedLegacy.aiSummarySource, 'legacy');
  assert.equal(legacyJob?.source, 'legacy');
  assert.equal(legacyJob?.contextSnapshot.recap, legacyClosed.recap);
});

test('stuck meeting summary attempts can be cancelled and resubmitted', async () => {
  const repository = new MemoryWorkspaceRepository();
  const workspace = await repository.getTeamWorkspace('projects', 'marcus-lee');
  const started = await repository.startMeeting('projects', workspace.meetings[0].id, 'marcus-lee', workspace.meetings[0].version);
  const closed = await repository.closeMeeting('projects', started.id, 'The AI worker needs another attempt.', 8, 'marcus-lee', started.version);
  const initialJob = await repository.getMeetingSummaryJob('projects', closed.id, 'marcus-lee');
  await repository.updateMeetingSummaryDispatch(initialJob!.id, 'generating', undefined, 'ai-worker');
  const generating = await repository.getMeeting('projects', closed.id, 'marcus-lee');
  const cancelled = await repository.cancelMeetingSummary('projects', closed.id, 'marcus-lee', generating.version);
  const cancelledJob = await repository.getMeetingSummaryJob('projects', closed.id, 'marcus-lee');
  assert.equal(cancelled.aiSummaryStatus, 'cancelled');
  assert.equal(cancelled.aiSummaryError, 'AI recap generation was cancelled by the meeting editor.');
  assert.deepEqual({ status: cancelledJob?.status, lastError: cancelledJob?.lastError }, { status: 'cancelled', lastError: cancelled.aiSummaryError });
  await rejectsWithCode(repository.completeMeetingSummary(initialJob!.id, 'failed', undefined, 'Late worker callback.', 1), 'CONFLICT');

  const resubmitted = await repository.requestMeetingSummary('projects', closed.id, 'marcus-lee', cancelled.version);
  const resubmittedJob = await repository.getMeetingSummaryJob('projects', closed.id, 'marcus-lee');
  assert.equal(resubmitted.aiSummaryStatus, 'queued');
  assert.deepEqual({ status: resubmittedJob?.status, attempt: resubmittedJob?.attempt }, { status: 'queued', attempt: 2 });
});
