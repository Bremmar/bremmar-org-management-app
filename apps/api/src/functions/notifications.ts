import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { expectedVersion, isResponse, repositoryErrorResponse, requestScope } from './http.js';

async function notificationsHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  try {
    const notifications = await repository.getNotifications(principal.userId);
    return { status: 200, jsonBody: { notifications } };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

async function markNotificationReadHandler(request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  const scope = await requestScope(request);
  if (isResponse(scope)) return scope;
  const { principal, repository } = scope;
  const notificationId = request.params.notificationId;
  if (!notificationId) return { status: 422, jsonBody: { error: 'notificationId is required', code: 'VALIDATION' } };
  try {
    const notification = await repository.markNotificationRead(notificationId, principal.userId, expectedVersion(request));
    return { status: 200, headers: { ETag: `W/\"${notification.version}\"` }, jsonBody: notification };
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

app.http('notifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications',
  handler: notificationsHandler,
});

app.http('markNotificationRead', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'notifications/{notificationId}/read',
  handler: markNotificationReadHandler,
});
