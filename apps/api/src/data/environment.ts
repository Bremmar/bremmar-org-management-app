import { CosmosClient, type Container } from '@azure/cosmos';
import {
  canAdministerPlatform,
  type EnvironmentId,
  type EnvironmentSummary,
  type WorkspaceRecord,
} from '../domain.js';
import { MemoryWorkspaceRepository, RepositoryError, type WorkspaceRepository } from './repository.js';

const CONTROL_PARTITION = 'org';
const ORG_ID = process.env.BREMMAR_ORG_ID ?? 'bremmar';
const nowIso = () => new Date().toISOString();

export interface EnvironmentAccessGrant {
  id: string;
  kind: 'environmentAccessGrant';
  pk: string;
  orgId: string;
  userId: string;
  environmentId: 'test';
  allowed: boolean;
  grantedAt?: string;
  grantedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  cosmosEtag?: string;
}

export interface EnvironmentDefinition {
  id: string;
  kind: 'environmentDefinition';
  pk: string;
  orgId: string;
  environmentId: EnvironmentId;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentAccessAudit {
  id: string;
  kind: 'environmentAccessAudit';
  pk: string;
  orgId: string;
  environmentId: 'control';
  actorId: string;
  targetUserId: string;
  action: 'granted' | 'revoked';
  createdAt: string;
}

export interface EnvironmentAccessView {
  userId: string;
  allowed: boolean;
  grantedAt?: string;
  grantedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
  version: number;
}

export interface ControlPlaneRepository {
  getEnvironmentMetadata(): Promise<EnvironmentDefinition[]>;
  getEnvironmentSession(userId: string): Promise<{ currentEnvironment: EnvironmentId; availableEnvironments: EnvironmentSummary[]; canSwitchToTest: boolean }>;
  canAccess(userId: string, environment: EnvironmentId): Promise<boolean>;
  listTestAccess(actorId: string): Promise<EnvironmentAccessView[]>;
  setTestAccess(targetUserId: string, allowed: boolean, actorId: string): Promise<EnvironmentAccessView>;
  seedTestAccess(userIds: readonly string[], actorId?: string): Promise<void>;
  getAudit(): Promise<EnvironmentAccessAudit[]>;
}

export interface MemoryControlPlaneOptions {
  initialTestUserIds?: readonly string[];
  orgAdminUserIds?: readonly string[];
  isOrgAdmin?: (userId: string) => Promise<boolean> | boolean;
}

function grantId(userId: string) {
  return `environment-access-test-${userId}`;
}

const defaultEnvironmentDefinitions = (): EnvironmentDefinition[] => {
  const timestamp = nowIso();
  return [
    { id: 'environment-live', kind: 'environmentDefinition', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'live', label: 'Live', active: true, createdAt: timestamp, updatedAt: timestamp },
    { id: 'environment-test', kind: 'environmentDefinition', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'test', label: 'Test', active: true, createdAt: timestamp, updatedAt: timestamp },
  ];
};

function environmentSummary(canAccessTest: boolean, definitions = defaultEnvironmentDefinitions()): EnvironmentSummary[] {
  return definitions
    .filter((definition) => definition.active && (definition.environmentId === 'live' || (definition.environmentId === 'test' && canAccessTest)))
    .sort((left, right) => (left.environmentId === 'live' ? -1 : right.environmentId === 'live' ? 1 : left.label.localeCompare(right.label)))
    .map((definition) => ({ id: definition.environmentId, label: definition.label, canAccess: true }));
}

export class MemoryControlPlaneRepository implements ControlPlaneRepository {
  private readonly grants = new Map<string, EnvironmentAccessGrant>();
  private readonly audit: EnvironmentAccessAudit[] = [];
  private readonly definitions: EnvironmentDefinition[];
  private readonly orgAdminUserIds: Set<string>;
  private readonly isOrgAdminOverride?: (userId: string) => Promise<boolean> | boolean;

  constructor(options: MemoryControlPlaneOptions = {}) {
    this.definitions = defaultEnvironmentDefinitions();
    this.orgAdminUserIds = new Set(options.orgAdminUserIds ?? ['ava-khan']);
    this.isOrgAdminOverride = options.isOrgAdmin;
    for (const userId of options.initialTestUserIds ?? ['ava-khan']) {
      this.grants.set(userId, this.makeGrant(userId, true, 'bootstrap'));
    }
  }

  private makeGrant(userId: string, allowed: boolean, actorId: string, previous?: EnvironmentAccessGrant): EnvironmentAccessGrant {
    const timestamp = nowIso();
    return {
      id: grantId(userId),
      kind: 'environmentAccessGrant',
      pk: CONTROL_PARTITION,
      orgId: ORG_ID,
      userId,
      environmentId: 'test',
      allowed,
      grantedAt: allowed ? (previous?.grantedAt ?? timestamp) : previous?.grantedAt,
      grantedBy: allowed ? (previous?.grantedBy ?? actorId) : previous?.grantedBy,
      revokedAt: allowed ? previous?.revokedAt : timestamp,
      revokedBy: allowed ? previous?.revokedBy : actorId,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedBy: actorId,
      version: (previous?.version ?? 0) + 1,
    };
  }

