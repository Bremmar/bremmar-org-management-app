import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpRequest } from '@azure/functions';
import { clearIdentityResolutionCache, lookupEntraObjectId, type AuthFetch, getClientPrincipal, resolveClientPrincipal, resolveClientPrincipalIdentity, IdentityResolutionError } from './auth.js';

function requestFor(principal: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(principal), 'utf8').toString('base64');
  return { headers: new Headers({ 'x-ms-client-principal': encoded }) } as unknown as HttpRequest;
}

async function withEnvironment(values: Record<string, string | undefined>, operation: () => Promise<void>) {
  const previous = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await operation();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const graphEnvironment = {
  ENTRA_TENANT_ID: 'tenant-id',
  ENTRA_GRAPH_CLIENT_ID: 'graph-client-id',
  ENTRA_GRAPH_CLIENT_SECRET: 'graph-client-secret',
  GRAPH_TENANT_ID: undefined,
  GRAPH_CLIENT_ID: undefined,
  GRAPH_CLIENT_SECRET: undefined,
  ENTRA_CLIENT_ID: undefined,
  ENTRA_CLIENT_SECRET: undefined,
  AZURE_TENANT_ID: undefined,
  IDENTITY_ENDPOINT: undefined,
  IDENTITY_HEADER: undefined,
  MSI_ENDPOINT: undefined,
  MSI_SECRET: undefined,
};

test('Entra object ID claims take precedence over the Static Web Apps user ID', async () => {
  clearIdentityResolutionCache();
  const request = requestFor({
    identityProvider: 'aad',
    userId: 'static-web-app-user-id',
    userDetails: 'admin@example.com',
    userRoles: ['authenticated'],
    claims: [{ typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: 'CA795A1D-6402-4335-9141-D40E7F078812' }],
  });
  const principal = getClientPrincipal(request);
  assert.equal(principal?.userId, 'static-web-app-user-id');
  const resolved = await resolveClientPrincipal(request, { fetch: async () => { throw new Error('Graph should not be called'); } });
  assert.equal(resolved?.userId, 'ca795a1d-6402-4335-9141-d40e7f078812');
});

test('Entra users are resolved through Graph when the API header only has the SWA ID', async () => {
  clearIdentityResolutionCache();
  await withEnvironment(graphEnvironment, async () => {
    const calls: Array<{ url: string; init: Parameters<AuthFetch>[1] }> = [];
    const fetch: AuthFetch = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('/oauth2/v2.0/token')) {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get('client_id'), 'graph-client-id');
        assert.equal(body.get('scope'), 'https://graph.microsoft.com/.default');
        assert.equal(body.get('grant_type'), 'client_credentials');
        return { ok: true, status: 200, json: async () => ({ access_token: 'graph-access-token' }) };
      }
      const urlObject = new URL(url);
      assert.equal(urlObject.pathname, '/v1.0/users');
      assert.match(urlObject.searchParams.get('$filter') ?? '', /admin@example\.com/);
      assert.equal(init.headers?.Authorization, 'Bearer graph-access-token');
      return { ok: true, status: 200, json: async () => ({ value: [{ id: 'CA795A1D-6402-4335-9141-D40E7F078812', mail: 'admin@example.com', userPrincipalName: 'admin@example.com' }] }) };
    };
    const resolved = await resolveClientPrincipal(requestFor({
      identityProvider: 'aad',
      userId: 'static-web-app-user-id',
      userDetails: 'admin@example.com',
      userRoles: ['authenticated'],
    }), { fetch });
    assert.ok(resolved);
    assert.equal(resolved.userId, 'ca795a1d-6402-4335-9141-d40e7f078812');
    assert.equal(calls.length, 2);
  });
});

test('Graph identity lookups are cached briefly for the same SWA principal', async () => {
  clearIdentityResolutionCache();
  await withEnvironment(graphEnvironment, async () => {
    let callCount = 0;
    const fetch: AuthFetch = async (url) => {
      callCount += 1;
      if (url.includes('/oauth2/v2.0/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'graph-access-token' }) };
      return { ok: true, status: 200, json: async () => ({ value: [{ id: 'ca795a1d-6402-4335-9141-d40e7f078812' }] }) };
    };
    const principal = getClientPrincipal(requestFor({ identityProvider: 'aad', userId: 'static-web-app-user-id', userDetails: 'admin@example.com', userRoles: ['authenticated'] }))!;
    await resolveClientPrincipalIdentity(principal, { fetch, now: () => 1_000 });
    await resolveClientPrincipalIdentity(principal, { fetch, now: () => 1_001 });
    assert.equal(callCount, 2);
  });
});

test('directory profile linking resolves an email to the normalized Entra object ID', async () => {
  await withEnvironment(graphEnvironment, async () => {
    const fetch: AuthFetch = async (url) => {
      if (url.includes('/oauth2/v2.0/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'graph-access-token' }) };
      return { ok: true, status: 200, json: async () => ({ value: [{ id: 'CA795A1D-6402-4335-9141-D40E7F078812' }] }) };
    };
    assert.equal(await lookupEntraObjectId('new-user@example.com', { fetch }), 'ca795a1d-6402-4335-9141-d40e7f078812');
  });
});

test('Entra identity resolution fails closed when Graph credentials are missing', async () => {
  clearIdentityResolutionCache();
  await withEnvironment({
    ENTRA_TENANT_ID: undefined,
    ENTRA_GRAPH_CLIENT_ID: undefined,
    ENTRA_GRAPH_CLIENT_SECRET: undefined,
    GRAPH_TENANT_ID: undefined,
    GRAPH_CLIENT_ID: undefined,
    GRAPH_CLIENT_SECRET: undefined,
    ENTRA_CLIENT_ID: undefined,
    ENTRA_CLIENT_SECRET: undefined,
    AZURE_TENANT_ID: undefined,
    IDENTITY_ENDPOINT: undefined,
    IDENTITY_HEADER: undefined,
    MSI_ENDPOINT: undefined,
    MSI_SECRET: undefined,
  }, async () => {
    await assert.rejects(
      () => resolveClientPrincipalIdentity({ userId: 'static-web-app-user-id', userDetails: 'admin@example.com', identityProvider: 'aad', userRoles: ['authenticated'] }),
      (error: unknown) => error instanceof IdentityResolutionError && error.message.includes('not configured'),
    );
  });
});

test('non-Entra providers keep their provider-specific user ID', async () => {
  const principal = { userId: 'github-user', userDetails: 'github-user', identityProvider: 'github', userRoles: ['authenticated'] };
  const resolved = await resolveClientPrincipalIdentity(principal);
  assert.equal(resolved.userId, 'github-user');
});
