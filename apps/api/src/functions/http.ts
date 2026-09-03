import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { IdentityResolutionError, resolveClientPrincipal, type ClientPrincipal } from '../auth.js';
import { readEnvironmentCookie } from '../environment.js';
import type { EnvironmentId } from '../domain.js';
import { environmentRepositories } from '../data/services.js';
import { RepositoryError } from '../data/repository.js';
import type { WorkspaceRepository } from '../data/repository.js';

export async function authenticatedPrincipal(request: HttpRequest): Promise<ClientPrincipal | HttpResponseInit> {
  const principal = await resolveClientPrincipal(request);
  return principal ?? { status: 401, jsonBody: { error: 'Authentication required' } };
}

export function isResponse(value: object | HttpResponseInit): value is HttpResponseInit {
  return 'status' in value;
}

export interface RequestScope {
  principal: ClientPrincipal;
  environment: EnvironmentId;
  repository: WorkspaceRepository;
}

/**
 * Resolve the database only after Entra authentication and the signed
 * environment cookie have been checked. No query string or browser state is
 * accepted as an authorization signal.
 */
export async function requestScope(request: HttpRequest): Promise<RequestScope | HttpResponseInit> {
  try {
    const principal = await authenticatedPrincipal(request);
    if (isResponse(principal)) return principal;
    const environment = readEnvironmentCookie(request);
    const control = environmentRepositories.getControlRepository();
    if (!(await control.canAccess(principal.userId, environment))) {
      return { status: 403, jsonBody: { error: 'Test environment access has not been granted.', code: 'FORBIDDEN' } };
    }
    return { principal, environment, repository: environmentRepositories.getWorkspaceRepository(environment) };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

export function repositoryErrorResponse(error: unknown): HttpResponseInit {
  if (error instanceof IdentityResolutionError) return { status: 503, jsonBody: { error: error.message, code: error.code } };
  if (error instanceof RepositoryError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : error.code === 'VALIDATION' ? 422 : 503;
    return { status, jsonBody: { error: error.message, code: error.code } };
  }
  return { status: 500, jsonBody: { error: 'Unable to complete the request.' } };
}

export async function requestJson<T>(request: HttpRequest): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new RepositoryError('VALIDATION', 'Request body must be valid JSON.');
  }
}

export function expectedVersion(request: HttpRequest) {
  const raw = request.headers.get('if-match') ?? request.headers.get('x-expected-version');
  if (!raw || raw === '*') return undefined;
  const normalized = raw.replace(/^W\//, '').replace(/^\"|\"$/g, '');
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 1) throw new RepositoryError('VALIDATION', 'If-Match must contain a positive record version.');
  return version;
}

export function responseWithEtag(jsonBody: unknown, etag: string, status = 200): HttpResponseInit {
  return { status, headers: { ETag: etag, 'Content-Type': 'application/json' }, jsonBody };
}