  private async requireOrgAdmin(actorId: string) {
    if (this.isOrgAdminOverride ? await this.isOrgAdminOverride(actorId) : this.orgAdminUserIds.has(actorId)) return;
    throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required to manage Test access.');
  }

  async getEnvironmentSession(userId: string) {
    const canSwitchToTest = await this.canAccess(userId, 'test');
    return { currentEnvironment: 'live' as const, availableEnvironments: environmentSummary(canSwitchToTest, this.definitions), canSwitchToTest };
  }

  async getEnvironmentMetadata() {
    return structuredClone(this.definitions);
  }

  async canAccess(userId: string, environment: EnvironmentId) {
    if (environment === 'live') return Boolean(userId.trim());
    return this.grants.get(userId)?.allowed === true;
  }

  async listTestAccess(actorId: string) {
    await this.requireOrgAdmin(actorId);
    return [...this.grants.values()]
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .map(({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }) => ({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }));
  }

  async setTestAccess(targetUserId: string, allowed: boolean, actorId: string) {
    await this.requireOrgAdmin(actorId);
    if (!targetUserId.trim()) throw new RepositoryError('VALIDATION', 'A stable user object ID is required.');
    const previous = this.grants.get(targetUserId);
    const grant = this.makeGrant(targetUserId, allowed, actorId, previous);
    this.grants.set(targetUserId, grant);
    this.audit.unshift({ id: `environment-audit-${grant.version}-${targetUserId}-${Date.now()}`, kind: 'environmentAccessAudit', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'control', actorId, targetUserId, action: allowed ? 'granted' : 'revoked', createdAt: grant.updatedAt });
    return { userId: grant.userId, allowed: grant.allowed, grantedAt: grant.grantedAt, grantedBy: grant.grantedBy, revokedAt: grant.revokedAt, revokedBy: grant.revokedBy, version: grant.version };
  }

  async seedTestAccess(userIds: readonly string[], actorId = 'bootstrap') {
    for (const userId of userIds) {
      if (userId.trim()) this.grants.set(userId, this.makeGrant(userId, true, actorId, this.grants.get(userId)));
    }
  }

  async getAudit() {
    return structuredClone(this.audit);
  }
}

type ControlDocument = EnvironmentDefinition | EnvironmentAccessGrant | EnvironmentAccessAudit;

export class CosmosControlPlaneRepository implements ControlPlaneRepository {
  constructor(private readonly container: Container, private readonly isOrgAdmin: (userId: string) => Promise<boolean>) {}

