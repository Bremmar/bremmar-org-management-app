import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { isResponse, repositoryErrorResponse, requestScope } from './http.js';

async function teamDashboardHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;

  const teamId = request.params.teamId;
  if (!teamId) return { status: 400, jsonBody: { error: 'teamId is required' } };

  try {
    const membership = await repository.getTeamMembership(teamId, principal.userId);
    const leadership = await repository.getLeadershipMembership(principal.userId);
    if (!membership && !leadership) return { status: 403, jsonBody: { error: 'You do not have access to this team' } };
    const dashboard = await repository.getTeamDashboard(teamId, principal.userId);
    return { status: 200, jsonBody: { dashboard, membership: { role: membership?.role ?? 'Viewer', readOnly: !membership } } };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('teamDashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'teams/{teamId}/dashboard',
  handler: teamDashboardHandler,
});
