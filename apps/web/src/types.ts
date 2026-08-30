export type ViewId = 'overview' | 'meeting' | 'rocks' | 'todos' | 'issues' | 'scorecard' | 'admin';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'solved';
export type MeetingStatus = 'upcoming' | 'in-progress' | 'closed';
export type MetricStatus = 'on-track' | 'off-track';

export type MeetingSection =
  | 'segue'
  | 'scorecard'
  | 'rock-review'
  | 'headlines'
  | 'todo-review'
  | 'ids'
  | 'conclude';

export type UserRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';

export interface User {
  id: string;
  name: string;
  initials: string;
  email: string;
  role: UserRole;
  accent: string;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  description: string;
  memberCount: number;
  meetingDay: string;
  meetingTime: string;
  accent: string;
  initials: string;
}

export interface Quarter {
  id: string;
  label: string;
  theme: string;
  startDate: string;
  endDate: string;
  daysRemaining: number;
}

export interface Rock {
  id: string;
  teamId: string;
  title: string;
  description: string;
  ownerId: string;
  status: RockStatus;
  progress: number;
  milestonesDone: number;
  milestonesTotal: number;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

export interface Todo {
  id: string;
  teamId: string;
  title: string;
  ownerId: string;
  dueDate: string;
  status: TodoStatus;
  origin: string;
  isMine?: boolean;
}

export interface Issue {
  id: string;
  teamId: string;
  title: string;
  detail: string;
  category: string;
  priority: number;
  status: IssueStatus;
  raisedById: string;
  age: string;
  linkedRockId?: string;
  idsNote?: string;
}

export interface ScorecardMetric {
  id: string;
  teamId: string;
  label: string;
  target: string;
  actual: string;
  unit: string;
  ownerId: string;
  status: MetricStatus;
  trend: 'up' | 'down' | 'flat';
  trendLabel: string;
}

export interface Headline {
  id: string;
  teamId: string;
  authorId: string;
  type: 'win' | 'concern';
  title: string;
  detail: string;
  createdAt: string;
  issueId?: string;
}

export interface MeetingInstance {
  id: string;
  teamId: string;
  label: string;
  dateLabel: string;
  status: MeetingStatus;
  facilitatorId: string;
  attendeeIds: string[];
  lastRating: number;
  agendaProgress: number;
  agendaTotal: number;
  idsSolved: number;
  idsTotal: number;
  recap: string;
}

export interface ActivityItem {
  id: string;
  actorId: string;
  action: string;
  target: string;
  time: string;
  type: 'rock' | 'todo' | 'issue' | 'meeting';
}

export interface Workspace {
  currentUser: User;
  quarter: Quarter;
  teams: Team[];
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  metrics: ScorecardMetric[];
  headlines: Headline[];
  meetings: MeetingInstance[];
  activity: ActivityItem[];
}

export const agendaSections: Array<{
  id: MeetingSection;
  label: string;
  shortLabel: string;
  duration: number;
}> = [
  { id: 'segue', label: 'Segue', shortLabel: 'Segue', duration: 5 },
  { id: 'scorecard', label: 'Scorecard', shortLabel: 'Scorecard', duration: 5 },
  { id: 'rock-review', label: 'Rock Review', shortLabel: 'Rocks', duration: 5 },
  { id: 'headlines', label: 'Customer & Employee Headlines', shortLabel: 'Headlines', duration: 5 },
  { id: 'todo-review', label: 'To-Do Review', shortLabel: 'To-Dos', duration: 5 },
  { id: 'ids', label: 'IDS', shortLabel: 'IDS', duration: 60 },
  { id: 'conclude', label: 'Conclude', shortLabel: 'Conclude', duration: 5 },
];
