import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';

async function profileHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const user = await repository.getUser(principal.userId);
    if (!user) return { status: 404, jsonBody: { error: 'Profile not found.' } };
    return responseWithEtag(user, `W/\"${user.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateProfileHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const body = await requestJson<{ name?: string; email?: string; avatarDataUrl?: string | null }>(request);
    const user = await repository.updateUserProfile(body, principal.userId, expectedVersion(request));
    return responseWithEtag(user, `W/\"${user.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('profile', { methods: ['GET'], authLevel: 'anonymous', route: 'profile', handler: profileHandler });
app.http('updateProfile', { methods: ['PATCH'], authLevel: 'anonymous', route: 'profile', handler: updateProfileHandler });
