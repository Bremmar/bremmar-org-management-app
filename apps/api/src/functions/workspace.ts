import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { isResponse, repositoryErrorResponse, requestScope, responseWithEtag } from './http.js';

async function workspaceHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const workspace = await repository.getTeamWorkspace(teamId, principal.userId);
    return responseWithEtag(workspace, workspace.etag);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function workspaceSnapshotHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  try {
    const snapshot = await scope.repository.getWorkspaceSnapshot(scope.principal.userId);
    return responseWithEtag(snapshot, snapshot.etag);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('teamWorkspace', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'teams/{teamId}/workspace',
  handler: workspaceHandler,
});

app.http('workspaceSnapshot', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'workspace',
  handler: workspaceSnapshotHandler,
});
