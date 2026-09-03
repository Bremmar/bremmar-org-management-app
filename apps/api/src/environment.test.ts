import assert from 'node:assert/strict';
import test from 'node:test';
import type { TableEntity, TableEntityResult, TransactionAction } from '@azure/data-tables';
import { AzureTableControlPlaneRepository, MemoryControlPlaneRepository, EnvironmentRepositoryFactory } from './data/environment.js';
import { MemoryWorkspaceRepository } from './data/repository.js';
import { readEnvironmentCookie, signEnvironmentCookie, verifyEnvironmentCookie } from './environment.js';

function tableClientStub() {
  type Entity = TableEntity<Record<string, unknown>> & { etag: string };
  const entities = new Map<string, Entity>();
  let nextEtag = 0;
  const keyFor = (partitionKey: string, rowKey: string) => `${partitionKey}/${rowKey}`;
  const statusError = (statusCode: number) => Object.assign(new Error(`Table status ${statusCode}`), { statusCode });
  const stored = (entity: TableEntity<Record<string, unknown>>): Entity => ({ ...entity, etag: `etag-${++nextEtag}` });

  const client = {
    async createEntity(entity: TableEntity<Record<string, unknown>>) {
      const key = keyFor(entity.partitionKey, entity.rowKey);
      if (entities.has(key)) throw statusError(409);
      entities.set(key, stored(entity));
      return {};
    },
    async getEntity<T extends object>(partitionKey: string, rowKey: string) {
      const entity = entities.get(keyFor(partitionKey, rowKey));
      if (!entity) throw statusError(404);
      return { ...entity } as TableEntityResult<T>;
    },
    listEntities<T extends object>(options: { queryOptions?: { filter?: string } } = {}) {
      const kind = options.queryOptions?.filter?.match(/kind eq '([^']+)'/)?.[1];
      return (async function* () {
        for (const entity of entities.values()) {
          if (kind && entity.kind !== kind) continue;
          yield { ...entity } as TableEntityResult<T>;
        }
      }());
    },
    async submitTransaction(actions: TransactionAction[]) {
      const pending = new Map(entities);
      const subResponses: Array<{ status: number; rowKey: string }> = [];
      for (const action of actions) {
        const [operation, entity, _mode, options] = action as ['create' | 'update', TableEntity<Record<string, unknown>>, string?, { etag?: string }?];
        const key = keyFor(entity.partitionKey, entity.rowKey);
        if (operation === 'create') {
          if (pending.has(key)) throw statusError(409);
          pending.set(key, stored(entity));
          subResponses.push({ status: 201, rowKey: entity.rowKey });
          continue;
        }
        const previous = pending.get(key);
        if (!previous) throw statusError(404);
        if (options?.etag && options.etag !== previous.etag) throw statusError(412);
        pending.set(key, stored(entity));
        subResponses.push({ status: 204, rowKey: entity.rowKey });
      }
      entities.clear();
      for (const [key, entity] of pending) entities.set(key, entity);
      return { status: 202, subResponses };
    },
  };

  return client as unknown as ConstructorParameters<typeof AzureTableControlPlaneRepository>[0];
}

test('environment cookies are signed and reject tampering or malformed values', () => {
  const secret = 'unit-test-secret';
  const cookie = signEnvironmentCookie('test', secret);
  assert.equal(verifyEnvironmentCookie(cookie, secret), 'test');
  const request = (value?: string) => ({ headers: new Headers(value ? { cookie: `bremmar_environment=${value}` } : {}) }) as never;
  assert.equal(readEnvironmentCookie(request(cookie), secret), 'test');
  assert.equal(readEnvironmentCookie(request(`${cookie}tampered`), secret), 'live');
  assert.equal(readEnvironmentCookie(request('not-a-cookie'), secret), 'live');
  assert.equal(readEnvironmentCookie(request(), secret), 'live');
  assert.equal(verifyEnvironmentCookie(`${cookie}tampered`, secret), null);
  assert.equal(verifyEnvironmentCookie('test.not-a-signature', secret), null);
  assert.equal(verifyEnvironmentCookie(undefined, secret), null);
});