  static fromEnvironment(isOrgAdmin: (userId: string) => Promise<boolean>) {
    const connectionString = process.env.COSMOS_CONNECTION_STRING;
    const database = process.env.COSMOS_CONTROL_DATABASE;
    const containerName = process.env.COSMOS_CONTROL_CONTAINER ?? 'environment-access';
    if (process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true') return null;
    if (!connectionString || !database || !containerName) return null;
    const client = new CosmosClient(connectionString);
    return new CosmosControlPlaneRepository(client.database(database).container(containerName), isOrgAdmin);
  }

  private async requireOrgAdmin(actorId: string) {
    if (!(await this.isOrgAdmin(actorId))) throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required to manage Test access.');
  }

  private async query<T extends ControlDocument>(query: string, parameters: Array<{ name: string; value: string | boolean }>) {
    const result = await this.container.items.query<T>({ query, parameters }, { partitionKey: CONTROL_PARTITION }).fetchAll();
    return result.resources.map((resource) => ({ ...resource, cosmosEtag: (resource as T & { _etag?: string })._etag }) as T & { cosmosEtag?: string });
  }

  private async grantFor(userId: string) {
    const records = await this.query<EnvironmentAccessGrant>('SELECT TOP 1 * FROM c WHERE c.pk = @pk AND c.kind = "environmentAccessGrant" AND c.userId = @userId', [{ name: '@pk', value: CONTROL_PARTITION }, { name: '@userId', value: userId }]);
    return records[0] ?? null;
  }

  async getEnvironmentSession(userId: string) {
    const canSwitchToTest = await this.canAccess(userId, 'test');
    return { currentEnvironment: 'live' as const, availableEnvironments: environmentSummary(canSwitchToTest, await this.getEnvironmentMetadata()), canSwitchToTest };
  }

  async getEnvironmentMetadata() {
    const definitions = await this.query<EnvironmentDefinition>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = "environmentDefinition"', [{ name: '@pk', value: CONTROL_PARTITION }]);
    const visibleDefinitions = definitions.length ? definitions : defaultEnvironmentDefinitions();
    return visibleDefinitions.map(({ id, kind, pk, orgId, environmentId, label, active, createdAt, updatedAt }) => ({ id, kind, pk, orgId, environmentId, label, active, createdAt, updatedAt }));
  }

  async canAccess(userId: string, environment: EnvironmentId) {
    if (environment === 'live') return Boolean(userId.trim());
    return (await this.grantFor(userId))?.allowed === true;
  }

  async listTestAccess(actorId: string) {
    await this.requireOrgAdmin(actorId);
    const grants = await this.query<EnvironmentAccessGrant>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = "environmentAccessGrant"', [{ name: '@pk', value: CONTROL_PARTITION }]);
    return grants.sort((left, right) => left.userId.localeCompare(right.userId)).map(({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }) => ({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }));
  }

  async setTestAccess(targetUserId: string, allowed: boolean, actorId: string) {
    await this.requireOrgAdmin(actorId);
    if (!targetUserId.trim()) throw new RepositoryError('VALIDATION', 'A stable user object ID is required.');
    const previous = await this.grantFor(targetUserId);
    const timestamp = nowIso();
    const grant: EnvironmentAccessGrant = {
      id: grantId(targetUserId), kind: 'environmentAccessGrant', pk: CONTROL_PARTITION, orgId: ORG_ID, userId: targetUserId, environmentId: 'test', allowed,
      grantedAt: allowed ? (previous?.grantedAt ?? timestamp) : previous?.grantedAt, grantedBy: allowed ? (previous?.grantedBy ?? actorId) : previous?.grantedBy,
      revokedAt: allowed ? previous?.revokedAt : timestamp, revokedBy: allowed ? previous?.revokedBy : actorId,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, updatedBy: actorId, version: (previous?.version ?? 0) + 1,
    };
    const audit: EnvironmentAccessAudit = { id: `environment-audit-${targetUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'environmentAccessAudit', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'control', actorId, targetUserId, action: allowed ? 'granted' : 'revoked', createdAt: timestamp };
    try {
      const operations = previous
        ? [{ operationType: 'Replace' as const, id: grant.id, ifMatch: previous.cosmosEtag, resourceBody: grant as unknown as Record<string, unknown> }, { operationType: 'Create' as const, resourceBody: audit as unknown as Record<string, unknown> }]
        : [{ operationType: 'Create' as const, resourceBody: grant as unknown as Record<string, unknown> }, { operationType: 'Create' as const, resourceBody: audit as unknown as Record<string, unknown> }];
      const response = await this.container.items.batch(operations as unknown as import('@azure/cosmos').OperationInput[], CONTROL_PARTITION);
      const failed = response.result?.find((item) => item.statusCode >= 400);
      if (failed) {
        if (failed.statusCode === 412) throw new RepositoryError('CONFLICT', 'The Test access record changed elsewhere. Refresh and try again.');
        throw new RepositoryError('UNAVAILABLE', 'Cosmos could not persist the Test access audit update.');
      }
    } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if ((error as { code?: number }).code === 412) throw new RepositoryError('CONFLICT', 'The Test access record changed elsewhere. Refresh and try again.');
      throw error;
    }
    return { userId: grant.userId, allowed: grant.allowed, grantedAt: grant.grantedAt, grantedBy: grant.grantedBy, revokedAt: grant.revokedAt, revokedBy: grant.revokedBy, version: grant.version };
  }

  async seedTestAccess(userIds: readonly string[], actorId = 'bootstrap') {
    for (const userId of userIds) {
      if (userId.trim()) await this.setTestAccess(userId, true, actorId);
    }
  }

  async getAudit() {
    const records = await this.query<EnvironmentAccessAudit>('SELECT * FROM c WHERE c.pk = @pk AND c.kind = "environmentAccessAudit"', [{ name: '@pk', value: CONTROL_PARTITION }]);
    return records.map(({ id, kind, pk, orgId, environmentId, actorId, targetUserId, action, createdAt }) => ({ id, kind, pk, orgId, environmentId, actorId, targetUserId, action, createdAt }));
  }
}

export interface EnvironmentRepositoryFactoryOptions {
  live: WorkspaceRepository;
  test: WorkspaceRepository;
  control: ControlPlaneRepository;
}

export class EnvironmentRepositoryFactory {
  private readonly workspaces: Record<EnvironmentId, WorkspaceRepository>;

  constructor(options: EnvironmentRepositoryFactoryOptions) {
    this.workspaces = { live: options.live, test: options.test };
    this.control = options.control;
  }

  readonly control: ControlPlaneRepository;

  getWorkspaceRepository(environment: EnvironmentId) {
    return this.workspaces[environment];
  }

  getControlRepository() {
    return this.control;
  }
}

export function createMemoryEnvironmentFactory(live: WorkspaceRepository, test = new MemoryWorkspaceRepository('test'), control?: ControlPlaneRepository) {
  return new EnvironmentRepositoryFactory({ live, test, control: control ?? new MemoryControlPlaneRepository({ isOrgAdmin: async (userId) => canAdministerPlatform((await live.getUser(userId))?.platformCapabilities ?? []) || (await live.getLeadershipMembership(userId))?.role === 'OrgAdmin' }) });
}
