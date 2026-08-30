import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageTeam, canWriteTeam, nextTodoStatus, partitionFor } from './domain.js';

test('team partitions are stable and explicit', () => {
  assert.equal(partitionFor('org', 'bremmar'), 'org');
  assert.equal(partitionFor('team', 'leadership'), 'team:leadership');
});

test('role capabilities keep viewers read-only', () => {
  assert.equal(canWriteTeam('Viewer'), false);
  assert.equal(canWriteTeam('Member'), true);
  assert.equal(canManageTeam('Member'), false);
  assert.equal(canManageTeam('TeamLead'), true);
  assert.equal(canManageTeam('OrgAdmin'), true);
});

test('todo status toggles between open and done', () => {
  assert.equal(nextTodoStatus('open'), 'done');
  assert.equal(nextTodoStatus('done'), 'open');
  assert.equal(nextTodoStatus('not-done'), 'done');
});
