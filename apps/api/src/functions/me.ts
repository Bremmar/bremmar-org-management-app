import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { isEnvironmentId, setEnvironmentCookie } from '../environment.js';
import { authenticatedPrincipal, isResponse, repositoryErrorResponse, requestJson, requestScope } from './http.js';
import { environmentRepositories } from '../data/services.js';

async function sessionPayload(userId: string, environment: 'live' | 'test') {
  const repository = environmentRepositories.getWorkspaceRepository(environment);
  const session = await repository.getSessionContext(userId);
  if (!session) return null;
  const environmentSession = await environmentRepositories.getControlRepository().getEnvironmentSession(userId);
  return {
    ...session,
    currentEnvironment: environment,
    availableEnvironments: environmentSession.availableEnvironments,
    canSwitchToTest: environmentSession.canSwitchToTest,
  };
}

async function meHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  try {
    const session = await sessionPayload(scope.principal.userId, scope.environment);
    if (!session) return { status: 404, jsonBody: { error: 'No local profile exists for this identity.' } };
    return { status: 200, jsonBody: session };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function selectEnvironmentHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const principal = await authenticatedPrincipal(request);
  if (isResponse(principal)) return principal;
  try {
    const body = await requestJson<{ environment?: unknown }>(request);
    if (!isEnvironmentId(body.environment)) return { status: 422, jsonBody: { error: 'environment must be live or test', code: 'VALIDATION' } };
    const control = environmentRepositories.getControlRepository();
    if (!(await control.canAccess(principal.userId, body.environment))) return { status: 403, jsonBody: { error: 'Test environment access has not been granted.', code: 'FORBIDDEN' } };
    const session = await sessionPayload(principal.userId, body.environment);
    if (!session) return { status: 404, jsonBody: { error: 'No local profile exists for this identity.' } };
    return { status: 200, headers: { 'Set-Cookie': setEnvironmentCookie(body.environment) }, jsonBody: session };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: meHandler,
});

app.http('selectEnvironment', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'me/environment',
  handler: selectEnvironmentHandler,
});
