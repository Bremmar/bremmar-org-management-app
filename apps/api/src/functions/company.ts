import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { isResponse, repositoryErrorResponse, requestScope, responseWithEtag } from './http.js';

async function companyOverviewHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const overview = await repository.getCompanyOverview(principal.userId);
    return responseWithEtag(overview, overview.etag);
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('companyOverview', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'company/overview',
  handler: companyOverviewHandler,
});
