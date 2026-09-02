import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import type { IssueRecord, RockRecord, RockTaskRecord, TodoRecord } from '../domain.js';

async function createRockHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>>(request);
    const rock = await repository.createRock({ teamId, title: body.title ?? '', description: body.description, notes: body.notes, ownerId: body.ownerId ?? principal.userId, dueDate: body.dueDate, priority: body.priority }, principal.userId);
    return responseWithEtag(rock, `W/\"${rock.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateRockStatusHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const rockId = request.params.rockId;
  if (!rockId) return { status: 422, jsonBody: { error: 'rockId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ status?: RockRecord['status'] }>(request);
    if (!body.status) return { status: 422, jsonBody: { error: 'status is required', code: 'VALIDATION' } };
    const rock = await repository.updateRockStatus(rockId, body.status, principal.userId, expectedVersion(request));
    return responseWithEtag(rock, `W/\"${rock.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateRockHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const rockId = request.params.rockId;
  if (!rockId) return { status: 422, jsonBody: { error: 'rockId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>>(request);
    const rock = await repository.updateRock(rockId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(rock, `W/\"${rock.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createTodoHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'linkedRockTaskId'>>>(request);
    const todo = await repository.createTodo({ teamId, title: body.title ?? '', notes: body.notes, ownerId: body.ownerId ?? principal.userId, dueDate: body.dueDate ?? new Date().toISOString().slice(0, 10), linkedRockTaskId: body.linkedRockTaskId }, principal.userId);
    return responseWithEtag(todo, `W/\"${todo.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateTodoStatusHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const todoId = request.params.todoId;
  if (!todoId) return { status: 422, jsonBody: { error: 'todoId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ status?: TodoRecord['status'] }>(request);
    if (!body.status) return { status: 422, jsonBody: { error: 'status is required', code: 'VALIDATION' } };
    const todo = await repository.updateTodoStatus(todoId, body.status, principal.userId, expectedVersion(request));
    return responseWithEtag(todo, `W/\"${todo.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateTodoHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const todoId = request.params.todoId;
  if (!todoId) return { status: 422, jsonBody: { error: 'todoId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>>(request);
    const todo = await repository.updateTodo(todoId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(todo, `W/\"${todo.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createIssueHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ title?: string; detail?: string; category?: string; priority?: number; horizon?: 'short-term' | 'long-term'; ownerId?: string; linkedRockId?: string; idsNote?: string }>(request);
    const issue = await repository.createIssue({ teamId, title: body.title ?? '', detail: body.detail, category: body.category, priority: body.priority, horizon: body.horizon, ownerId: body.ownerId, linkedRockId: body.linkedRockId, idsNote: body.idsNote, raisedById: principal.userId }, principal.userId);
    return responseWithEtag(issue, `W/\"${issue.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateIssueHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const issueId = request.params.issueId;
  if (!issueId) return { status: 422, jsonBody: { error: 'issueId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<IssueRecord, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>>(request);
    const issue = await repository.updateIssue(issueId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(issue, `W/\"${issue.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function issueActionHandler(request: HttpRequest, _context: InvocationContext, action: 'start' | 'solve'): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const issueId = request.params.issueId;
  if (!issueId) return { status: 422, jsonBody: { error: 'issueId is required', code: 'VALIDATION' } };
  try {
    const issue = action === 'start' ? await repository.startIssue(issueId, principal.userId, expectedVersion(request)) : await repository.solveIssue(issueId, principal.userId, expectedVersion(request));
    return responseWithEtag(issue, `W/\"${issue.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createTaskHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const rockId = request.params.rockId;
  if (!rockId) return { status: 422, jsonBody: { error: 'rockId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate'>>>(request);
    const today = new Date().toISOString().slice(0, 10);
    const task = await repository.createRockTask({ rockId, title: body.title ?? '', notes: body.notes, assigneeId: body.assigneeId ?? principal.userId, assignedAt: body.assignedAt ?? today, startDate: body.startDate ?? today, dueDate: body.dueDate ?? today }, principal.userId);
    return responseWithEtag(task, `W/\"${task.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateTaskHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const taskId = request.params.taskId;
  if (!taskId) return { status: 422, jsonBody: { error: 'taskId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<RockTaskRecord, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>>(request);
    const task = await repository.updateRockTask(taskId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(task, `W/\"${task.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function convertTaskHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const taskId = request.params.taskId;
  if (!taskId) return { status: 422, jsonBody: { error: 'taskId is required', code: 'VALIDATION' } };
  try {
    const result = await repository.convertRockTaskToTodo(taskId, principal.userId);
    return responseWithEtag(result, `W/\"${result.task.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('createRock', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/rocks', handler: createRockHandler });
app.http('updateRock', { methods: ['PATCH'], authLevel: 'anonymous', route: 'rocks/{rockId}', handler: updateRockHandler });
app.http('updateRockStatus', { methods: ['PATCH'], authLevel: 'anonymous', route: 'rocks/{rockId}/status', handler: updateRockStatusHandler });
app.http('createTodo', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/todos', handler: createTodoHandler });
app.http('updateTodo', { methods: ['PATCH'], authLevel: 'anonymous', route: 'todos/{todoId}', handler: updateTodoHandler });
app.http('updateTodoStatus', { methods: ['PATCH'], authLevel: 'anonymous', route: 'todos/{todoId}/status', handler: updateTodoStatusHandler });
app.http('createIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/issues', handler: createIssueHandler });
app.http('updateIssue', { methods: ['PATCH'], authLevel: 'anonymous', route: 'issues/{issueId}', handler: updateIssueHandler });
app.http('startIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'issues/{issueId}/ids', handler: (request, context) => issueActionHandler(request, context, 'start') });
app.http('solveIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'issues/{issueId}/solve', handler: (request, context) => issueActionHandler(request, context, 'solve') });
app.http('createRockTask', { methods: ['POST'], authLevel: 'anonymous', route: 'rocks/{rockId}/tasks', handler: createTaskHandler });
app.http('updateRockTask', { methods: ['PATCH'], authLevel: 'anonymous', route: 'rock-tasks/{taskId}', handler: updateTaskHandler });
app.http('convertRockTask', { methods: ['POST'], authLevel: 'anonymous', route: 'rock-tasks/{taskId}/todo', handler: convertTaskHandler });
