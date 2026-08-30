import { CosmosClient, type Container } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { ClientPrincipal } from '../auth.js';
import { partitionFor, type DashboardSummary, type TeamMembership } from '../domain.js';

export interface WorkspaceRepository {
  getTeamMembership(teamId: string, userId: string): Promise<TeamMembership | null>;
  getTeamDashboard(teamId: string): Promise<DashboardSummary>;
}

interface WorkspaceDocument {
  id: string;
  kind: string;
  pk: string;
  teamId?: string;
  userId?: string;
  role?: TeamMembership['role'];
  active?: boolean;
  status?: string;
}

function emptyDashboard(teamId: string): DashboardSummary {
  return {
    teamId,
    rocks: { total: 0, onTrack: 0, offTrack: 0, complete: 0 },
    todos: { total: 0, done: 0, open: 0, notDone: 0 },
    issues: { total: 0, open: 0, inIds: 0, solved: 0 },
    metrics: { total: 0, onTrack: 0, offTrack: 0 },
  };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly memberships: TeamMembership[] = [
    {
      id: 'membership-ava-leadership',
      kind: 'teamMembership',
      pk: partitionFor('team', 'leadership'),
      orgId: 'bremmar',
      teamId: 'leadership',
      userId: 'ava-khan',
      role: 'TeamLead',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'system',
      version: 1,
    },
  ];

  async getTeamMembership(teamId: string, userId: string) {
    return this.memberships.find((membership) => membership.teamId === teamId && membership.userId === userId && membership.active) ?? null;
  }

  async getTeamDashboard(teamId: string) {
    return emptyDashboard(teamId);
  }
}

export class CosmosWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly container: Container) {}

  static fromEnvironment() {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const database = process.env.COSMOS_DATABASE;
    const containerName = process.env.COSMOS_CONTAINER;
    if (!endpoint || !database || !containerName) return null;
    const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
    return new CosmosWorkspaceRepository(client.database(database).container(containerName));
  }

  async getTeamMembership(teamId: string, userId: string) {
    const query = {
      query: 'SELECT TOP 1 * FROM c WHERE c.pk = @pk AND c.kind = "teamMembership" AND c.teamId = @teamId AND c.userId = @userId AND c.active = true',
      parameters: [
        { name: '@pk', value: partitionFor('team', teamId) },
        { name: '@teamId', value: teamId },
        { name: '@userId', value: userId },
      ],
    };
    const { resources } = await this.container.items.query<WorkspaceDocument>(query, { partitionKey: partitionFor('team', teamId) }).fetchAll();
    const match = resources[0];
    if (!match || match.kind !== 'teamMembership' || !match.role) return null;
    return {
      ...match,
      kind: 'teamMembership' as const,
      teamId,
      userId,
      role: match.role,
      active: true,
    } as TeamMembership;
  }

  async getTeamDashboard(teamId: string) {
    const query = {
      query: 'SELECT c.kind, c.status FROM c WHERE c.pk = @pk AND (c.kind = "rock" OR c.kind = "todo" OR c.kind = "issue" OR c.kind = "scorecardMetric")',
      parameters: [{ name: '@pk', value: partitionFor('team', teamId) }],
    };
    const { resources } = await this.container.items.query<Pick<WorkspaceDocument, 'kind' | 'status'>>(query, { partitionKey: partitionFor('team', teamId) }).fetchAll();
    const summary = emptyDashboard(teamId);
    for (const record of resources) {
      if (record.kind === 'rock') {
        summary.rocks.total += 1;
        if (record.status === 'on-track') summary.rocks.onTrack += 1;
        if (record.status === 'off-track') summary.rocks.offTrack += 1;
        if (record.status === 'complete') summary.rocks.complete += 1;
      }
      if (record.kind === 'todo') {
        summary.todos.total += 1;
        if (record.status === 'done') summary.todos.done += 1;
        if (record.status === 'open') summary.todos.open += 1;
        if (record.status === 'not-done') summary.todos.notDone += 1;
      }
      if (record.kind === 'issue') {
        summary.issues.total += 1;
        if (record.status === 'open') summary.issues.open += 1;
        if (record.status === 'in-ids') summary.issues.inIds += 1;
        if (record.status === 'solved') summary.issues.solved += 1;
      }
      if (record.kind === 'scorecardMetric') {
        summary.metrics.total += 1;
        if (record.status === 'on-track') summary.metrics.onTrack += 1;
        if (record.status === 'off-track') summary.metrics.offTrack += 1;
      }
    }
    return summary;
  }
}

export const repository: WorkspaceRepository = CosmosWorkspaceRepository.fromEnvironment() ?? new MemoryWorkspaceRepository();

export async function assertTeamMember(principal: ClientPrincipal, teamId: string) {
  const membership = await repository.getTeamMembership(teamId, principal.userId);
  if (!membership) throw new Error('TEAM_ACCESS_DENIED');
  return membership;
}
