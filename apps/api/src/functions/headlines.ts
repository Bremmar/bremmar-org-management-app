import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import type { CreateHeadlineInput } from '../data/repository.js';

async function createHeadlineHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<CreateHeadlineInput, 'meetingId' | 'type' | 'title' | 'detail' | 'issueId'>>>(request);
    if (body.type !== 'win' && body.type !== 'concern') return { status: 422, jsonBody: { error: 'Headline type must be win or concern.', code: 'VALIDATION' } };
    if (body.meetingId !== undefined && typeof body.meetingId !== 'string') return { status: 422, jsonBody: { error: 'meetingId must be a string.', code: 'VALIDATION' } };
    if (body.issueId !== undefined && typeof body.issueId !== 'string') return { status: 422, jsonBody: { error: 'issueId must be a string.', code: 'VALIDATION' } };
    if (body.detail !== undefined && typeof body.detail !== 'string') return { status: 422, jsonBody: { error: 'detail must be a string.', code: 'VALIDATION' } };
    const headline = await repository.createHeadline({
      teamId,
      meetingId: body.meetingId,
      type: body.type,
      title: typeof body.title === 'string' ? body.title : '',
      detail: body.detail,
      issueId: body.issueId,
    }, principal.userId);
    return responseWithEtag(headline, `W/\"${headline.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('createHeadline', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/headlines', handler: createHeadlineHandler });
