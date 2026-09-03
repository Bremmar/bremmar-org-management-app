import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import type { IssueRecord } from '../domain.js';

interface MessageBody {
  toTeamId?: string;
  subject?: string;
  body?: string;
}

async function sendMessageHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const fromTeamId = request.params.teamId;
  if (!fromTeamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<MessageBody>(request);
    if (!body.toTeamId) return { status: 422, jsonBody: { error: 'toTeamId is required', code: 'VALIDATION' } };
    const message = await repository.sendTeamMessage({ fromTeamId, toTeamId: body.toTeamId, subject: body.subject ?? '', body: body.body ?? '', senderId: principal.userId });
    return responseWithEtag(message, `W/\"${message.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function markMessageReadHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const messageId = request.params.messageId;
  if (!messageId) return { status: 422, jsonBody: { error: 'messageId is required', code: 'VALIDATION' } };
  try {
    const message = await repository.markMessageRead(messageId, principal.userId, expectedVersion(request));
    return responseWithEtag(message, `W/\"${message.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createIssueFromMessageHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const messageId = request.params.messageId;
  if (!messageId) return { status: 422, jsonBody: { error: 'messageId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<IssueRecord, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId'>>> (request);
    const issue = await repository.createIssueFromMessage({ messageId, title: body.title ?? '', detail: body.detail ?? '', priority: body.priority, horizon: body.horizon, ownerId: body.ownerId }, principal.userId);
    return responseWithEtag(issue, `W/\"${issue.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('sendTeamMessage', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/messages', handler: sendMessageHandler });
app.http('markTeamMessageRead', { methods: ['POST'], authLevel: 'anonymous', route: 'messages/{messageId}/read', handler: markMessageReadHandler });
app.http('createIssueFromMessage', { methods: ['POST'], authLevel: 'anonymous', route: 'messages/{messageId}/issue', handler: createIssueFromMessageHandler });
