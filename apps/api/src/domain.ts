export type UserRole = 'OrgAdmin' | 'TeamLead' | 'Member' | 'Viewer';

export type RecordKind =
  | 'organization'
  | 'user'
  | 'team'
  | 'teamMembership'
  | 'quarter'
  | 'meeting'
  | 'rock'
  | 'todo'
  | 'issue'
  | 'scorecardMetric'
  | 'headline'
  | 'auditEvent';

export type RockStatus = 'on-track' | 'off-track' | 'complete';
export type TodoStatus = 'open' | 'done' | 'not-done';
export type IssueStatus = 'open' | 'in-ids' | 'solved';

export interface WorkspaceRecord {
  id: string;
  kind: RecordKind;
  pk: string;
  orgId: string;
  teamId?: string;
  quarterId?: string;
  meetingId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface TeamMembership extends WorkspaceRecord {
  kind: 'teamMembership';
  teamId: string;
  userId: string;
  role: UserRole;
  active: boolean;
}

export interface DashboardSummary {
  teamId: string;
  rocks: { total: number; onTrack: number; offTrack: number; complete: number };
  todos: { total: number; done: number; open: number; notDone: number };
  issues: { total: number; open: number; inIds: number; solved: number };
  metrics: { total: number; onTrack: number; offTrack: number };
}

export const partitionFor = (scope: 'org' | 'team', id: string) => scope === 'org' ? 'org' : `team:${id}`;

export function canWriteTeam(role: UserRole) {
  return role === 'OrgAdmin' || role === 'TeamLead' || role === 'Member';
}

export function canManageTeam(role: UserRole) {
  return role === 'OrgAdmin' || role === 'TeamLead';
}

export function nextTodoStatus(status: TodoStatus): TodoStatus {
  return status === 'done' ? 'open' : 'done';
}
