import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import { verifyAiSignature, dispatchMeetingSummaryJob } from '../ai.js';
import { environmentRepositories } from '../data/services.js';
import type { CreateHistoricalMeetingInput, WorkspaceRepository } from '../data/repository.js';
import { isValidMeetingRating, type EnvironmentId, type MeetingAiSummary, type MeetingReviewFilter, type MeetingReviewQuery, type MeetingReviewStatus, type MeetingSection } from '../domain.js';

const meetingSections = new Set<MeetingSection>(['segue', 'scorecard', 'rock-review', 'headlines', 'todo-review', 'ids', 'conclude']);
const reviewFilters = new Set<MeetingReviewFilter | MeetingReviewStatus>(['attention', 'completed', 'skipped', 'all', 'upcoming', 'in-progress', 'closed', 'missed', 'overdue']);

async function dispatchSummary(repository: WorkspaceRepository, meeting: { teamId: string; id: string; aiSummaryJobId?: string }, userId: string) {
  if (!meeting.aiSummaryJobId) return;
  const job = await repository.getMeetingSummaryJob(meeting.teamId, meeting.id, userId);
  if (!job) return;
  try {
    if (await dispatchMeetingSummaryJob(job) === 'dispatched') await repository.updateMeetingSummaryDispatch(job.id, 'generating', undefined, 'ai-worker');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The AI worker could not be reached.';
    await repository.updateMeetingSummaryDispatch(job.id, 'failed', message, 'ai-worker');
  }
}

