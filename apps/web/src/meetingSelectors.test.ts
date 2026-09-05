import { describe, expect, it } from 'vitest';
import { canResumeMeeting, meetingsForQuarter, rollingMeetingsForTeam } from './meetingSelectors';
import type { MeetingInstance, Quarter } from './types';

const quarters: Quarter[] = [
  { id: '2026-q3', label: 'Q3 2026', theme: 'Build', startDate: '2026-07-01', endDate: '2026-09-30', status: 'current', daysRemaining: 25 },
  { id: '2026-q4', label: 'Q4 2026', theme: 'Scale', startDate: '2026-10-01', endDate: '2026-12-31', status: 'upcoming', daysRemaining: 0, daysUntilStart: 25 },
];

function meeting(id: string, teamId: string, scheduledDate: string, quarterId?: string) {
  return { id, teamId, scheduledDate, quarterId } as MeetingInstance;
}

describe('meeting selectors', () => {
  it('only lets the recorded facilitator resume a live meeting', () => {
    const live = { status: 'in-progress', facilitatorId: 'facilitator' } as const;

    expect(canResumeMeeting(live, 'facilitator')).toBe(true);
    expect(canResumeMeeting(live, 'another-user')).toBe(false);
    expect(canResumeMeeting({ status: 'upcoming', facilitatorId: 'facilitator' }, 'another-user')).toBe(true);
  });

  it('keeps rolling team occurrences visible across quarter boundaries', () => {
    const meetings = [
      meeting('current-quarter', 'leadership', '2026-09-28', '2026-q3'),
      meeting('next-quarter', 'leadership', '2026-10-05'),
      meeting('other-team', 'projects', '2026-10-05', '2026-q4'),
    ];

    expect(rollingMeetingsForTeam(meetings, 'leadership').map((item) => item.id)).toEqual(['current-quarter', 'next-quarter']);
  });

  it('uses the selected quarter for history and repairs missing or malformed quarter IDs', () => {
    const meetings = [
      meeting('current-quarter', 'leadership', '2026-09-28', '2026-q3'),
      meeting('legacy', 'leadership', '2026-09-21', '2026-09-21'),
      meeting('next-quarter', 'leadership', '2026-10-05'),
    ];

    expect(meetingsForQuarter(meetings, quarters, '2026-q3').map((item) => item.id)).toEqual(['current-quarter', 'legacy']);
    expect(meetingsForQuarter(meetings, quarters, '2026-q4').map((item) => item.id)).toEqual(['next-quarter']);
  });
});
