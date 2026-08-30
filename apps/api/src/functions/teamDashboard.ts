import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { getClientPrincipal } from '../auth.js';
import { assertTeamMember, repository } from '../data/repository.js';

async function teamDashboardHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const principal = getClientPrincipal(request);
  if (!principal) return { status: 401, jsonBody: { error: 'Authentication required' } };

  const teamId = request.params.teamId;
  if (!teamId) return { status: 400, jsonBody: { error: 'teamId is required' } };

  try {
    const membership = await assertTeamMember(principal, teamId);
    const dashboard = await repository.getTeamDashboard(teamId);
    return { status: 200, jsonBody: { dashboard, membership: { role: membership.role } } };
  } catch (error) {
    if (error instanceof Error && error.message === 'TEAM_ACCESS_DENIED') return { status: 403, jsonBody: { error: 'You do not have access to this team' } };
    return { status: 500, jsonBody: { error: 'Unable to load the team dashboard' } };
  }
}

app.http('teamDashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'teams/{teamId}/dashboard',
  handler: teamDashboardHandler,
});
