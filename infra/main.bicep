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

@description('Secret used to sign the HttpOnly environment-selection cookie. Supply through a secure deployment parameter.')
@secure()
param environmentCookieSecret string

@description('Cosmos database for shared environment metadata and Test grants.')
param controlDatabaseName string = 'eos-control'

@description('Cosmos database for production workspace data.')
param liveDatabaseName string = 'eos-live'

@description('Cosmos database for dedicated sanitized Test fixtures and Test workspace data.')
param testDatabaseName string = 'eos-test'

var controlContainerName = 'environment-access'
var workspaceContainerName = 'workspace'

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
    disableLocalAuth: false
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

resource cosmosControlDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: controlDatabaseName
  properties: {
    resource: {
      id: controlDatabaseName
    }
  }
}

resource cosmosControlContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosControlDatabase
  name: controlContainerName
  properties: {
    resource: {
      id: controlContainerName
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

resource cosmosLiveDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: liveDatabaseName
  properties: {
    resource: {
      id: liveDatabaseName
    }
  }
}

resource cosmosLiveContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosLiveDatabase
  name: workspaceContainerName
  properties: {
    resource: {
      id: workspaceContainerName
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

resource cosmosTestDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: testDatabaseName
  properties: {
    resource: {
      id: testDatabaseName
    }
  }
}

resource cosmosTestContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosTestDatabase
  name: workspaceContainerName
  properties: {
    resource: {
      id: workspaceContainerName
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
          name: 'COSMOS_CONNECTION_STRING'
          value: listConnectionStrings(cosmos.id, '2024-05-15').connectionStrings[0].connectionString
        }
        {
          name: 'COSMOS_CONTROL_DATABASE'
          value: controlDatabaseName
        }
        {
          name: 'COSMOS_LIVE_DATABASE'
          value: liveDatabaseName
        }
        {
          name: 'COSMOS_TEST_DATABASE'
          value: testDatabaseName
        }
        {
          name: 'COSMOS_CONTROL_CONTAINER'
          value: controlContainerName
        }
        {
          name: 'COSMOS_LIVE_CONTAINER'
          value: workspaceContainerName
        }
        {
          name: 'COSMOS_TEST_CONTAINER'
          value: workspaceContainerName
        }
        {
          name: 'ENVIRONMENT_COOKIE_SECRET'
          value: environmentCookieSecret
        }
      ]
    }
  }
  dependsOn: [cosmosControlContainer, cosmosLiveContainer, cosmosTestContainer]
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
output cosmosControlDatabase string = controlDatabaseName
output cosmosLiveDatabase string = liveDatabaseName
output cosmosTestDatabase string = testDatabaseName
output cosmosWorkspaceContainer string = workspaceContainerName
output cosmosControlContainer string = controlContainerName
output initialOrgAdminObjectId string = initialOrgAdminObjectId
output tenantId string = tenantId
