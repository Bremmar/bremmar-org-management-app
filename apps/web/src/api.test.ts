import { describe, expect, it } from 'vitest';
import { ageBandFor, LocalWorkspaceApi } from './api';
import { initialWorkspace } from './data';
import { defaultMeetingSections } from './types';
import type { TeamMembership } from './types';

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
    const testWorkspace = await api.addIssue({ title: 'Test-only issue', detail: 'This belongs only to the Test database.', category: 'Testing', teamId: 'leadership', raisedById: 'ava-khan' });
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
    const first = await api.solveIssue('issue-handoffs');
    const second = await api.solveIssue('issue-handoffs');

    expect(first.issues.find((issue) => issue.id === 'issue-handoffs')?.status).toBe('solved');
    expect(first.todos.filter((todo) => todo.id === 'todo-follow-up-issue-handoffs')).toHaveLength(1);
    expect(second.todos.filter((todo) => todo.id === 'todo-follow-up-issue-handoffs')).toHaveLength(1);
  });

  it('adds new records to the selected team', async () => {
    const api = new LocalWorkspaceApi();
    const workspace = await api.addIssue({
      title: 'The weekly agenda needs one owner',
      detail: 'Capture the decision before the meeting starts.',
      category: 'Process',
      teamId: 'leadership',
      raisedById: 'ava-khan',
    });

    expect(workspace.issues[0]).toMatchObject({
      title: 'The weekly agenda needs one owner',
      teamId: 'leadership',
      status: 'open',
    });
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
    const afterRock = await api.updateRock('rock-playbook', { notes: 'Add the support handoff checklist before launch.' }, beforeRock.version);
    expect(afterRock.rocks.find((rock) => rock.id === 'rock-playbook')?.notes).toContain('support handoff');

    const beforeTodo = afterRock.todos.find((todo) => todo.id === 'todo-handoff')!;
    const afterTodo = await api.updateTodo('todo-handoff', { notes: 'Confirm the customer-facing owner in the next check-in.' }, beforeTodo.version);
    expect(afterTodo.todos.find((todo) => todo.id === 'todo-handoff')?.notes).toContain('customer-facing owner');
  });

  it('flags a repeated To-Do and creates one linked Issue after the fourth move', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    for (let count = 0; count < 4; count += 1) {
      const todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
      workspace = await api.moveTodoForward(todo.id, `2099-09-${String(10 + count).padStart(2, '0')}`, todo.version);
    }
    const todo = workspace.todos.find((item) => item.id === 'todo-handoff')!;
    const issue = workspace.issues.find((item) => item.sourceTodoId === todo.id);
    expect(todo).toMatchObject({ carryForwardCount: 4, flagged: true, convertedIssueId: issue?.id });
    expect(issue).toMatchObject({ category: 'To-Do rollover', horizon: 'short-term', sourceTodoId: todo.id });
  });

  it('keeps team messages separate from transfers and supports editable Issue conversion', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.getWorkspace();
    workspace = await api.markMessageRead('message-projects-kickoff');
    const message = workspace.messages.find((item) => item.id === 'message-projects-kickoff')!;
    expect(message.status).toBe('read');
    workspace = await api.createIssueFromMessage(message.id, { title: 'Security review before kickoff', detail: 'Leadership will confirm the receiving team before Friday.', category: 'Cross-team', priority: 2, horizon: 'short-term', ownerId: 'ava-khan' });
    const convertedMessage = workspace.messages.find((item) => item.id === message.id)!;
    const created = workspace.issues.find((issue) => issue.id === convertedMessage.convertedIssueId);
    expect(created).toMatchObject({ title: 'Security review before kickoff', detail: 'Leadership will confirm the receiving team before Friday.', teamId: 'leadership' });
    expect(workspace.messages.find((item) => item.id === message.id)?.status).toBe('converted');
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

  it('schedules an Issue for escalation after its third meeting and preserves team L10 configuration', async () => {
    const seed = structuredClone(initialWorkspace);
    seed.issues.find((issue) => issue.id === 'issue-handoffs')!.meetingsPassed = 2;
    seed.meetings.find((meeting) => meeting.id === 'meeting-leadership-2026-08-31')!.idsIssueIds = ['issue-handoffs'];
    const api = new LocalWorkspaceApi(seed);
    let workspace = await api.updateTeam('cybersecurity', { meetingSections: defaultMeetingSections().map((section) => section.id === 'scorecard' ? { ...section, enabled: false } : section), escalationUserIds: ['priya-shah', 'ava-khan'] });
    expect(workspace.teams.find((team) => team.id === 'cybersecurity')?.meetingSections.find((section) => section.id === 'scorecard')?.enabled).toBe(false);
    workspace = await api.closeMeeting('leadership', 'Issue remains open after the third L10.', 8);
    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    expect(issue.meetingsPassed).toBe(3);
    expect(issue.escalationState).toBe('scheduled');
    expect(issue.escalationDueAt).toBeDefined();
  });

  it('creates the next L10 and carries unresolved IDS Issues forward', async () => {
    const api = new LocalWorkspaceApi();
    let workspace = await api.startIssue('issue-handoffs');

    for (let count = 0; count < 3; count += 1) {
      workspace = await api.closeMeeting('leadership', `Meeting ${count + 1}`, 8);
    }

    const issue = workspace.issues.find((item) => item.id === 'issue-handoffs')!;
    expect(issue.meetingsPassed).toBe(3);
    expect(issue.escalationState).toBe('scheduled');
    expect(workspace.meetings.filter((meeting) => meeting.teamId === 'leadership')).toHaveLength(4);
    expect(workspace.meetings.filter((meeting) => meeting.teamId === 'leadership' && meeting.status !== 'closed')[0]?.idsIssueIds).toContain(issue.id);
  });
});
