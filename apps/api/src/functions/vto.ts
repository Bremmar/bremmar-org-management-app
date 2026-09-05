import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import type { SaveVtoInput } from '../data/repository.js';

async function getVtoHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const document = await scope.repository.getVto(teamId, scope.principal.userId);
    return responseWithEtag(document, `W/"${document.current?.version ?? 0}"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function saveVtoHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<SaveVtoInput>(request);
    const vto = await scope.repository.saveVto(teamId, body, scope.principal.userId, expectedVersion(request));
    return responseWithEtag(vto, `W/"${vto.version}"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('getVto', { methods: ['GET'], authLevel: 'anonymous', route: 'teams/{teamId}/vto', handler: getVtoHandler });
app.http('saveVto', { methods: ['PUT'], authLevel: 'anonymous', route: 'teams/{teamId}/vto', handler: saveVtoHandler });
