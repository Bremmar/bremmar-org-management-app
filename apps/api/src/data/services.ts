import { canAdministerPlatform } from '../domain.js';
import { CosmosControlPlaneRepository, EnvironmentRepositoryFactory, MemoryControlPlaneRepository, type ControlPlaneRepository } from './environment.js';
import { CosmosWorkspaceRepository, MemoryWorkspaceRepository, RepositoryError, repository, type WorkspaceRepository } from './repository.js';

function unavailableWorkspace(environmentId: 'live' | 'test', message: string): WorkspaceRepository {
  return new Proxy({ environmentId } as WorkspaceRepository, {
    get(target, property) {
      if (property === 'environmentId') return target.environmentId;
      return async () => { throw new RepositoryError('UNAVAILABLE', message); };
    },
  });
}

function unavailableControl(message: string): ControlPlaneRepository {
  return new Proxy({} as ControlPlaneRepository, {
    get() {
      return async () => { throw new RepositoryError('UNAVAILABLE', message); };
    },
  });
}

const localPoc = process.env.LOCAL_POC_MODE === 'true' && process.env.COSMOS_ENABLED !== 'true';
const liveCosmosRepository = CosmosWorkspaceRepository.fromEnvironment('live');
const liveRepository = liveCosmosRepository ?? (localPoc ? repository : unavailableWorkspace('live', 'Live Cosmos database configuration is required when LOCAL_POC_MODE is disabled.'));
const testCosmosRepository = CosmosWorkspaceRepository.fromEnvironment('test');
const testRepository = testCosmosRepository ?? (localPoc ? new MemoryWorkspaceRepository('test') : unavailableWorkspace('test', 'Test Cosmos database configuration is required when LOCAL_POC_MODE is disabled.'));
const isOrgAdmin = async (userId: string) => canAdministerPlatform((await liveRepository.getUser(userId))?.platformCapabilities ?? []) || (await liveRepository.getLeadershipMembership(userId))?.role === 'OrgAdmin';
const cosmosControlRepository = CosmosControlPlaneRepository.fromEnvironment(isOrgAdmin);
const controlRepository = cosmosControlRepository
  ?? (localPoc ? new MemoryControlPlaneRepository({ isOrgAdmin }) : unavailableControl('Control Cosmos database configuration is required when LOCAL_POC_MODE is disabled.'));

export const environmentRepositories = new EnvironmentRepositoryFactory({
  live: liveRepository,
  test: testRepository,
  control: controlRepository,
});
