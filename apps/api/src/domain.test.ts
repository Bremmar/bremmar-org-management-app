import assert from 'node:assert/strict';
import test from 'node:test';
import { canAcceptTransfer, canAdministerPlatform, canManageTeam, canWriteTeam, issueAgeBand, nextConfiguredMeetingDateAfter, nextMeetingDateAfter, nextMeetingDateFor, nextTodoStatus, partitionFor, validateAgeSettings, validateHierarchy } from './domain.js';

test('team partitions are stable and explicit', () => {
  assert.equal(partitionFor('org', 'bremmar'), 'org');
  assert.equal(partitionFor('team', 'leadership'), 'team:leadership');
});

test('meeting recurrence supports weekly and month-end monthly schedules', () => {
  assert.equal(nextMeetingDateFor('2026-09-07', 'weekly'), '2026-09-14');
  assert.equal(nextMeetingDateFor('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextMeetingDateFor('2026-02-28', 'monthly'), '2026-03-28');
  assert.equal(nextMeetingDateAfter('2026-08-31', 'weekly', '2026-09-03'), '2026-09-07');
  assert.equal(nextConfiguredMeetingDateAfter({ meetingCadence: 'monthly', meetingDay: '31' }, '2026-02-28', '2026-02-28'), '2026-03-31');
  assert.equal(nextConfiguredMeetingDateAfter({ meetingCadence: 'weekly', meetingDay: 'Monday' }, '2026-09-09', '2026-09-09'), '2026-09-14');
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

test('issue aging bands use inclusive configured thresholds', () => {
  assert.equal(issueAgeBand(6), 'fresh');
  assert.equal(issueAgeBand(7), 'aging');
  assert.equal(issueAgeBand(14), 'stale');
  assert.equal(issueAgeBand(30), 'critical');
  assert.equal(issueAgeBand(9, { agingDays: 10, staleDays: 20, criticalDays: 30 }), 'fresh');
  assert.equal(validateAgeSettings({ agingDays: 7, staleDays: 14, criticalDays: 30 }), true);
  assert.equal(validateAgeSettings({ agingDays: 14, staleDays: 7, criticalDays: 30 }), false);
});

test('transfer and administration capabilities are separate', () => {
  assert.equal(canAcceptTransfer('Member'), true);
  assert.equal(canAcceptTransfer('Viewer'), false);
  assert.equal(canAdministerPlatform(['PlatformAdmin']), true);
  assert.equal(canAdministerPlatform([]), false);
});

test('hierarchy validation rejects missing parents, duplicates, and cycles', () => {
  assert.equal(validateHierarchy([{ teamId: 'leadership', parentTeamId: null }, { teamId: 'projects', parentTeamId: 'leadership' }]), true);
  assert.equal(validateHierarchy([{ teamId: 'projects', parentTeamId: 'missing' }]), false);
  assert.equal(validateHierarchy([{ teamId: 'a', parentTeamId: 'b' }, { teamId: 'a', parentTeamId: null }]), false);
  assert.equal(validateHierarchy([{ teamId: 'a', parentTeamId: 'b' }, { teamId: 'b', parentTeamId: 'a' }]), false);
});
