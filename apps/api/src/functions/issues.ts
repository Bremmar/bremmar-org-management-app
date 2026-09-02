import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';

interface TransferRequestBody {
  destinationTeamId?: string;
  note?: string;
}

interface TransferRejectionBody {
  message?: string;
}

async function issueHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const issueId = request.params.issueId;
  if (!issueId) return { status: 422, jsonBody: { error: 'issueId is required', code: 'VALIDATION' } };
  try {
    const issue = await repository.getIssue(issueId, principal.userId);
    return responseWithEtag(issue, `W/\"${issue.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function requestTransferHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const issueId = request.params.issueId;
  if (!issueId) return { status: 422, jsonBody: { error: 'issueId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<TransferRequestBody>(request);
    if (!body.destinationTeamId) return { status: 422, jsonBody: { error: 'destinationTeamId is required', code: 'VALIDATION' } };
    const transfer = await repository.requestIssueTransfer({ issueId, destinationTeamId: body.destinationTeamId, note: body.note, requestedById: principal.userId, idempotencyKey: request.headers.get('idempotency-key') ?? undefined });
    return responseWithEtag(transfer, `W/\"${transfer.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function acceptTransferHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const transferId = request.params.transferId;
  if (!transferId) return { status: 422, jsonBody: { error: 'transferId is required', code: 'VALIDATION' } };
  try {
    const transfer = await repository.acceptIssueTransfer(transferId, principal.userId, expectedVersion(request));
    return responseWithEtag(transfer, `W/\"${transfer.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function rejectTransferHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const transferId = request.params.transferId;
  if (!transferId) return { status: 422, jsonBody: { error: 'transferId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<TransferRejectionBody>(request);
    if (!body.message?.trim()) return { status: 422, jsonBody: { error: 'message is required to reject a transfer', code: 'VALIDATION' } };
    const transfer = await repository.rejectIssueTransfer(transferId, principal.userId, body.message, expectedVersion(request));
    return responseWithEtag(transfer, `W/\"${transfer.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function cancelTransferHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const transferId = request.params.transferId;
  if (!transferId) return { status: 422, jsonBody: { error: 'transferId is required', code: 'VALIDATION' } };
  try {
    const transfer = await repository.cancelIssueTransfer(transferId, principal.userId, expectedVersion(request));
    return responseWithEtag(transfer, `W/\"${transfer.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('issue', { methods: ['GET'], authLevel: 'anonymous', route: 'issues/{issueId}', handler: issueHandler });
app.http('requestIssueTransfer', { methods: ['POST'], authLevel: 'anonymous', route: 'issues/{issueId}/transfers', handler: requestTransferHandler });
app.http('acceptIssueTransfer', { methods: ['POST'], authLevel: 'anonymous', route: 'issue-transfers/{transferId}/accept', handler: acceptTransferHandler });
app.http('rejectIssueTransfer', { methods: ['POST'], authLevel: 'anonymous', route: 'issue-transfers/{transferId}/reject', handler: rejectTransferHandler });
app.http('cancelIssueTransfer', { methods: ['POST'], authLevel: 'anonymous', route: 'issue-transfers/{transferId}/cancel', handler: cancelTransferHandler });
