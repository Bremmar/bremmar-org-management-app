import { TableClient, odata, type TableEntity, type TableEntityResult, type TransactionAction } from '@azure/data-tables';
import {
  canAdministerPlatform,
  type EnvironmentId,
  type EnvironmentSummary,
  type WorkspaceRecord,
} from '../domain.js';
import { MemoryWorkspaceRepository, RepositoryError, type WorkspaceRepository } from './repository.js';

const CONTROL_PARTITION = 'org';
export const DEFAULT_CONTROL_TABLE_NAME = 'EnvironmentAccess';
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
type StoredControlDocument<T extends ControlDocument> = T & { tableEtag: string };
type ControlTableClient = Pick<TableClient, 'createEntity' | 'getEntity' | 'listEntities' | 'submitTransaction'>;

function tableEntityFor(document: ControlDocument, rowKey = document.id): TableEntity<Record<string, unknown>> {
  const properties = Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined));
  return { partitionKey: CONTROL_PARTITION, rowKey, ...properties };
}

function documentForTableEntity<T extends ControlDocument>(entity: TableEntityResult<T>) {
  const document = { ...entity } as Record<string, unknown>;
  delete document.partitionKey;
  delete document.rowKey;
  delete document.timestamp;
  delete document.etag;
  return { document: document as T, tableEtag: entity.etag };
}

