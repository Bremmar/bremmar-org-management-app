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
    const body = await requestJson<Partial<Pick<RockRecord, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>>(request);
    const rock = await repository.updateRock(rockId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(rock, `W/\"${rock.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createIssueFromRockHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const rockId = request.params.rockId;
  if (!rockId) return { status: 422, jsonBody: { error: 'rockId is required', code: 'VALIDATION' } };
  try {
    const issue = await repository.createIssueFromRock(rockId, principal.userId, expectedVersion(request));
    return responseWithEtag(issue, `W/\"${issue.version}\"`);
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
    const body = await requestJson<Partial<Pick<TodoRecord, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'linkedRockTaskId' | 'sourceIssueId'>>>(request);
    const todo = await repository.createTodo({ teamId, title: body.title ?? '', notes: body.notes, ownerId: body.ownerId ?? principal.userId, dueDate: body.dueDate ?? new Date().toISOString().slice(0, 10), linkedRockTaskId: body.linkedRockTaskId, sourceIssueId: body.sourceIssueId }, principal.userId);
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

async function addTodoChecklistItemHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const todoId = request.params.todoId;
  if (!todoId) return { status: 422, jsonBody: { error: 'todoId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ text?: unknown; supporterId?: unknown }>(request);
    if (typeof body.text !== 'string') return { status: 422, jsonBody: { error: 'Checklist item text is required', code: 'VALIDATION' } };
    if (body.supporterId !== undefined && typeof body.supporterId !== 'string') return { status: 422, jsonBody: { error: 'supporterId must be a string', code: 'VALIDATION' } };
    const todo = await repository.addTodoChecklistItem(todoId, body.text, body.supporterId as string | undefined, principal.userId, expectedVersion(request));
    return responseWithEtag(todo, `W/\"${todo.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateTodoChecklistItemHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const todoId = request.params.todoId;
  const itemId = request.params.itemId;
  if (!todoId || !itemId) return { status: 422, jsonBody: { error: 'todoId and itemId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ text?: unknown; completed?: unknown; supporterId?: unknown }>(request);
    if (body.text !== undefined && typeof body.text !== 'string') return { status: 422, jsonBody: { error: 'text must be a string', code: 'VALIDATION' } };
    if (body.completed !== undefined && typeof body.completed !== 'boolean') return { status: 422, jsonBody: { error: 'completed must be a boolean', code: 'VALIDATION' } };
    if (body.supporterId !== undefined && typeof body.supporterId !== 'string') return { status: 422, jsonBody: { error: 'supporterId must be a string', code: 'VALIDATION' } };
    const todo = await repository.updateTodoChecklistItem(todoId, itemId, { text: body.text as string | undefined, completed: body.completed as boolean | undefined, supporterId: body.supporterId as string | undefined }, principal.userId, expectedVersion(request));
    return responseWithEtag(todo, `W/\"${todo.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function deleteTodoChecklistItemHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const todoId = request.params.todoId;
  const itemId = request.params.itemId;
  if (!todoId || !itemId) return { status: 422, jsonBody: { error: 'todoId and itemId are required', code: 'VALIDATION' } };
  try {
    const todo = await repository.deleteTodoChecklistItem(todoId, itemId, principal.userId, expectedVersion(request));
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
    const body = await requestJson<{ title?: string; detail?: string; priority?: number; horizon?: 'short-term' | 'long-term'; ownerId?: string; linkedRockId?: string; linkedScorecardMetricId?: string; linkedScorecardWeekStartDate?: string; idsNote?: string }>(request);
    const issue = await repository.createIssue({ teamId, title: body.title ?? '', detail: body.detail, priority: body.priority, horizon: body.horizon, ownerId: body.ownerId, linkedRockId: body.linkedRockId, linkedScorecardMetricId: body.linkedScorecardMetricId, linkedScorecardWeekStartDate: body.linkedScorecardWeekStartDate, idsNote: body.idsNote, raisedById: principal.userId }, principal.userId);
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
    const body = await requestJson<Partial<Pick<IssueRecord, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>>(request);
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
    let issue;
    if (action === 'start') {
      issue = await repository.startIssue(issueId, principal.userId, expectedVersion(request));
    } else {
      const body = await requestJson<{ createFollowUpTodo?: unknown; resolutionNote?: unknown }>(request);
      const createFollowUpTodo = body.createFollowUpTodo === undefined ? true : body.createFollowUpTodo;
      if (typeof createFollowUpTodo !== 'boolean') return { status: 422, jsonBody: { error: 'createFollowUpTodo must be a boolean', code: 'VALIDATION' } };
      if (body.resolutionNote !== undefined && typeof body.resolutionNote !== 'string') return { status: 422, jsonBody: { error: 'resolutionNote must be a string', code: 'VALIDATION' } };
      issue = await repository.solveIssue(issueId, { createFollowUpTodo, resolutionNote: body.resolutionNote as string | undefined }, principal.userId, expectedVersion(request));
    }
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

async function deleteTaskHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const taskId = request.params.taskId;
  if (!taskId) return { status: 422, jsonBody: { error: 'taskId is required', code: 'VALIDATION' } };
  try {
    const result = await repository.deleteRockTask(taskId, principal.userId, expectedVersion(request));
    return responseWithEtag(result, `W/\"${result.rockVersion}\"`);
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
app.http('createIssueFromRock', { methods: ['POST'], authLevel: 'anonymous', route: 'rocks/{rockId}/issue', handler: createIssueFromRockHandler });
app.http('createTodo', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/todos', handler: createTodoHandler });
app.http('updateTodo', { methods: ['PATCH'], authLevel: 'anonymous', route: 'todos/{todoId}', handler: updateTodoHandler });
app.http('updateTodoStatus', { methods: ['PATCH'], authLevel: 'anonymous', route: 'todos/{todoId}/status', handler: updateTodoStatusHandler });
app.http('addTodoChecklistItem', { methods: ['POST'], authLevel: 'anonymous', route: 'todos/{todoId}/checklist', handler: addTodoChecklistItemHandler });
app.http('updateTodoChecklistItem', { methods: ['PATCH'], authLevel: 'anonymous', route: 'todos/{todoId}/checklist/{itemId}', handler: updateTodoChecklistItemHandler });
app.http('deleteTodoChecklistItem', { methods: ['DELETE'], authLevel: 'anonymous', route: 'todos/{todoId}/checklist/{itemId}', handler: deleteTodoChecklistItemHandler });
app.http('createIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/issues', handler: createIssueHandler });
app.http('updateIssue', { methods: ['PATCH'], authLevel: 'anonymous', route: 'issues/{issueId}', handler: updateIssueHandler });
app.http('startIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'issues/{issueId}/ids', handler: (request, context) => issueActionHandler(request, context, 'start') });
app.http('solveIssue', { methods: ['POST'], authLevel: 'anonymous', route: 'issues/{issueId}/solve', handler: (request, context) => issueActionHandler(request, context, 'solve') });
app.http('createRockTask', { methods: ['POST'], authLevel: 'anonymous', route: 'rocks/{rockId}/tasks', handler: createTaskHandler });
app.http('updateRockTask', { methods: ['PATCH'], authLevel: 'anonymous', route: 'rock-tasks/{taskId}', handler: updateTaskHandler });
app.http('deleteRockTask', { methods: ['DELETE'], authLevel: 'anonymous', route: 'rock-tasks/{taskId}', handler: deleteTaskHandler });
app.http('convertRockTask', { methods: ['POST'], authLevel: 'anonymous', route: 'rock-tasks/{taskId}/todo', handler: convertTaskHandler });
