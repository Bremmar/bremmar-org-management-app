import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';

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
    const body = await requestJson<{ recap?: string; rating?: number }>(request);
    const meeting = await repository.closeMeeting(teamId, meetingId, body.recap ?? '', body.rating ?? 0, principal.userId, expectedVersion(request));
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

app.http('addMeetingIssueNote', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/issues/{issueId}/notes', handler: addMeetingNoteHandler });
app.http('updateMeetingSchedule', { methods: ['PATCH'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}', handler: updateMeetingScheduleHandler });
app.http('closeMeeting', { methods: ['POST'], authLevel: 'anonymous', route: 'teams/{teamId}/meetings/{meetingId}/close', handler: closeMeetingHandler });
