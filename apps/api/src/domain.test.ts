import assert from 'node:assert/strict';
import test from 'node:test';
import { averageMeetingRating, canAcceptTransfer, canAdministerPlatform, canManageTeam, canWriteTeam, currentQuarterId, isValidMeetingRating, issueAgeBand, meetingReviewStatus, meetingScheduledAt, nextConfiguredMeetingDateAfter, nextMeetingDateAfter, nextMeetingDateFor, nextTodoStatus, partitionFor, quarterIdForDate, quarterSummary, validateAgeSettings, validateHierarchy } from './domain.js';
import type { MeetingRecord, TeamRecord } from './domain.js';

test('team partitions are stable and explicit', () => {
  assert.equal(partitionFor('org', 'bremmar'), 'org');
  assert.equal(partitionFor('team', 'leadership'), 'team:leadership');
});

test('quarter summaries distinguish historical, current, and upcoming planning periods', () => {
  const quarters = [
    { id: '2026-q2', label: 'Q2 2026', theme: 'Learn', startDate: '2026-04-01', endDate: '2026-06-30' },
    { id: '2026-q3', label: 'Q3 2026', theme: 'Build', startDate: '2026-07-01', endDate: '2026-09-30' },
    { id: '2026-q4', label: 'Q4 2026', theme: 'Scale', startDate: '2026-10-01', endDate: '2026-12-31' },
  ];
  const summaries = quarters.map((quarter) => quarterSummary(quarter, '2026-09-04T12:00:00Z'));
  assert.deepEqual(summaries.map((quarter) => quarter.status), ['past', 'current', 'upcoming']);
  assert.equal(currentQuarterId(summaries), '2026-q3');
  assert.equal(quarterIdForDate('2026-05-12', quarters), '2026-q2');
  assert.equal(quarterIdForDate('2027-01-01', quarters), undefined);
});

test('meeting recurrence supports weekly and month-end monthly schedules', () => {
  assert.equal(nextMeetingDateFor('2026-09-07', 'weekly'), '2026-09-14');
  assert.equal(nextMeetingDateFor('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextMeetingDateFor('2026-02-28', 'monthly'), '2026-03-28');
  assert.equal(nextMeetingDateAfter('2026-08-31', 'weekly', '2026-09-03'), '2026-09-07');
  assert.equal(nextConfiguredMeetingDateAfter({ meetingCadence: 'monthly', meetingDay: '31' }, '2026-02-28', '2026-02-28'), '2026-03-31');
  assert.equal(nextConfiguredMeetingDateAfter({ meetingCadence: 'weekly', meetingDay: 'Monday' }, '2026-09-09', '2026-09-09'), '2026-09-14');
});

test('meeting review attention states respect exact schedule and agenda-duration boundaries', () => {
  const scheduledAt = Date.parse('2026-09-03T12:00:00.000Z');
  const meeting = { scheduledDate: '2026-09-03', scheduledTime: '12:00 PM', status: 'upcoming' } as MeetingRecord;
  const team = { meetingSections: [{ id: 'ids', label: 'IDS', enabled: true, duration: 60 }] } as TeamRecord;

  assert.equal(meetingScheduledAt(meeting), scheduledAt);
  assert.equal(meetingReviewStatus(meeting, team, scheduledAt), 'upcoming');
  assert.equal(meetingReviewStatus(meeting, team, scheduledAt + 1), 'missed');

  const inProgress = { ...meeting, status: 'in-progress' as const, startedAt: new Date(scheduledAt).toISOString() };
  assert.equal(meetingReviewStatus(inProgress, team, scheduledAt + 60 * 60 * 1000), 'in-progress');
  assert.equal(meetingReviewStatus(inProgress, team, scheduledAt + 60 * 60 * 1000 + 1), 'overdue');
});

test('role capabilities keep viewers read-only', () => {
  assert.equal(canWriteTeam('Viewer'), false);
  assert.equal(canWriteTeam('Member'), true);
  assert.equal(canManageTeam('Member'), false);
  assert.equal(canManageTeam('TeamLead'), true);
  assert.equal(canManageTeam('OrgAdmin'), true);
});

test('meeting ratings accept half points and derive the arithmetic mean', () => {
  assert.equal(isValidMeetingRating(0.5), true);
  assert.equal(isValidMeetingRating(8.5), true);
  assert.equal(isValidMeetingRating(8.25), false);
  assert.equal(isValidMeetingRating(10.5), false);
  assert.equal(averageMeetingRating([{ attendeeId: 'one', rating: 8.5 }, { attendeeId: 'two', rating: 10 }]), 9.25);
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
