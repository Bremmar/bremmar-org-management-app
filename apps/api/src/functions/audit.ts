import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { type AuditEntityType } from '../domain.js';
import { isResponse, repositoryErrorResponse, requestScope, responseWithEtag } from './http.js';

const auditEntityTypes = new Set<AuditEntityType>(['rock', 'todo', 'issue']);

function isAuditEntityType(value: string | undefined): value is AuditEntityType {
  return Boolean(value && auditEntityTypes.has(value as AuditEntityType));
}

async function auditTrailHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const entityType = request.params.entityType;
  const entityId = request.params.entityId;
  if (!isAuditEntityType(entityType)) return { status: 422, jsonBody: { error: 'entityType must be rock, todo, or issue', code: 'VALIDATION' } };
  if (!entityId?.trim()) return { status: 422, jsonBody: { error: 'entityId is required', code: 'VALIDATION' } };
  try {
    const events = await scope.repository.getAuditTrail(entityType, entityId, scope.principal.userId);
    return responseWithEtag(events, `W/"audit-${entityId}-${events[0]?.id ?? 'empty'}"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('auditTrail', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'audit/{entityType}/{entityId}',
  handler: auditTrailHandler,
});
