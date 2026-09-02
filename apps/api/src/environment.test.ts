import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryControlPlaneRepository, EnvironmentRepositoryFactory } from './data/environment.js';
import { MemoryWorkspaceRepository } from './data/repository.js';
import { readEnvironmentCookie, signEnvironmentCookie, verifyEnvironmentCookie } from './environment.js';

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
  assert.equal((await factory.getWorkspaceRepository('test').getIssue(beforeTest.id, 'marcus-lee')).detail, 'Test-only context.');

  await factory.getWorkspaceRepository('live').updateTeam('projects', { description: 'Live-only team settings.' }, 'ava-khan');
  assert.notEqual((await factory.getWorkspaceRepository('test').getTeams()).find((team) => team.teamId === 'projects')?.description, 'Live-only team settings.');

  await factory.getWorkspaceRepository('test').upsertMembership({ userId: 'marcus-lee', teamId: 'projects', role: 'Viewer' }, 'ava-khan');
  assert.equal((await factory.getWorkspaceRepository('test').getTeamMembership('projects', 'marcus-lee'))?.role, 'Viewer');
  assert.equal((await factory.getWorkspaceRepository('live').getTeamMembership('projects', 'marcus-lee'))?.role, 'TeamLead');
});
