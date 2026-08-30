import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

async function healthHandler(_request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  return { status: 200, jsonBody: { status: 'ok', service: 'eos-api' } };
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthHandler,
});
