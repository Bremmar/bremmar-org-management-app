import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import type { ScorecardMetricRecord, ScorecardResultRecord } from '../domain.js';

async function createMetricHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<ScorecardMetricRecord, 'label' | 'target' | 'unit' | 'ownerId'>>>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 422, jsonBody: { error: 'label, target, and unit are required', code: 'VALIDATION' } };
    const metric = await repository.createScorecardMetric({ teamId, label: body.label ?? '', target: body.target ?? '', unit: body.unit ?? '', ownerId: body.ownerId ?? principal.userId }, principal.userId);
    return responseWithEtag(metric, `W/\"${metric.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateMetricHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const metricId = request.params.metricId;
  if (!metricId) return { status: 422, jsonBody: { error: 'metricId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<ScorecardMetricRecord, 'label' | 'target' | 'unit' | 'ownerId'>>>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 422, jsonBody: { error: 'A measurable definition is required', code: 'VALIDATION' } };
    const metric = await repository.updateScorecardMetric(metricId, body, principal.userId, expectedVersion(request));
    return responseWithEtag(metric, `W/\"${metric.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function upsertResultHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const metricId = request.params.metricId;
  const weekStartDate = request.params.weekStartDate;
  if (!metricId || !weekStartDate) return { status: 422, jsonBody: { error: 'metricId and weekStartDate are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Pick<ScorecardResultRecord, 'actual' | 'status'>>>(request);
    if (!body || typeof body !== 'object') return { status: 422, jsonBody: { error: 'actual and status are required', code: 'VALIDATION' } };
    if (!body.status) return { status: 422, jsonBody: { error: 'status is required', code: 'VALIDATION' } };
    const result = await repository.upsertScorecardResult(metricId, weekStartDate, { actual: body.actual ?? '', status: body.status }, principal.userId, expectedVersion(request));
    return responseWithEtag(result, `W/\"${result.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createIssueFromScorecardHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const metricId = request.params.metricId;
  const weekStartDate = request.params.weekStartDate;
  if (!metricId || !weekStartDate) return { status: 422, jsonBody: { error: 'metricId and weekStartDate are required', code: 'VALIDATION' } };
  try {
    const issue = await repository.createIssueFromScorecard(metricId, weekStartDate, principal.userId, expectedVersion(request));
    return responseWithEtag(issue, `W/\"${issue.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('createScorecardMetric', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/scorecard/metrics', handler: createMetricHandler });
app.http('updateScorecardMetric', { methods: ['PATCH'], authLevel: 'anonymous', route: 'scorecard/metrics/{metricId}', handler: updateMetricHandler });
app.http('upsertScorecardResult', { methods: ['PUT'], authLevel: 'anonymous', route: 'scorecard/metrics/{metricId}/weeks/{weekStartDate}', handler: upsertResultHandler });
app.http('createIssueFromScorecard', { methods: ['POST'], authLevel: 'anonymous', route: 'scorecard/metrics/{metricId}/weeks/{weekStartDate}/issue', handler: createIssueFromScorecardHandler });
