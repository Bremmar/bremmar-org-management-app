@description('Azure region for the application resources.')
param location string = resourceGroup().location

@description('Globally unique name for the Static Web App.')
param staticWebAppName string

@description('Globally unique name for the Function App.')
param functionAppName string

@description('Globally unique name for the Function App storage account.')
param functionStorageName string

@description('Globally unique name for the Cosmos DB account.')
param cosmosAccountName string

@description('The Entra tenant ID used by the application.')
param tenantId string

@description('The initial organization administrator object ID. Use this only for the first bootstrap assignment.')
param initialOrgAdminObjectId string

var cosmosDatabaseName = 'eos'
var cosmosContainerName = 'workspace'
var cosmosContributorRoleId = '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'

resource functionStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: functionStorageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableAutomaticFailover: false
    disableLocalAuth: true
    minimalTlsVersion: 'Tls12'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: {
      id: cosmosContainerName
      partitionKey: {
        paths: [
          '/pk'
        ]
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource functionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|22'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmos.properties.documentEndpoint
        }
        {
          name: 'COSMOS_DATABASE'
          value: cosmosDatabaseName
        }
        {
          name: 'COSMOS_CONTAINER'
          value: cosmosContainerName
        }
      ]
    }
  }
  dependsOn: [
    cosmosContainer
  ]
}

resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, functionApp.identity.principalId, 'workspace-contributor')
  properties: {
    roleDefinitionId: cosmosContributorRoleId
    principalId: functionApp.identity.principalId
    scope: cosmos.id
  }
  dependsOn: [
    functionApp
  ]
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    repositoryUrl: ''
    stagingEnvironmentPolicy: 'Enabled'
  }
}

output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output functionAppHostname string = functionApp.properties.defaultHostName
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output initialOrgAdminObjectId string = initialOrgAdminObjectId
output tenantId string = tenantId