function statusCodeFor(error: unknown) {
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function isNotFound(error: unknown) {
  return statusCodeFor(error) === 404;
}

function tableUnavailable(message: string, error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  throw new RepositoryError('UNAVAILABLE', message);
}

function tableRowKey(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function grantRowKey(userId: string) {
  return `grant-${tableRowKey(userId)}`;
}

function auditRowKey() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AzureTableControlPlaneRepository implements ControlPlaneRepository {
  constructor(private readonly table: ControlTableClient, private readonly isOrgAdmin: (userId: string) => Promise<boolean>) {}

  static fromEnvironment(isOrgAdmin: (userId: string) => Promise<boolean>) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const tableName = process.env.AZURE_STORAGE_TABLE_NAME ?? DEFAULT_CONTROL_TABLE_NAME;
    if (process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true') return null;
    if (!connectionString || !tableName) return null;
    return new AzureTableControlPlaneRepository(TableClient.fromConnectionString(connectionString, tableName), isOrgAdmin);
  }

  private async requireOrgAdmin(actorId: string) {
    if (!(await this.isOrgAdmin(actorId))) throw new RepositoryError('FORBIDDEN', 'OrgAdmin authorization is required to manage Test access.');
  }

  private async query<T extends ControlDocument>(filter: string) {
    try {
      const records: Array<StoredControlDocument<T>> = [];
      for await (const entity of this.table.listEntities<T>({ queryOptions: { filter } })) {
        const { document, tableEtag } = documentForTableEntity(entity);
        records.push({ ...document, tableEtag });
      }
      return records;
    } catch (error) {
      return tableUnavailable('Azure Table Storage could not read control-plane data.', error);
    }
  }

  private async grantFor(userId: string) {
    try {
      const entity = await this.table.getEntity<EnvironmentAccessGrant>(CONTROL_PARTITION, grantRowKey(userId));
      const { document, tableEtag } = documentForTableEntity(entity);
      return { ...document, tableEtag } as StoredControlDocument<EnvironmentAccessGrant>;
    } catch (error) {
      if (isNotFound(error)) return null;
      return tableUnavailable('Azure Table Storage could not read control-plane data.', error);
    }
  }

  async ensureEnvironmentMetadata() {
    const existing = await this.query<EnvironmentDefinition>(odata`PartitionKey eq ${CONTROL_PARTITION} and kind eq ${'environmentDefinition'}`);
    const existingIds = new Set(existing.map((definition) => definition.id));
    for (const definition of defaultEnvironmentDefinitions()) {
      if (existingIds.has(definition.id)) continue;
      try {
        await this.table.createEntity(tableEntityFor(definition));
      } catch (error) {
        if (statusCodeFor(error) !== 409) return tableUnavailable('Azure Table Storage could not initialize environment metadata.', error);
      }
    }
  }

  async getEnvironmentSession(userId: string) {
    const canSwitchToTest = await this.canAccess(userId, 'test');
    return { currentEnvironment: 'live' as const, availableEnvironments: environmentSummary(canSwitchToTest, await this.getEnvironmentMetadata()), canSwitchToTest };
  }

  async getEnvironmentMetadata() {
    const definitions = await this.query<EnvironmentDefinition>(odata`PartitionKey eq ${CONTROL_PARTITION} and kind eq ${'environmentDefinition'}`);
    const visibleDefinitions = definitions.length ? definitions : defaultEnvironmentDefinitions();
    return visibleDefinitions.map(({ id, kind, pk, orgId, environmentId, label, active, createdAt, updatedAt }) => ({ id, kind, pk, orgId, environmentId, label, active, createdAt, updatedAt }));
  }

  async canAccess(userId: string, environment: EnvironmentId) {
    if (environment === 'live') return Boolean(userId.trim());
    return (await this.grantFor(userId))?.allowed === true;
  }

  async listTestAccess(actorId: string) {
    await this.requireOrgAdmin(actorId);
    const grants = await this.query<EnvironmentAccessGrant>(odata`PartitionKey eq ${CONTROL_PARTITION} and kind eq ${'environmentAccessGrant'}`);
    return grants.sort((left, right) => left.userId.localeCompare(right.userId)).map(({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }) => ({ userId, allowed, grantedAt, grantedBy, revokedAt, revokedBy, version }));
  }

  async setTestAccess(targetUserId: string, allowed: boolean, actorId: string) {
    await this.requireOrgAdmin(actorId);
    if (!targetUserId.trim()) throw new RepositoryError('VALIDATION', 'A stable user object ID is required.');
    const normalizedUserId = targetUserId.trim();
    const previous = await this.grantFor(normalizedUserId);
    const timestamp = nowIso();
    const grant: EnvironmentAccessGrant = {
      id: grantId(normalizedUserId), kind: 'environmentAccessGrant', pk: CONTROL_PARTITION, orgId: ORG_ID, userId: normalizedUserId, environmentId: 'test', allowed,
      grantedAt: allowed ? (previous?.grantedAt ?? timestamp) : previous?.grantedAt, grantedBy: allowed ? (previous?.grantedBy ?? actorId) : previous?.grantedBy,
      revokedAt: allowed ? previous?.revokedAt : timestamp, revokedBy: allowed ? previous?.revokedBy : actorId,
      createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp, updatedBy: actorId, version: (previous?.version ?? 0) + 1,
    };
    const audit: EnvironmentAccessAudit = { id: `environment-audit-${normalizedUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'environmentAccessAudit', pk: CONTROL_PARTITION, orgId: ORG_ID, environmentId: 'control', actorId, targetUserId: normalizedUserId, action: allowed ? 'granted' : 'revoked', createdAt: timestamp };
    const actions: TransactionAction[] = previous
      ? [['update', tableEntityFor(grant, grantRowKey(normalizedUserId)), 'Replace', { etag: previous.tableEtag }], ['create', tableEntityFor(audit, auditRowKey())]]
      : [['create', tableEntityFor(grant, grantRowKey(normalizedUserId))], ['create', tableEntityFor(audit, auditRowKey())]];
    try {
      const response = await this.table.submitTransaction(actions);
      const failedStatus = response.subResponses.find((item) => item.status >= 400)?.status ?? (response.status >= 400 ? response.status : undefined);
      if (failedStatus === 409 || failedStatus === 412) throw new RepositoryError('CONFLICT', 'The Test access record changed elsewhere. Refresh and try again.');
      if (failedStatus) throw new RepositoryError('UNAVAILABLE', 'Azure Table Storage could not persist the Test access audit update.');
    } catch (error) {
      const statusCode = statusCodeFor(error);
      if (error instanceof RepositoryError) throw error;
      if (statusCode === 409 || statusCode === 412) throw new RepositoryError('CONFLICT', 'The Test access record changed elsewhere. Refresh and try again.');
      return tableUnavailable('Azure Table Storage could not persist the Test access audit update.', error);
    }
    return { userId: grant.userId, allowed: grant.allowed, grantedAt: grant.grantedAt, grantedBy: grant.grantedBy, revokedAt: grant.revokedAt, revokedBy: grant.revokedBy, version: grant.version };
  }

  async seedTestAccess(userIds: readonly string[], actorId = 'bootstrap') {
    await this.requireOrgAdmin(actorId);
    for (const userId of userIds) {
      const normalizedUserId = userId.trim();
      if (normalizedUserId && !(await this.grantFor(normalizedUserId))) await this.setTestAccess(normalizedUserId, true, actorId);
    }
  }

  async getAudit() {
    const records = await this.query<EnvironmentAccessAudit>(odata`PartitionKey eq ${CONTROL_PARTITION} and kind eq ${'environmentAccessAudit'}`);
    return records
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(({ id, kind, pk, orgId, environmentId, actorId, targetUserId, action, createdAt }) => ({ id, kind, pk, orgId, environmentId, actorId, targetUserId, action, createdAt }));
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
