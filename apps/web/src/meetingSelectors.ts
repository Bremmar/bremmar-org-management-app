import { quarterIdForRecord } from './types';
import type { MeetingInstance, Quarter } from './types';

export function rollingMeetingsForTeam(meetings: readonly MeetingInstance[], teamId: string) {
  return meetings.filter((meeting) => meeting.teamId === teamId);
}

export function meetingsForQuarter(meetings: readonly MeetingInstance[], quarters: readonly Quarter[], quarterId: string) {
  return meetings.filter((meeting) => quarterIdForRecord(meeting, quarters) === quarterId);
}