test('Test access is hidden by default, requires an OrgAdmin grant, and is audited', async () => {
  const control = new MemoryControlPlaneRepository({ initialTestUserIds: [], orgAdminUserIds: ['admin-id'] });
  assert.deepEqual((await control.getEnvironmentSession('member-id')).availableEnvironments.map((environment) => environment.id), ['live']);
  assert.equal(await control.canAccess('member-id', 'test'), false);
  await assert.rejects(control.setTestAccess('member-id', true, 'member-id'), { code: 'FORBIDDEN' });
  await control.setTestAccess('member-id', true, 'admin-id');
  assert.equal(await control.canAccess('member-id', 'test'), true);
  await control.setTestAccess('member-id', false, 'admin-id');
  assert.equal(await control.canAccess('member-id', 'test'), false);
  assert.deepEqual((await control.getAudit()).map((event) => event.action), ['revoked', 'granted']);
});

test('Azure Table control plane preserves environment metadata, grants, audit, and concurrency state', async () => {
  const control = new AzureTableControlPlaneRepository(tableClientStub(), async (userId) => userId === 'admin-id');
  await control.ensureEnvironmentMetadata();
  assert.deepEqual((await control.getEnvironmentMetadata()).map((definition) => definition.environmentId), ['live', 'test']);
  assert.equal(await control.canAccess('member-id', 'test'), false);

  await control.setTestAccess('member-id', true, 'admin-id');
  assert.equal(await control.canAccess('member-id', 'test'), true);
  assert.equal((await control.listTestAccess('admin-id')).find((grant) => grant.userId === 'member-id')?.allowed, true);

  await control.setTestAccess('member-id', false, 'admin-id');
  assert.equal(await control.canAccess('member-id', 'test'), false);
  assert.deepEqual((await control.getAudit()).map((event) => event.action), ['revoked', 'granted']);
  await assert.rejects(control.setTestAccess('member-id', true, 'member-id'), { code: 'FORBIDDEN' });
});

test('workspace repositories keep identical IDs and memberships isolated by environment', async () => {
  const live = new MemoryWorkspaceRepository('live');
  const testWorkspace = new MemoryWorkspaceRepository('test');
  const control = new MemoryControlPlaneRepository({ initialTestUserIds: ['ava-khan'] });
  const factory = new EnvironmentRepositoryFactory({ live, test: testWorkspace, control });
  const beforeLive = await factory.getWorkspaceRepository('live').getIssue('issue-project-scope', 'marcus-lee');
  const beforeTest = await factory.getWorkspaceRepository('test').getIssue('issue-project-scope', 'marcus-lee');
  assert.equal(beforeLive.id, beforeTest.id);
  await factory.getWorkspaceRepository('test').updateIssue(beforeTest.id, { detail: 'Test-only context.' }, 'marcus-lee', beforeTest.version);
  assert.equal((await factory.getWorkspaceRepository('live').getIssue(beforeLive.id, 'marcus-lee')).detail, beforeLive.detail);
  assert.equal((await factory.getWorkspaceRepository('test').getIssue(beforeTest.id, 'marcus-lee')).detail, '<p>Test-only context.</p>');

  await factory.getWorkspaceRepository('live').updateTeam('projects', { description: 'Live-only team settings.' }, 'ava-khan');
  assert.notEqual((await factory.getWorkspaceRepository('test').getTeams()).find((team) => team.teamId === 'projects')?.description, 'Live-only team settings.');

  await factory.getWorkspaceRepository('test').upsertMembership({ userId: 'marcus-lee', teamId: 'projects', role: 'Viewer' }, 'ava-khan');
  assert.equal((await factory.getWorkspaceRepository('test').getTeamMembership('projects', 'marcus-lee'))?.role, 'Viewer');
  assert.equal((await factory.getWorkspaceRepository('live').getTeamMembership('projects', 'marcus-lee'))?.role, 'TeamLead');
});
