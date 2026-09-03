import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { lookupEntraObjectId } from '../auth.js';
import { expectedVersion, isResponse, repositoryErrorResponse, requestJson, requestScope, responseWithEtag } from './http.js';
import { DEFAULT_MEETING_SECTIONS } from '../domain.js';
import type { IssueAgeSettings, MeetingCadence, MeetingSectionConfig, TeamMembership, TeamNodeType } from '../domain.js';
import { RepositoryError } from '../data/repository.js';
import { environmentRepositories } from '../data/services.js';

interface TeamBody {
  teamId?: string;
  name?: string;
  shortName?: string;
  description?: string;
  parentTeamId?: string | null;
  nodeType?: TeamNodeType;
  meetingCadence?: MeetingCadence;
  meetingDay?: string;
  meetingTime?: string;
  accent?: string;
  initials?: string;
  meetingSections?: MeetingSectionConfig[];
  escalationUserIds?: string[];
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

async function adminSnapshotHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const snapshot = await repository.getAdminSnapshot(principal.userId);
    return responseWithEtag(snapshot, snapshot.etag);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createTeamHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const body = await requestJson<TeamBody>(request);
    const team = await repository.createTeam({ teamId: body.teamId, name: body.name ?? '', shortName: body.shortName ?? '', description: body.description ?? '', parentTeamId: body.parentTeamId ?? null, nodeType: body.nodeType ?? 'operational', meetingCadence: body.meetingCadence ?? 'weekly', meetingDay: body.meetingDay ?? 'Monday', meetingTime: body.meetingTime ?? '9:00 AM', accent: body.accent ?? '#4c8f86', initials: body.initials ?? (body.shortName ?? '').slice(0, 2).toUpperCase(), meetingSections: body.meetingSections ?? DEFAULT_MEETING_SECTIONS, escalationUserIds: body.escalationUserIds ?? [] }, principal.userId);
    return responseWithEtag(team, `W/\"${team.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateTeamHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const teamId = request.params.teamId;
  if (!teamId) return { status: 422, jsonBody: { error: 'teamId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<TeamBody>(request);
    const team = await repository.updateTeam(teamId, omitUndefined({
      name: body.name,
      shortName: body.shortName,
      description: body.description,
      parentTeamId: body.parentTeamId,
      nodeType: body.nodeType,
      meetingCadence: body.meetingCadence,
      meetingDay: body.meetingDay,
      meetingTime: body.meetingTime,
      accent: body.accent,
      initials: body.initials,
      meetingSections: body.meetingSections,
      escalationUserIds: body.escalationUserIds,
    }), principal.userId, expectedVersion(request));
    return responseWithEtag(team, `W/\"${team.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function createUserHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const body = await requestJson<{ name?: string; email?: string; accent?: string; platformAdmin?: boolean }>(request);
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim() ?? '';
    if (!name || !email) throw new RepositoryError('VALIDATION', 'Name and email are required.');
    const localPoc = process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true';
    const identityId = localPoc ? undefined : await lookupEntraObjectId(email);
    if (!localPoc && !identityId) throw new RepositoryError('NOT_FOUND', 'No Entra user was found for that email address.');
    const user = await repository.createUser({ name, email, accent: body.accent ?? '#6787b7', platformAdmin: body.platformAdmin, identityId }, principal.userId);
    return responseWithEtag(user, `W/\"${user.version}\"`, 201);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function upsertMembershipHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const body = await requestJson<{ userId?: string; teamId?: string; role?: TeamMembership['role'] }>(request);
    if (!body.userId || !body.teamId || !body.role) return { status: 422, jsonBody: { error: 'userId, teamId, and role are required', code: 'VALIDATION' } };
    const membership = await repository.upsertMembership({ userId: body.userId, teamId: body.teamId, role: body.role }, principal.userId);
    return responseWithEtag(membership, `W/\"${membership.version}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateAgeSettingsHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const settings = await requestJson<IssueAgeSettings>(request);
    const saved = await repository.updateAgeSettings(settings, principal.userId, expectedVersion(request));
    return responseWithEtag(saved, `W/\"${saved.version ?? 1}\"`);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function environmentAccessHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  if (scope.environment !== 'live') return { status: 403, jsonBody: { error: 'Test access is managed from the Live Admin center.', code: 'FORBIDDEN' } };
  try {
    const grants = await environmentRepositories.getControlRepository().listTestAccess(scope.principal.userId);
    const live = environmentRepositories.getWorkspaceRepository('live');
    const snapshot = await live.getAdminSnapshot(scope.principal.userId);
    const byUser = new Map(grants.map((grant) => [grant.userId, grant]));
    return { status: 200, jsonBody: { access: snapshot.users.map((user) => ({ userId: user.id, name: user.name, email: user.email, testAllowed: byUser.get(user.id)?.allowed === true, version: byUser.get(user.id)?.version ?? 0 })) } };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function updateEnvironmentAccessHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  if (scope.environment !== 'live') return { status: 403, jsonBody: { error: 'Test access is managed from the Live Admin center.', code: 'FORBIDDEN' } };
  const userId = request.params.userId;
  if (!userId) return { status: 422, jsonBody: { error: 'userId is required', code: 'VALIDATION' } };
  try {
    const body = await requestJson<{ testAllowed?: unknown }>(request);
    if (typeof body.testAllowed !== 'boolean') return { status: 422, jsonBody: { error: 'testAllowed must be a boolean', code: 'VALIDATION' } };
    if (!await environmentRepositories.getWorkspaceRepository('live').getUser(userId)) return { status: 404, jsonBody: { error: 'User not found in the Live directory.', code: 'NOT_FOUND' } };
    const access = await environmentRepositories.getControlRepository().setTestAccess(userId, body.testAllowed, scope.principal.userId);
    return { status: 200, jsonBody: { access, audit: await environmentRepositories.getControlRepository().getAudit() } };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

// Azure Functions reserves /admin/* for its host-management API. Keep the
// application administration surface under a distinct first path segment.
app.http('adminSnapshot', { methods: ['GET'], authLevel: 'anonymous', route: 'platform-admin', handler: adminSnapshotHandler });
app.http('adminCreateTeam', { methods: ['POST'], authLevel: 'anonymous', route: 'platform-admin/teams', handler: createTeamHandler });
app.http('adminUpdateTeam', { methods: ['PATCH'], authLevel: 'anonymous', route: 'platform-admin/teams/{teamId}', handler: updateTeamHandler });
app.http('adminCreateUser', { methods: ['POST'], authLevel: 'anonymous', route: 'platform-admin/users', handler: createUserHandler });
app.http('adminMembership', { methods: ['PUT'], authLevel: 'anonymous', route: 'platform-admin/memberships', handler: upsertMembershipHandler });
app.http('adminAgingSettings', { methods: ['PUT'], authLevel: 'anonymous', route: 'platform-admin/settings/aging', handler: updateAgeSettingsHandler });
app.http('adminEnvironmentAccess', { methods: ['GET'], authLevel: 'anonymous', route: 'platform-admin/environment-access', handler: environmentAccessHandler });
app.http('adminUpdateEnvironmentAccess', { methods: ['PATCH'], authLevel: 'anonymous', route: 'platform-admin/environment-access/{userId}', handler: updateEnvironmentAccessHandler });
