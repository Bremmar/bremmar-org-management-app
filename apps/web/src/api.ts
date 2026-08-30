import { initialWorkspace } from './data';
import type {
  Issue,
  IssueStatus,
  RockStatus,
  Todo,
  TodoStatus,
  Workspace,
} from './types';

export interface WorkspaceApi {
  getWorkspace(): Promise<Workspace>;
  updateRockStatus(rockId: string, status: RockStatus): Promise<Workspace>;
  updateTodoStatus(todoId: string, status: TodoStatus): Promise<Workspace>;
  startIssue(issueId: string): Promise<Workspace>;
  solveIssue(issueId: string): Promise<Workspace>;
  addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'>): Promise<Workspace>;
  addIssue(input: Pick<Issue, 'title' | 'detail' | 'category' | 'teamId' | 'raisedById'>): Promise<Workspace>;
}

const cloneWorkspace = (workspace: Workspace): Workspace => structuredClone(workspace);

export class LocalWorkspaceApi implements WorkspaceApi {
  private workspace = cloneWorkspace(initialWorkspace);

  async getWorkspace(): Promise<Workspace> {
    return cloneWorkspace(this.workspace);
  }

  async updateRockStatus(rockId: string, status: RockStatus): Promise<Workspace> {
    const rock = this.workspace.rocks.find((item) => item.id === rockId);
    if (!rock) throw new Error('Rock not found');
    rock.status = status;
    if (status === 'complete') rock.progress = 100;
    if (status === 'on-track' && rock.progress === 100) rock.progress = 95;
    return cloneWorkspace(this.workspace);
  }

  async updateTodoStatus(todoId: string, status: TodoStatus): Promise<Workspace> {
    const todo = this.workspace.todos.find((item) => item.id === todoId);
    if (!todo) throw new Error('To-Do not found');
    todo.status = status;
    return cloneWorkspace(this.workspace);
  }

  async startIssue(issueId: string): Promise<Workspace> {
    const issue = this.workspace.issues.find((item) => item.id === issueId);
    if (!issue) throw new Error('Issue not found');
    issue.status = 'in-ids';
    return cloneWorkspace(this.workspace);
  }

  async solveIssue(issueId: string): Promise<Workspace> {
    const issue = this.workspace.issues.find((item) => item.id === issueId);
    if (!issue) throw new Error('Issue not found');
    issue.status = 'solved';
    const followUpId = `todo-follow-up-${issue.id}`;
    if (!this.workspace.todos.some((todo) => todo.id === followUpId)) {
      this.workspace.todos.unshift({
        id: followUpId,
        teamId: issue.teamId,
        title: `Follow up on the solution: ${issue.title}`,
        ownerId: this.workspace.currentUser.id,
        dueDate: 'Next Monday',
        status: 'open',
        origin: `IDS · ${issue.title}`,
        isMine: true,
      });
    }
    return cloneWorkspace(this.workspace);
  }

  async addTodo(input: Pick<Todo, 'title' | 'ownerId' | 'dueDate' | 'teamId'>): Promise<Workspace> {
    this.workspace.todos.unshift({
      ...input,
      id: `todo-${Date.now()}`,
      status: 'open',
      origin: 'Added from the workspace',
      isMine: input.ownerId === this.workspace.currentUser.id,
    });
    return cloneWorkspace(this.workspace);
  }

  async addIssue(input: Pick<Issue, 'title' | 'detail' | 'category' | 'teamId' | 'raisedById'>): Promise<Workspace> {
    this.workspace.issues.unshift({
      ...input,
      id: `issue-${Date.now()}`,
      priority: 1,
      status: 'open',
      age: 'Just now',
    });
    return cloneWorkspace(this.workspace);
  }
}

export const workspaceApi: WorkspaceApi = new LocalWorkspaceApi();
