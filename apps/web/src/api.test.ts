import { describe, expect, it } from 'vitest';
import { LocalWorkspaceApi } from './api';

describe('LocalWorkspaceApi', () => {
  it('updates a To-Do without changing other workspace records', async () => {
    const api = new LocalWorkspaceApi();
    const before = await api.getWorkspace();
    const after = await api.updateTodoStatus('todo-brief', 'done');

    expect(after.todos.find((todo) => todo.id === 'todo-brief')?.status).toBe('done');
    expect(after.rocks).toEqual(before.rocks);
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
});