async function meetingReviewHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const params = new URL(request.url).searchParams;
  const rawFilter = params.get('filter') ?? undefined;
  const rawStatus = params.get('status') ?? undefined;
  if ((rawFilter && !reviewFilters.has(rawFilter as MeetingReviewFilter | MeetingReviewStatus)) || (rawStatus && !reviewFilters.has(rawStatus as MeetingReviewFilter | MeetingReviewStatus))) return { status: 422, jsonBody: { error: 'Invalid meeting history filter.', code: 'VALIDATION' } };
  try {
    const page = await repository.getMeetingReview(principal.userId, {
      filter: rawFilter as MeetingReviewQuery['filter'],
      status: rawStatus as MeetingReviewQuery['status'],
      teamId: params.get('teamId') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    });
    return responseWithEtag({ ...page, items: page.items.map((item) => ({ ...item, team: { id: item.team.teamId, name: item.team.name, shortName: item.team.shortName, parentTeamId: item.team.parentTeamId } })) }, `W/"${page.items.reduce((highest, item) => Math.max(highest, item.meeting.version), 0)}"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function getMeetingHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const meeting = await repository.getMeeting(teamId, meetingId, principal.userId);
    return responseWithEtag(meeting, `W/"${meeting.version}"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function addMeetingNoteHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const meetingId = request.params.meetingId;
  const issueId = request.params.issueId;
  if (!meetingId || !issueId) return { status: 422, jsonBody: { error: 'meetingId and issueId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ note?: string }>(request);
    const result = await repository.addMeetingIssueNote(issueId, meetingId, body.note ?? '', principal.userId, expectedVersion(request));
    return responseWithEtag(result, `W/\"${result.issue.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function closeMeetingHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ recap?: string; rating?: number; attendeeRatings?: unknown }>(request);
    if (body.attendeeRatings !== undefined && (!Array.isArray(body.attendeeRatings) || body.attendeeRatings.some((entry) => !entry || typeof entry !== 'object' || typeof (entry as { attendeeId?: unknown }).attendeeId !== 'string' || !isValidMeetingRating((entry as { rating?: unknown }).rating)))) return { status: 422, jsonBody: { error: 'attendeeRatings must contain attendeeId and ratings from 0.5 to 10 in 0.5 increments.', code: 'VALIDATION' } };
    const attendeeRatings = body.attendeeRatings as Array<{ attendeeId: string; rating: number }> | undefined;
    const meeting = await repository.closeMeeting(teamId, meetingId, body.recap ?? '', body.rating ?? 0, principal.userId, expectedVersion(request), attendeeRatings);
    await dispatchSummary(repository, meeting, principal.userId);
    const latest = await repository.getMeeting(teamId, meeting.id, principal.userId);
    return responseWithEtag(latest, `W/\"${latest.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function startMeetingHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
    const body = contentType.includes('application/json') ? await requestJson<{ facilitatorId?: unknown }>(request) : {};
    if (body.facilitatorId !== undefined && typeof body.facilitatorId !== 'string') return { status: 422, jsonBody: { error: 'facilitatorId must be a string.', code: 'VALIDATION' } };
    const meeting = await repository.startMeeting(teamId, meetingId, principal.userId, expectedVersion(request), body.facilitatorId);
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateMeetingScheduleHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ scheduledDate?: string; scheduledTime?: string }>(request);
    const meeting = await repository.updateMeetingSchedule(teamId, meetingId, {
      scheduledDate: typeof body?.scheduledDate === 'string' ? body.scheduledDate : '',
      scheduledTime: typeof body?.scheduledTime === 'string' ? body.scheduledTime : '',
    }, principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function generateMeetingsHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const result = await repository.generateMeetings(teamId, principal.userId);
    return responseWithEtag(result, `W/\"${result.meetings.reduce((highest, meeting) => Math.max(highest, meeting.version), 0)}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function skipMeetingHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ reason?: unknown; note?: unknown }>(request);
    if (typeof body?.reason !== 'string' || !['public-holiday', 'annual-leave', 'other'].includes(body.reason)) return { status: 422, jsonBody: { error: 'Choose a valid skip reason.', code: 'VALIDATION' } };
    if (body.note !== undefined && typeof body.note !== 'string') return { status: 422, jsonBody: { error: 'note must be a string', code: 'VALIDATION' } };
    const meeting = await repository.skipMeeting(teamId, meetingId, body.reason as 'public-holiday' | 'annual-leave' | 'other', body.note ?? '', principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function retryMeetingSummaryHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const meeting = await repository.requestMeetingSummary(teamId, meetingId, principal.userId, expectedVersion(request));
    await dispatchSummary(repository, meeting, principal.userId);
    const latest = await repository.getMeeting(teamId, meeting.id, principal.userId);
    return responseWithEtag(latest, `W/\"${latest.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function cancelMeetingSummaryHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const meeting = await repository.cancelMeetingSummary(teamId, meetingId, principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function meetingSummaryCallbackHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const rawBody = await request.text();
  const secret = process.env.AI_WORKER_SHARED_SECRET?.trim() ?? '';
  if (!verifyAiSignature(rawBody, request.headers.get('x-ai-timestamp'), request.headers.get('x-ai-signature'), secret)) return { status: 401, jsonBody: { error: 'Invalid AI callback signature.' } };
  try {
    const body = JSON.parse(rawBody) as { environmentId?: unknown; jobId?: unknown; attempt?: unknown; status?: unknown; summary?: MeetingAiSummary; error?: unknown };
    const environmentId = body.environmentId === 'test' ? 'test' : body.environmentId === 'live' ? 'live' : undefined;
    const attempt = typeof body.attempt === 'number' ? body.attempt : Number.NaN;
    if (!environmentId || typeof body.jobId !== 'string' || !Number.isInteger(attempt) || attempt < 1 || (body.status !== 'ready' && body.status !== 'failed')) return { status: 422, jsonBody: { error: 'Invalid AI callback payload.', code: 'VALIDATION' } };
    if (body.status === 'ready' && !body.summary) return { status: 422, jsonBody: { error: 'A ready callback must include a summary.', code: 'VALIDATION' } };
    const repository = environmentRepositories.getWorkspaceRepository(environmentId as EnvironmentId);
    const meeting = await repository.completeMeetingSummary(body.jobId, body.status, body.summary, typeof body.error === 'string' ? body.error : undefined, attempt);
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateMeetingSectionNoteHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ section?: unknown; note?: unknown }>(request);
    if (typeof body?.section !== 'string' || !meetingSections.has(body.section as MeetingSection)) return { status: 422, jsonBody: { error: 'A valid meeting section is required', code: 'VALIDATION' } };
    if (typeof body.note !== 'string') return { status: 422, jsonBody: { error: 'note must be a string', code: 'VALIDATION' } };
    const meeting = await repository.updateMeetingSectionNote(teamId, meetingId, body.section as MeetingSection, body.note, principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function reorderMeetingIssuesHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ issueIds?: unknown }>(request);
    if (!Array.isArray(body?.issueIds) || body.issueIds.some((issueId) => typeof issueId !== 'string')) return { status: 422, jsonBody: { error: 'issueIds must be a list of Issue IDs', code: 'VALIDATION' } };
    const meeting = await repository.reorderMeetingIssues(teamId, meetingId, body.issueIds as string[], principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function selectMeetingIssuesHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ issueIds?: unknown }>(request);
    if (!Array.isArray(body?.issueIds) || body.issueIds.some((issueId) => typeof issueId !== 'string')) return { status: 422, jsonBody: { error: 'issueIds must be a list of Issue IDs', code: 'VALIDATION' } };
    const meeting = await repository.setMeetingIssueSelection(teamId, meetingId, body.issueIds as string[], principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function transitionMeetingSectionHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  const meetingId = request.params.meetingId;
  if (!teamId || !meetingId) return { status: 422, jsonBody: { error: 'teamId and meetingId are required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ fromSection?: unknown; toSection?: unknown }>(request);
    if (typeof body.fromSection !== 'string' || typeof body.toSection !== 'string' || !meetingSections.has(body.fromSection as MeetingSection) || !meetingSections.has(body.toSection as MeetingSection)) return { status: 422, jsonBody: { error: 'fromSection and toSection must be valid meeting sections.', code: 'VALIDATION' } };
    const meeting = await repository.transitionMeetingSection(teamId, meetingId, body.fromSection as MeetingSection, body.toSection as MeetingSection, principal.userId, expectedVersion(request));
    return responseWithEtag(meeting, `W/\"${meeting.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createHistoricalMeetingHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<Partial<Omit<CreateHistoricalMeetingInput, 'teamId'>>>(request);
    const input: CreateHistoricalMeetingInput = {
      teamId,
      quarterId: typeof body.quarterId === 'string' ? body.quarterId : undefined,
      scheduledDate: typeof body.scheduledDate === 'string' ? body.scheduledDate : '',
      scheduledTime: typeof body.scheduledTime === 'string' ? body.scheduledTime : '',
      facilitatorId: typeof body.facilitatorId === 'string' ? body.facilitatorId : '',
      attendeeIds: Array.isArray(body.attendeeIds) ? body.attendeeIds as string[] : [],
      rating: typeof body.rating === 'number' ? body.rating : undefined,
      recap: typeof body.recap === 'string' ? body.recap : undefined,
      idsNote: typeof body.idsNote === 'string' ? body.idsNote : undefined,
    };
    const meeting = await repository.createHistoricalMeeting(input, principal.userId);
    return responseWithEtag(meeting, `W/"${meeting.version}"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('addMeetingIssueNote', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/issues/{issueId}/notes', handler: addMeetingNoteHandler });
app.http('meetingReview', { methods: ['GET'], authLevel: 'anonymous', route: 'meetings/review', handler: meetingReviewHandler });
app.http('getMeeting', { methods: ['GET'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}', handler: getMeetingHandler });
app.http('updateMeetingSchedule', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}', handler: updateMeetingScheduleHandler });
app.http('generateMeetings', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/generate', handler: generateMeetingsHandler });
app.http('updateMeetingSectionNote', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/notes', handler: updateMeetingSectionNoteHandler });
app.http('selectMeetingIssues', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/ids/selection', handler: selectMeetingIssuesHandler });
app.http('reorderMeetingIssues', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/ids/order', handler: reorderMeetingIssuesHandler });
app.http('transitionMeetingSection', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/section', handler: transitionMeetingSectionHandler });
app.http('createHistoricalMeeting', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/history', handler: createHistoricalMeetingHandler });
app.http('startMeeting', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/start', handler: startMeetingHandler });
app.http('closeMeeting', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/close', handler: closeMeetingHandler });
app.http('skipMeeting', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/skip', handler: skipMeetingHandler });
app.http('retryMeetingSummary', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/ai-summary/retry', handler: retryMeetingSummaryHandler });
app.http('cancelMeetingSummary', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/ai-summary/cancel', handler: cancelMeetingSummaryHandler });
app.http('meetingSummaryCallback', { methods: ['POST'], authLevel: 'anonymous', route: 'internal/meeting-summary-callback', handler: meetingSummaryCallbackHandler });
