import { describe, expect, it, vi } from 'vitest';
import { ageBandFor, HttpWorkspaceApi, LocalWorkspaceApi } from './api';
import { initialWorkspace } from './data';
import { defaultMeetingSections } from './types';
import type { TeamMessage, TeamMembership, Workspace } from './types';
import { sanitizeTodoNotes } from './richText';
import { pendingTeamMessagesFor } from './App';

describe('LocalWorkspaceApi', () => {
  it('starts in Live, hides Test without a grant, and isolates granted Test changes', async () => {
    const api = new LocalWorkspaceApi(initialWorkspace, { testAccessUserIds: [] });
    const initialSession = await api.getEnvironmentSession();
    expect(initialSession.currentEnvironment).toBe('live');
    expect(initialSession.availableEnvironments.map((environment) => environment.id)).toEqual(['live']);
    await expect(api.selectEnvironment('test')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await api.updateEnvironmentAccess('ava-khan', true);
    expect((await api.getEnvironmentSession()).canSwitchToTest).toBe(true);
    await api.selectEnvironment('test');
    const testWorkspace = await api.addIssue({ title: 'Test-only issue', detail: 'This belongs only to the Test database.', teamId: 'leadership', raisedById: 'ava-khan' });
    expect(testWorkspace.environment).toBe('test');
    expect(testWorkspace.issues.some((issue) => issue.title === 'Test-only issue')).toBe(true);

    await api.selectEnvironment('live');
    const liveWorkspace = await api.getWorkspace();
    expect(liveWorkspace.environment).toBe('live');
    expect(liveWorkspace.issues.some((issue) => issue.title === 'Test-only issue')).toBe(false);
  });

  it('revokes Test access for subsequent local requests', async () => {
    const api = new LocalWorkspaceApi();
    await api.selectEnvironment('test');
    await api.selectEnvironment('live');
    await api.updateEnvironmentAccess('ava-khan', false);
    expect((await api.getEnvironmentSession()).availableEnvironments.map((environment) => environment.id)).toEqual(['live']);
    await expect(api.selectEnvironment('test')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updates a linked To-Do and synchronizes its Rock Task', async () => {
    const api = new LocalWorkspaceApi();
    const before = await api.getWorkspace();
    const after = await api.updateTodoStatus('todo-brief', 'done');

    expect(after.todos.find((todo) => todo.id === 'todo-brief')?.status).toBe('done');
    const beforeTask = before.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === 'task-playbook-outline');
    const afterTask = after.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === 'task-playbook-outline');
    expect(afterTask?.status).toBe('done');
    expect(afterTask?.version).toBe((beforeTask?.version ?? 0) + 1);
    expect(after.rocks.find((rock) => rock.id === 'rock-playbook')?.version).toBe(4);
  });

  it('solving an Issue creates one accountable follow-up To-Do', async () => {
    const api = new LocalWorkspaceApi();
    const first = await api.solveIssue('issue-handoffs', { createFollowUpTodo: true });
    const second = await api.solveIssue('issue-handoffs', { createFollowUpTodo: true });

    expect(first.issues.find((issue) => issue.id === 'issue-handoffs')?.status).toBe('solved');
    expect(first.todos.filter((todo) => todo.id === 'todo-follow-up-issue-handoffs')).toHaveLength(1);
    expect(second.todos.filter((todo) => todo.id === 'todo-follow-up-issue-handoffs')).toHaveLength(1);
  });

  it('adds new records to the selected team', async () => {
    const api = new LocalWorkspaceApi();
    const workspace = await api.addIssue({
      title: 'The weekly agenda needs one owner',
      detail: 'Capture the decision before the meeting starts.',
      teamId: 'leadership',
      raisedById: 'ava-khan',
    });

    expect(workspace.issues[0]).toMatchObject({
      title: 'The weekly agenda needs one owner',
      teamId: 'leadership',
      status: 'open',
    });
  });

  it('supports monthly team cadence and reschedules the current meeting occurrence', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.createTeam({ name: 'Monthly Operations', shortName: 'Monthly Ops', description: 'A monthly operating team.', parentTeamId: 'leadership', nodeType: 'operational', meetingCadence: 'monthly', meetingDay: '31', meetingTime: '10:00 AM', accent: '#4c8f86', initials: 'MO' });
    const team = workspace.teams.find((candidate) => candidate.id === 'monthly-operations')!;
    workspace = await api.upsertMembership({ userId: 'ava-khan', teamId: team.id, role: 'TeamLead' });
    let meeting = workspace.meetings.find((candidate) => candidate.teamId === team.id)!;
    expect(team.meetingCadence).toBe('monthly');
    expect(meeting.scheduledTime).toBe('10:00 AM');

    workspace = await api.updateMeetingSchedule(team.id, meeting.id, { scheduledDate: '2026-09-21', scheduledTime: '2:30 PM' }, meeting.version);
    meeting = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(meeting).toMatchObject({ scheduledDate: '2026-09-21', scheduledTime: '2:30 PM', dateLabel: 'Monday · Sep 21', weekStartDate: '2026-09-21' });
    await expect(api.updateMeetingSchedule(team.id, meeting.id, { scheduledDate: '2026-09-22', scheduledTime: '2:30 PM' }, (meeting.version ?? 1) - 1)).rejects.toMatchObject({ code: 'CONFLICT' });

    workspace = await api.closeMeeting(team.id, 'Monthly review complete.', 9);
    expect(workspace.meetings.filter((candidate) => candidate.teamId === team.id && candidate.status === 'upcoming')).toHaveLength(4);
    expect(workspace.meetings.find((candidate) => candidate.teamId === team.id && candidate.status === 'upcoming')?.scheduledTime).toBe('10:00 AM');
  });

  it('uses the configured age bands and preserves age after rejection', async () => {
    expect(ageBandFor(6, { agingDays: 7, staleDays: 14, criticalDays: 30 })).toBe('fresh');
    expect(ageBandFor(7, { agingDays: 7, staleDays: 14, criticalDays: 30 })).toBe('aging');
    expect(ageBandFor(14, { agingDays: 7, staleDays: 14, criticalDays: 30 })).toBe('stale');
    expect(ageBandFor(30, { agingDays: 7, staleDays: 14, criticalDays: 30 })).toBe('critical');

    const api = new LocalWorkspaceApi();
    const before = await api.getWorkspace();
    const beforeIssue = before.issues.find((issue) => issue.id === 'issue-transfer-pending')!;
    await api.rejectIssueTransfer('transfer-projects-leadership', 'Leadership needs a named receiving team.');
    const after = await api.getWorkspace();
    const afterIssue = after.issues.find((issue) => issue.id === beforeIssue.id)!;

    expect(afterIssue.assignmentState).toBe('unassigned');
    expect(afterIssue.currentTeamId).toBeNull();
    expect(afterIssue.createdAt).toBe(beforeIssue.createdAt);
    expect(afterIssue.ageInDays).toBeGreaterThanOrEqual(beforeIssue.ageInDays);
    expect(after.transfers.find((transfer) => transfer.id === 'transfer-projects-leadership')?.rejectionMessage).toContain('named receiving team');
  });

  it('allows only the first valid transfer decision', async () => {
    const api = new LocalWorkspaceApi();
    await api.acceptIssueTransfer('transfer-projects-leadership');

    await expect(api.acceptIssueTransfer('transfer-projects-leadership')).rejects.toMatchObject({ code: 'CONFLICT' });
    const workspace = await api.getWorkspace();
    expect(workspace.issues.filter((issue) => issue.id === 'issue-transfer-pending' && issue.assignmentState !== 'redirected')).toHaveLength(1);
    expect(workspace.issues.find((issue) => issue.id === 'issue-transfer-pending' && issue.teamId === 'leadership')?.createdAt).toBe(workspace.issues.find((issue) => issue.id === 'issue-transfer-pending' && issue.teamId === 'projects')?.createdAt);
  });

  it('keeps PlatformAdmin separate from work-data access', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'maya-green')!;
    const api = new LocalWorkspaceApi(seed);

    await expect(api.getCompanyOverview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.updateAgeSettings({ agingDays: 6, staleDays: 12, criticalDays: 28 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(api.updateRockStatus('rock-service-development', 'off-track')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets administrators edit another local user with version and duplicate-email checks', async () => {
    const api = new LocalWorkspaceApi();
    const before = (await api.getWorkspace()).users.find((user) => user.id === 'marcus-lee')!;
    const updated = await api.updateUser(before.id, { name: 'Marcus Lee-Smith', email: 'marcus.smith@bremmar.example', platformAdmin: true }, before.version);
    const user = updated.users.find((candidate) => candidate.id === before.id)!;

    expect(user).toMatchObject({ id: before.id, name: 'Marcus Lee-Smith', email: 'marcus.smith@bremmar.example', initials: 'ML', platformCapabilities: ['PlatformAdmin'], version: (before.version ?? 1) + 1 });
    await expect(api.updateUser(before.id, { name: 'Stale edit' }, before.version)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(api.updateUser(before.id, { email: updated.users.find((candidate) => candidate.id === 'ava-khan')!.email }, user.version)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('converts a Rock Task once and keeps status, owner, and due date synchronized', async () => {
    const api = new LocalWorkspaceApi();
    const first = await api.convertRockTaskToTodo('task-playbook-pilot');
    const todoId = first.todos.find((todo) => todo.linkedRockTaskId === 'task-playbook-pilot')?.id;
    expect(todoId).toBeDefined();

    const second = await api.convertRockTaskToTodo('task-playbook-pilot');
    expect(second.todos.filter((todo) => todo.linkedRockTaskId === 'task-playbook-pilot')).toHaveLength(1);
    await api.updateRockTask('task-playbook-pilot', { status: 'done', assigneeId: 'marcus-lee', dueDate: '2026-09-20' });
    const updated = await api.getWorkspace();
    const linked = updated.todos.find((todo) => todo.id === todoId)!;
    expect(linked.status).toBe('done');
    expect(linked.ownerId).toBe('marcus-lee');
    expect(linked.dueDate).toBe('2026-09-20');
  });

  it('edits Rock Tasks and deletes them without deleting their linked To-Do', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const before = workspace.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === 'task-playbook-outline')!;
    workspace = await api.updateRockTask(before.id, { title: 'Approve the revised first-week checklist', notes: 'Keep the handoff owners visible.', dueDate: '2026-09-15', status: 'in-progress' }, before.version);
    const updated = workspace.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === before.id)!;
    expect(updated).toMatchObject({ title: 'Approve the revised first-week checklist', notes: 'Keep the handoff owners visible.', dueDate: '2026-09-15', status: 'in-progress', version: before.version + 1 });

    workspace = await api.deleteRockTask(updated.id, updated.version);
    expect(workspace.rocks.flatMap((rock) => rock.tasks).some((task) => task.id === updated.id)).toBe(false);
    const keptTodo = workspace.todos.find((todo) => todo.id === 'todo-brief');
    expect(keptTodo?.linkedRockTaskId).toBeUndefined();
    expect(keptTodo?.origin).toBe('Team workspace · former Rock Task');
  });

  it('rejects invalid avatars at the profile boundary', async () => {
    const api = new LocalWorkspaceApi();
    await expect(api.updateProfile({ avatarDataUrl: 'not-an-image' })).rejects.toMatchObject({ code: 'VALIDATION' });
    const updated = await api.updateProfile({ avatarDataUrl: 'data:image/png;base64,AAAA' });
    expect(updated.currentUser.avatarDataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('prevents hierarchy cycles and allows administrators to manage grouping nodes after work is clear', async () => {
    const seed = structuredClone(initialWorkspace);
    const membership: TeamMembership = { id: 'membership-ava-projects', teamId: 'projects', userId: 'ava-khan', role: 'Member', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    seed.memberships.push(membership);
    const api = new LocalWorkspaceApi(seed);
    await expect(api.updateTeam('professional-services', { parentTeamId: 'projects' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(api.updateTeam('projects', { nodeType: 'grouping' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('updates Rock notes and To-Do notes through versioned detail actions', async () => {
    const api = new LocalWorkspaceApi();
    const beforeRock = (await api.getWorkspace()).rocks.find((rock) => rock.id === 'rock-playbook')!;
    const afterRock = await api.updateRock('rock-playbook', { notes: '<p><strong>Add the support handoff checklist</strong> before launch.</p><script>alert(1)</script>' }, beforeRock.version);
    const updatedRock = afterRock.rocks.find((rock) => rock.id === 'rock-playbook')!;
    expect(updatedRock.notes).toContain('<strong>Add the support handoff checklist</strong>');
    expect(updatedRock.notes).not.toMatch(/script|alert/i);

    const beforeTodo = afterRock.todos.find((todo) => todo.id === 'todo-handoff')!;
    const afterTodo = await api.updateTodo('todo-handoff', { notes: 'Confirm the customer-facing owner in the next check-in.' }, beforeTodo.version);
    expect(afterTodo.todos.find((todo) => todo.id === 'todo-handoff')?.notes).toContain('customer-facing owner');

    const beforeIssue = afterTodo.issues.find((issue) => issue.id === 'issue-handoffs')!;
    const afterIssue = await api.updateIssue('issue-handoffs', { detail: '<p><em>Confirm the receiving owner</em> before launch.</p><img src=x onerror=alert(1)>' }, beforeIssue.version);
    const updatedIssue = afterIssue.issues.find((issue) => issue.id === 'issue-handoffs')!;
    expect(updatedIssue.detail).toContain('<em>Confirm the receiving owner</em>');
    expect(updatedIssue.detail).not.toMatch(/img|onerror/i);
  });

  it('rolls an incomplete To-Do over when a due date moves later', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const before = workspace.todos.find((item) => item.id === 'todo-handoff')!;
    workspace = await api.updateTodo(before.id, { dueDate: '2026-09-10', status: 'done' }, before.version);
    const rolled = workspace.todos.find((item) => item.id === before.id)!;

    expect(rolled).toMatchObject({ dueDate: '2026-09-10', status: 'open', carryForwardCount: 1, flagged: false });
  });

  it('treats earlier and unchanged dates as ordinary edits and never rolls completed To-Dos', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    let todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
    workspace = await api.updateTodo(todo.id, { dueDate: '2026-09-10' }, todo.version);
    todo = workspace.todos.find((item) => item.id === todo.id)!;
    workspace = await api.updateTodo(todo.id, { dueDate: '2026-09-05' }, todo.version);
    todo = workspace.todos.find((item) => item.id === todo.id)!;
    workspace = await api.updateTodo(todo.id, { dueDate: todo.dueDate }, todo.version);
    todo = workspace.todos.find((item) => item.id === todo.id)!;

    expect(todo.carryForwardCount).toBe(1);
    expect(todo.status).toBe('open');

    const completed = (await api.getWorkspace()).todos.find((item) => item.id === 'todo-alerts')!;
    workspace = await api.updateTodo(completed.id, { dueDate: '2099-09-30' }, completed.version);
    expect(workspace.todos.find((item) => item.id === completed.id)).toMatchObject({ status: 'done', carryForwardCount: 0, dueDate: '2099-09-30' });
  });

  it('synchronizes a linked Rock Task and creates one linked Issue after the fourth rollover', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'marcus-lee')!;
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.getWorkspace();
    const linkedBefore = workspace.todos.find((item) => item.id === 'todo-project-kickoff')!;
    const taskBefore = workspace.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === 'task-project-template')!;
    workspace = await api.updateTodo(linkedBefore.id, { dueDate: '2026-09-17' }, linkedBefore.version);
    const linkedAfter = workspace.todos.find((item) => item.id === linkedBefore.id)!;
    const taskAfter = workspace.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === taskBefore.id)!;
    expect(linkedAfter).toMatchObject({ dueDate: '2026-09-17', status: 'open', carryForwardCount: 1 });
    expect(taskAfter).toMatchObject({ dueDate: '2026-09-17', status: 'open', version: taskBefore.version + 1 });

    workspace = await api.getWorkspace();
    for (let count = 0; count < 4; count += 1) {
      const todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
      workspace = await api.updateTodo(todo.id, { dueDate: `2099-09-${String(10 + count).padStart(2, '0')}` }, todo.version);
    }
    const todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
    const issue = workspace.issues.find((item) => item.sourceTodoId === todo.id);
    expect(todo).toMatchObject({ carryForwardCount: 4, flagged: true, convertedIssueId: issue?.id });
    expect(issue).toMatchObject({ horizon: 'short-term', sourceTodoId: todo.id });
    expect(issue).not.toHaveProperty('category');
  });

  it('creates, edits, and upserts team scorecard records with weekly trends', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'marcus-lee')!;
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.getWorkspace();
    const week = workspace.meetings.find((meeting) => meeting.teamId === 'projects')!.weekStartDate!;
    const metric = workspace.metrics.find((item) => item.id === 'metric-kickoffs')!;
    const beforeResultCount = workspace.scorecardResults.filter((result) => result.metricId === metric.id && result.weekStartDate === week).length;
    workspace = await api.updateScorecardMetric(metric.id, { target: '92%' }, metric.version);
    const updatedMetric = workspace.metrics.find((item) => item.id === metric.id)!;
    expect(updatedMetric).toMatchObject({ target: '92%', version: metric.version + 1 });
    workspace = await api.upsertScorecardResult(metric.id, week, { actual: '96%', status: 'on-track' }, workspace.scorecardResults.find((result) => result.metricId === metric.id && result.weekStartDate === week)!.version);
    const result = workspace.scorecardResults.find((item) => item.metricId === metric.id && item.weekStartDate === week)!;
    expect(result).toMatchObject({ actual: '96%', status: 'on-track', trend: 'up', trendLabel: '+8 vs prior week' });
    expect(workspace.scorecardResults.filter((item) => item.metricId === metric.id && item.weekStartDate === week)).toHaveLength(beforeResultCount);
    await expect(api.upsertScorecardResult(metric.id, week, { actual: '97%', status: 'on-track' }, result.version - 1)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps scorecard writes inside team authorization and rejects grouping-only teams', async () => {
    const viewerSeed = structuredClone(initialWorkspace);
    viewerSeed.currentUser = viewerSeed.users.find((user) => user.id === 'maya-green')!;
    viewerSeed.memberships.find((membership) => membership.teamId === 'projects' && membership.userId === 'maya-green')!.role = 'Viewer';
    const viewerApi = new LocalWorkspaceApi(viewerSeed);
    await expect(viewerApi.createScorecardMetric({ teamId: 'projects', label: 'Viewer metric', target: '1', unit: 'item', ownerId: 'maya-green' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const leadershipApi = new LocalWorkspaceApi();
    await expect(leadershipApi.updateScorecardMetric('metric-kickoffs', { target: '95%' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const groupingSeed = structuredClone(initialWorkspace);
    groupingSeed.teams.push({ ...groupingSeed.teams[0], id: 'grouping-only', name: 'Grouping Only', shortName: 'Group', nodeType: 'grouping', parentTeamId: 'leadership', memberCount: 1 });
    groupingSeed.memberships.push({ ...groupingSeed.memberships[0], id: 'membership-ava-grouping', teamId: 'grouping-only' });
    const groupingApi = new LocalWorkspaceApi(groupingSeed);
    await expect(groupingApi.createScorecardMetric({ teamId: 'grouping-only', label: 'Invalid metric', target: '1', unit: 'item', ownerId: 'ava-khan' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('keeps team messages separate from transfers and supports editable Issue conversion', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    workspace = await api.markMessageRead('message-projects-kickoff');
    const message = workspace.messages.find((item) => item.id === 'message-projects-kickoff')!;
    expect(message.status).toBe('read');
    workspace = await api.createIssueFromMessage(message.id, { title: 'Security review before kickoff', detail: 'Leadership will confirm the receiving team before Friday.', priority: 2, horizon: 'short-term', ownerId: 'ava-khan' });
    const convertedMessage = workspace.messages.find((item) => item.id === message.id)!;
    const created = workspace.issues.find((issue) => issue.id === convertedMessage.convertedIssueId);
    expect(created).toMatchObject({ title: 'Security review before kickoff', detail: '<p>Leadership will confirm the receiving team before Friday.</p>', teamId: 'leadership' });
    expect(workspace.messages.find((item) => item.id === message.id)?.status).toBe('converted');
  });

  it('only includes unread incoming messages in the L10 starting context', () => {
    const messages: TeamMessage[] = [
      { ...initialWorkspace.messages[0], id: 'message-unread', status: 'unread' },
      { ...initialWorkspace.messages[0], id: 'message-read', status: 'read' },
      { ...initialWorkspace.messages[0], id: 'message-converted', status: 'converted' },
    ];
    expect(pendingTeamMessagesFor(messages, 'leadership').map((message) => message.id)).toEqual(['message-unread']);
  });

  it('adds meeting-specific IDS notes to the Issue and includes the full meeting recap', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    workspace = await api.addMeetingIssueNote(issue.id, 'meeting-leadership-2026-08-31', 'Decided to publish the owner matrix with the onboarding checklist.', issue.version);
    const updated = workspace.issues.find((item) => item.id === issue.id)!;
    expect(updated.status).toBe('in-ids');
    expect(updated.idsNote).toContain('publish the owner matrix');
    expect(workspace.meetings.find((meeting) => meeting.id === 'meeting-leadership-2026-08-31')?.idsNotes).toHaveLength(1);

    workspace = await api.closeMeeting('leadership', 'The team committed to one owner for every handoff.', 9);
    const recap = workspace.meetings.find((meeting) => meeting.id === 'meeting-leadership-2026-08-31')?.recap ?? '';
    expect(recap).toContain('Rock Review:');
    expect(recap).toContain('To-Do Review:');
    expect(recap).toContain('IDS:');
    expect(recap).toContain('publish the owner matrix');
  });

  it('marks an Issue orange after its third meeting and preserves team L10 configuration', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.issues.find((issue) => issue.id === 'issue-handoffs')!.meetingsPassed = 2;
    seed.meetings.find((meeting) => meeting.id === 'meeting-leadership-2026-08-31')!.idsIssueIds = ['issue-handoffs'];
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.updateTeam('cybersecurity', { meetingSections: defaultMeetingSections().map((section) => section.id === 'scorecard' ? { ...section, enabled: false } : section), escalationUserIds: ['priya-shah', 'ava-khan'] });
    expect(workspace.teams.find((team) => team.id === 'cybersecurity')?.meetingSections.find((section) => section.id === 'scorecard')?.enabled).toBe(false);
    workspace = await api.closeMeeting('leadership', 'Issue remains open after the third L10.', 8);
    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    expect(issue.meetingsPassed).toBe(3);
    expect(issue.meetingBand).toBe('orange');
    expect(issue.escalationState).toBe('not-scheduled');
    expect(issue.escalationDueAt).toBeUndefined();
  });

  it('creates the next L10 and carries unresolved IDS Issues forward', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.startIssue('issue-handoffs');

    for (let count = 0; count < 3; count += 1) {
      workspace = await api.closeMeeting('leadership', `Meeting ${count + 1}`, 8);
    }

    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    expect(issue.meetingsPassed).toBe(3);
    expect(issue.meetingBand).toBe('orange');
    expect(issue.escalationState).toBe('not-scheduled');
    expect(workspace.meetings.filter((meeting) => meeting.teamId === 'leadership' && meeting.status === 'closed')).toHaveLength(3);
    expect(workspace.meetings.filter((meeting) => meeting.teamId === 'leadership' && meeting.status === 'upcoming')).toHaveLength(4);
    expect(workspace.meetings.filter((meeting) => meeting.teamId === 'leadership' && meeting.status !== 'closed')[0]?.idsIssueIds).toContain(issue.id);

    workspace = await api.closeMeeting('leadership', 'Fourth meeting escalates the Issue.', 8);
    const escalated = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    expect(escalated).toMatchObject({ meetingsPassed: 4, meetingBand: 'red', escalationState: 'escalated' });
    expect(workspace.notifications.filter((notification) => notification.type === 'issue-escalation' && notification.issueId === issue.id)).toHaveLength(1);
  });

  it('selects occurrences, records an immutable start, skips with a reason, reschedules once, and filters history', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const upcoming = () => workspace.meetings.filter((meeting) => meeting.teamId === 'leadership' && meeting.status === 'upcoming').sort((left, right) => `${left.scheduledDate}T${left.scheduledTime}`.localeCompare(`${right.scheduledDate}T${right.scheduledTime}`));
    const first = upcoming()[0];
    workspace = await api.startMeeting('leadership', first.id, first.version);
    const started = workspace.meetings.find((meeting) => meeting.id === first.id)!;
    workspace = await api.startMeeting('leadership', first.id, first.version);
    const resumed = workspace.meetings.find((meeting) => meeting.id === first.id)!;
    expect(resumed).toMatchObject({ status: 'in-progress', startedAt: started.startedAt, version: started.version });

    const skippedCandidate = upcoming()[1];
    workspace = await api.skipMeeting('leadership', skippedCandidate.id, 'annual-leave', 'The facilitator is on annual leave.', skippedCandidate.version);
    const skipped = workspace.meetings.find((meeting) => meeting.id === skippedCandidate.id)!;
    expect(skipped).toMatchObject({ status: 'skipped', skipReason: 'annual-leave', skipNote: 'The facilitator is on annual leave.', skippedById: 'ava-khan' });
    expect(upcoming()).toHaveLength(4);

    const movedCandidate = upcoming()[0];
    const nominalDate = movedCandidate.recurrenceDate;
    workspace = await api.updateMeetingSchedule('leadership', movedCandidate.id, { scheduledDate: '2099-01-05', scheduledTime: '2:30 PM' }, movedCandidate.version);
    const moved = workspace.meetings.find((meeting) => meeting.id === movedCandidate.id)!;
    expect(moved).toMatchObject({ scheduledDate: '2099-01-05', scheduledTime: '2:30 PM', recurrenceDate: nominalDate });
    const history = await api.getMeetingReview({ filter: 'skipped', teamId: 'leadership' });
    expect(history.items.some((item) => item.meeting.id === skipped.id && item.reviewStatus === 'skipped')).toBe(true);
    expect((await api.getMeetingReview({ status: 'skipped', teamId: 'leadership' })).items.some((item) => item.meeting.id === skipped.id)).toBe(true);
  });

  it('lets a TeamLead rate a meeting for another facilitator and carries parked Issues forward', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const meeting = workspace.meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming')!;
    workspace = await api.startMeeting('leadership', meeting.id, meeting.version, 'marcus-lee');
    let started = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    const state = api as unknown as { workspaces: Record<'live' | 'test', Workspace> };
    const stored = state.workspaces.live.meetings.find((candidate) => candidate.id === meeting.id)!;
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    stored.startedAt = startedAt;
    stored.activeSectionStartedAt = startedAt;
    workspace = await api.transitionMeetingSection('leadership', meeting.id, 'segue', 'scorecard', started.version);
    started = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    const transitionedStored = state.workspaces.live.meetings.find((candidate) => candidate.id === meeting.id)!;
    transitionedStored.activeSectionStartedAt = new Date(Date.now() - 90_000).toISOString();
    const ratings = started.attendeeIds.map((attendeeId) => ({ attendeeId, rating: 9 }));
    workspace = await api.closeMeeting('leadership', 'The team left with clear owners.', 8, meeting.id, ratings);
    const closed = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;

    expect(closed.facilitatorId).toBe('marcus-lee');
    expect(closed.durationSeconds).toBeGreaterThanOrEqual(110);
    expect(closed.sectionDurations?.segue).toBeGreaterThanOrEqual(110);
    expect(closed.sectionDurations?.scorecard).toBeGreaterThanOrEqual(80);
    expect(closed.attendeeRatings).toEqual(ratings);
    expect(closed.recap).toContain('Facilitator: Marcus Lee');

    const issueWorkspace = await api.getWorkspace();
    const issueIds = issueWorkspace.issues.filter((issue) => issue.teamId === 'leadership').slice(0, 1).map((issue) => issue.id);
    const newIssues = await Promise.all(Array.from({ length: 6 }, (_, index) => api.addIssue({ title: `Park test ${index}`, detail: 'Test issue.', teamId: 'leadership', raisedById: 'ava-khan' })));
    const ids = newIssues.map((next) => next.issues[0].id);
    const nextMeeting = (await api.getWorkspace()).meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming')!;
    await expect(api.setMeetingIssueSelection('leadership', nextMeeting.id, [...ids, ...issueIds], nextMeeting.version)).rejects.toMatchObject({ code: 'VALIDATION' });
    workspace = await api.setMeetingIssueSelection('leadership', nextMeeting.id, ids.slice(0, 2), nextMeeting.version);
    const selected = workspace.issues.find((issue) => issue.id === ids[0])!;
    workspace = await api.parkIssue(selected.id, selected.version);
    const parked = workspace.issues.find((issue) => issue.id === selected.id)!;
    expect(parked.status).toBe('parked');
    workspace = await api.closeMeeting('leadership', 'Parked for the next conversation.', 8, nextMeeting.id);
    const carried = workspace.meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming');
    expect(carried?.idsIssueIds).toContain(selected.id);
  });

  it('keeps descendant meeting summary retries read-only for parent reviewers', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'marcus-lee')!;
    seed.memberships.push({ id: 'membership-marcus-professional-services', teamId: 'professional-services', userId: 'marcus-lee', role: 'TeamLead', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const childMeeting = seed.meetings.find((meeting) => meeting.teamId === 'cybersecurity')!;
    Object.assign(childMeeting, { status: 'closed' as const, closedAt: new Date().toISOString(), aiSummaryStatus: 'failed' as const, aiSummaryError: 'Worker timeout.' });
    const api = new LocalWorkspaceApi(seed);

    await expect(api.getMeeting('cybersecurity', childMeeting.id)).resolves.toMatchObject({ id: childMeeting.id, status: 'closed' });
    await expect(api.requestMeetingSummary('cybersecurity', childMeeting.id, childMeeting.version)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('queues a close-time AI recap and exposes the structured result through meeting history', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const meeting = workspace.meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming')!;
    workspace = await api.startMeeting('leadership', meeting.id, meeting.version);
    const started = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    workspace = await api.closeMeeting('leadership', 'The team agreed the owner matrix is the next focus.', 9, started.id);
    const queued = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(queued).toMatchObject({ status: 'closed', aiSummaryStatus: 'queued', aiSummarySource: 'close' });

    await new Promise((resolve) => setTimeout(resolve, 300));
    workspace = await api.getWorkspace();
    const ready = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(ready.aiSummaryStatus).toBe('ready');
    expect(ready.aiSummary?.executiveSummary).toContain('owner matrix');
    expect(ready.aiSummary?.decisions.length).toBeGreaterThan(0);
    expect((await api.getMeetingReview({ filter: 'completed', teamId: 'leadership' })).items.some((item) => item.meeting.id === meeting.id && item.meeting.aiSummaryStatus === 'ready')).toBe(true);

    workspace = await api.requestMeetingSummary('leadership', meeting.id, ready.version);
    const regenerated = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(regenerated).toMatchObject({ status: 'closed', aiSummaryStatus: 'queued', aiSummarySource: 'close' });
    expect(regenerated.version).toBe((ready.version ?? 1) + 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    workspace = await api.getWorkspace();
    expect(workspace.meetings.find((candidate) => candidate.id === meeting.id)?.aiSummaryStatus).toBe('ready');
  });

  it('cancels a stuck local AI recap and allows it to be resubmitted', async () => {
    const seed = structuredClone(initialWorkspace);
    const meeting = seed.meetings.find((candidate) => candidate.teamId === 'leadership' && candidate.status === 'upcoming')!;
    const timestamp = new Date().toISOString();
    Object.assign(meeting, { status: 'closed' as const, startedAt: timestamp, closedAt: timestamp, aiSummaryStatus: 'generating' as const, aiSummaryRequestedAt: timestamp, aiSummaryJobId: `summary-${meeting.id}` });
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.getWorkspace();
    const generating = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;

    workspace = await api.cancelMeetingSummary('leadership', meeting.id, generating.version);
    const cancelled = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(cancelled).toMatchObject({ status: 'closed', aiSummaryStatus: 'cancelled' });
    workspace = await api.requestMeetingSummary('leadership', meeting.id, cancelled.version);
    expect(workspace.meetings.find((candidate) => candidate.id === meeting.id)).toMatchObject({ status: 'closed', aiSummaryStatus: 'queued' });
  });

  it('saves meeting notes, converts off-track work once, and keeps IDS order separate from priority', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'priya-shah')!;
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.getWorkspace();
    const meeting = workspace.meetings.find((candidate) => candidate.teamId === 'cybersecurity')!;
    const metric = workspace.metrics.find((candidate) => candidate.id === 'metric-evidence')!;
    const result = workspace.scorecardResults.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === meeting.weekStartDate)!;

    workspace = await api.updateMeetingSectionNote('cybersecurity', meeting.id, 'scorecard', 'Capture the assignment gap and owner.', meeting.version);
    const savedMeeting = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(savedMeeting.sectionNotes.scorecard).toBe('Capture the assignment gap and owner.');
    expect(savedMeeting.version).toBe((meeting.version ?? 1) + 1);

    workspace = await api.createIssueFromScorecard(metric.id, result.weekStartDate, result.version);
    const scorecardIssue = workspace.issues.find((issue) => issue.linkedScorecardMetricId === metric.id && issue.linkedScorecardWeekStartDate === result.weekStartDate)!;
    workspace = await api.createIssueFromScorecard(metric.id, result.weekStartDate, result.version);
    expect(workspace.issues.filter((issue) => issue.linkedScorecardMetricId === metric.id && issue.linkedScorecardWeekStartDate === result.weekStartDate)).toHaveLength(1);
    expect(scorecardIssue).toMatchObject({ teamId: 'cybersecurity', ownerId: metric.ownerId, priority: 1 });

    const first = workspace.issues.find((issue) => issue.id === 'issue-cyber-owners')!;
    const second = workspace.issues.find((issue) => issue.id === scorecardIssue.id)!;
    workspace = await api.startIssue(first.id);
    workspace = await api.startIssue(second.id);
    const current = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    workspace = await api.reorderMeetingIssues('cybersecurity', meeting.id, [second.id, first.id], current.version);
    const ordered = workspace.meetings.find((candidate) => candidate.id === meeting.id)!;
    expect(ordered.idsIssueIds.slice(0, 2)).toEqual([second.id, first.id]);
    expect(workspace.issues.find((issue) => issue.id === second.id)?.priority).toBe(1);
  });

  it('merges a simple HTTP mutation response without requesting the full workspace again', async () => {
    const api = new HttpWorkspaceApi();
    const cached = structuredClone(initialWorkspace) as Workspace;
    (api as unknown as { cachedWorkspace: Workspace }).cachedWorkspace = cached;
    const responseIssue = { ...cached.issues[0], id: 'http-created-issue', title: 'Created without a reload', kind: 'issue' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(responseIssue), { status: 201, headers: { 'Content-Type': 'application/json', ETag: 'W/"1"' } }));

    const workspace = await api.addIssue({ title: responseIssue.title, detail: responseIssue.detail, teamId: responseIssue.teamId, raisedById: cached.currentUser.id });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/teams/leadership/issues');
    expect(workspace.issues.some((issue) => issue.id === responseIssue.id && issue.title === responseIssue.title)).toBe(true);
    fetchMock.mockRestore();
  });

  it('supports embedded checklists with default owners, compact reassignment, and independent completion', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'marcus-lee')!;
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.getWorkspace();
    const before = workspace.todos.find((todo) => todo.id === 'todo-project-kickoff')!;
    workspace = await api.addTodoChecklistItem(before.id, 'Confirm the customer handoff', undefined, before.version);
    const added = workspace.todos.find((todo) => todo.id === before.id)!;
    expect(added.checklist[0]).toMatchObject({ text: 'Confirm the customer handoff', completed: false, supporterId: 'maya-green' });
    expect(added.version).toBe(before.version + 1);

    const item = added.checklist[0];
    workspace = await api.updateTodoChecklistItem(added.id, item.id, { completed: true }, added.version);
    const completed = workspace.todos.find((todo) => todo.id === added.id)!;
    expect(completed.checklist[0].completed).toBe(true);
    expect(completed.status).toBe(before.status);
    await expect(api.updateTodoChecklistItem(added.id, item.id, { supporterId: 'priya-shah' }, completed.version)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(api.deleteTodoChecklistItem(added.id, item.id, completed.version - 1)).rejects.toMatchObject({ code: 'CONFLICT' });
    workspace = await api.deleteTodoChecklistItem(added.id, item.id, completed.version);
    expect(workspace.todos.find((todo) => todo.id === added.id)?.checklist).toHaveLength(0);
  });

  it('sanitizes rich To-Do notes and converts legacy plain text safely', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
    workspace = await api.updateTodo(todo.id, { notes: '<p><strong>Keep</strong></p><script>alert(1)</script><a href="javascript:bad">unsafe</a>' }, todo.version);
    const rich = workspace.todos.find((item) => item.id === todo.id)!;
    expect(rich.notes).toContain('<strong>Keep</strong>');
    expect(rich.notes).not.toMatch(/script|javascript|<a/i);
    workspace = await api.updateTodo(todo.id, { notes: 'First line\nSecond line' }, rich.version);
    expect(workspace.todos.find((item) => item.id === todo.id)?.notes).toMatch(/^<p>First line<br(?:\s*\/)?>Second line<\/p>$/);
    expect(sanitizeTodoNotes('<p><em>Allowed</em></p><img src=x onerror=alert(1)>')).not.toMatch(/img|onerror/i);
  });

  it('records either Issue resolution choice and links created follow-up To-Dos back to the Issue', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    workspace = await api.solveIssue(issue.id, { createFollowUpTodo: false, resolutionNote: 'Resolved in the customer review.' }, issue.version);
    const solved = workspace.issues.find((item) => item.id === issue.id)!;
    expect(solved.idsNote).toContain('Follow-up To-Do not created');
    expect(solved.idsNote).toContain('Resolved in the customer review');
    workspace = await api.solveIssue(issue.id, { createFollowUpTodo: true, resolutionNote: 'Should not append twice.' }, issue.version);
    const repeated = workspace.issues.find((item) => item.id === issue.id)!;
    expect(repeated.version).toBe(solved.version);
    expect(repeated.idsNote).not.toContain('Should not append twice');

    const seed = structuredClone(initialWorkspace);
    seed.currentUser = seed.users.find((user) => user.id === 'priya-shah')!;
    const supporterApi = new LocalWorkspaceApi(seed);
    workspace = await supporterApi.getWorkspace();
    const source = workspace.issues.find((item) => item.id === 'issue-cyber-owners')!;
    workspace = await supporterApi.solveIssue(source.id, { createFollowUpTodo: true }, source.version);
    const followUp = workspace.todos.find((todo) => todo.sourceIssueId === source.id);
    expect(followUp).toMatchObject({ ownerId: 'priya-shah', sourceIssueId: source.id });
  });

  it('shows unread incoming messages at Segue while excluding read, converted, and outgoing messages', async () => {
    const workspace = structuredClone(initialWorkspace);
    const incomingRead = { ...workspace.messages[0], id: 'message-read', status: 'read' as const };
    const converted = { ...workspace.messages[0], id: 'message-converted', status: 'converted' as const, convertedIssueId: 'issue-handoffs' };
    const outgoing = { ...workspace.messages[0], id: 'message-outgoing', fromTeamId: 'leadership', toTeamId: 'projects' };
    const pending = pendingTeamMessagesFor([...workspace.messages, incomingRead, converted, outgoing], 'leadership');
    expect(pending.map((message) => message.id)).toEqual(['message-projects-kickoff']);
  });

  it('refreshes the HTTP workspace after a due-date change so linked side effects are visible', async () => {
    const api = new HttpWorkspaceApi();
    const cached = structuredClone(initialWorkspace) as Workspace;
    (api as unknown as { cachedWorkspace: Workspace }).cachedWorkspace = cached;
    const before = cached.todos.find((todo) => todo.id === 'todo-handoff')!;
    const changed = { ...before, dueDate: '2026-09-21', version: before.version + 1, kind: 'todo' as const };
    const snapshot = {
      environmentId: cached.environment,
      user: cached.currentUser,
      quarter: cached.quarter,
      teams: cached.teams,
      users: cached.users,
      memberships: cached.memberships,
      settings: cached.settings,
      rocks: cached.rocks.map(({ tasks: _tasks, ...rock }) => rock),
      tasks: cached.rocks.flatMap((rock) => rock.tasks),
      todos: cached.todos.map((todo) => todo.id === before.id ? changed : todo),
      issues: cached.issues,
      transfers: cached.transfers,
      notifications: cached.notifications,
      messages: cached.messages,
      meetings: cached.meetings,
      metrics: cached.metrics,
      scorecardResults: cached.scorecardResults,
      headlines: cached.headlines,
      audit: cached.activity,
      etag: 'W/"2"',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(changed), { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'W/"2"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'W/"2"' } }));

    const result = await api.updateTodo(before.id, { dueDate: '2026-09-21' }, before.version);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/todos/todo-handoff');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ dueDate: '2026-09-21' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/workspace');
    expect(result.todos.find((todo) => todo.id === before.id)?.dueDate).toBe('2026-09-21');
    fetchMock.mockRestore();
  });
});
