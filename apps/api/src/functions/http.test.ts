import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpRequest } from '@azure/functions';
import { signEnvironmentCookie } from '../environment.js';

function request(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) } as unknown as HttpRequest;
}

test('request scope selects only an authenticated and currently granted environment', async () => {
  process.env.LOCAL_POC_MODE = 'true';
  process.env.ENVIRONMENT_COOKIE_SECRET = 'http-scope-test-secret';
  const { isResponse, requestScope } = await import('./http.js');
  const { environmentRepositories } = await import('../data/services.js');

  const testCookie = signEnvironmentCookie('test', process.env.ENVIRONMENT_COOKIE_SECRET);
  const selected = await requestScope(request({ cookie: `bremmar_environment=${testCookie}` }));
  assert.equal(isResponse(selected), false);
  if (!isResponse(selected)) {
    assert.equal(selected.environment, 'test');
    assert.equal(selected.repository.environmentId, 'test');
  }

  const missing = await requestScope(request());
  assert.equal(isResponse(missing), false);
  if (!isResponse(missing)) assert.equal(missing.environment, 'live');

  const tampered = await requestScope(request({ cookie: `bremmar_environment=${testCookie}tampered` }));
  assert.equal(isResponse(tampered), false);
  if (!isResponse(tampered)) assert.equal(tampered.environment, 'live');

  await environmentRepositories.getControlRepository().setTestAccess('ava-khan', false, 'ava-khan');
  const revoked = await requestScope(request({ cookie: `bremmar_environment=${testCookie}` }));
  assert.equal(isResponse(revoked), true);
  if (isResponse(revoked)) assert.equal(revoked.status, 403);
});
