# Azure infrastructure

`main.bicep` provisions the planned Azure foundation:

- Azure Static Web Apps for the React frontend.
- A separate Linux Azure Functions app for the core API when using the Bring
  Your Own Functions deployment mode.
- A serverless, single-region Cosmos DB for NoSQL account with two isolated
  databases: `eos-live` and `eos-test`.
- One `workspace` container in each Cosmos database, partitioned by `/pk`.
- An `EnvironmentAccess` Azure Storage Table for environment definitions, Test
  access grants, and immutable access audit events.

The default GitHub Actions workflow deploys `apps/api` as the Static Web Apps
managed Functions API using `api_location`. The separate Function App in this
template is an alternative for environments that need a dedicated host; it
uses connection-string access to Cosmos DB. If it is used, set the Static Web
Apps workflow's `api_location` to an empty value and link the existing
Function App to `/api`. Do not run both modes for the same environment. The
existing AI Function App is intentionally not provisioned or connected here.

## Parameters

At minimum provide unique names for `staticWebAppName`, `functionAppName`, `functionStorageName`, and `cosmosAccountName`, plus the organization's `tenantId`, initial administrator object ID, and `environmentCookieSecret`. The cookie secret must be supplied as a secure deployment parameter and is written only to the Function App setting. The dedicated Function App is provisioned with a system-assigned managed identity and receives `ENTRA_TENANT_ID` for the API's Entra identity lookup.

The API reads `COSMOS_LIVE_DATABASE` and `COSMOS_TEST_DATABASE`; the default
container name is `workspace` for both databases. The control plane reads
`AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_TABLE_NAME`, which
defaults to `EnvironmentAccess`. The Bicep template creates the table and
populates the storage connection string for the dedicated Function App. It
also populates `COSMOS_CONNECTION_STRING` from the Cosmos account connection
string; neither secret is emitted as an output.

Static Web Apps exposes an app-specific `x-ms-client-principal.userId`, not the
Entra directory object ID. The API resolves the principal's signed-in
`userDetails` value through Microsoft Graph before it performs local profile,
membership, or Test-access checks. For the managed Static Web Apps API, add
`ENTRA_TENANT_ID`, `ENTRA_GRAPH_CLIENT_ID`, and
`ENTRA_GRAPH_CLIENT_SECRET` as application settings. The client app must have
the Microsoft Graph **Application** permission `User.Read.All` with admin
consent. For the alternative Function App, grant the same permission to its
system-assigned managed identity instead; the API will use the platform-managed
identity endpoint automatically. Graph is used only for identity resolution,
not workspace synchronization.

After deployment, run the API environment bootstrap with the initial Entra
object IDs. Bootstrap is additive and idempotent: it creates control metadata
in Azure Table Storage, initializes Live with the organization configuration
and an empty initial Leadership L10 shell, seeds Test from the dedicated
sanitized fixture, and grants Test access only to the
approved administrator IDs. It never copies Live records into Test.

For an existing deployment, the old `eos-control` Cosmos database is no longer
read by the API. Re-run bootstrap with the approved Test object IDs, verify the
application, and then remove the unused database manually if it still exists;
an incremental Bicep deployment does not delete that old resource.

Do not commit parameter files containing tenant IDs, subscription-specific values, credentials, or secrets. Use a secure deployment pipeline or local parameter file outside source control.
