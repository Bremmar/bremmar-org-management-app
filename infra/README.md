# Azure infrastructure

`main.bicep` provisions the planned Azure foundation:

- Azure Static Web Apps for the React frontend.
- A separate Linux Azure Functions app for the core API when using the Bring
  Your Own Functions deployment mode.
- A serverless, single-region Cosmos DB for NoSQL account with three isolated
  databases: `eos-control`, `eos-live`, and `eos-test`.
- An `environment-access` control-plane container plus one `workspace` container
  in each workspace database, all partitioned by `/pk`.
- A system-assigned managed identity for the API Function App.

The Function App identity needs the Cosmos DB native data-plane contributor role. The Bicep template creates that assignment at account scope; reduce it to the database or container scope when the deployment topology is finalized.

The default GitHub Actions workflow deploys `apps/api` as the Static Web Apps
managed Functions API using `api_location`. The separate Function App in this
template is an alternative for environments that need a dedicated host and
managed identity for Cosmos DB; if it is used, set the Static Web Apps
workflow's `api_location` to an empty value and link the existing Function App
to `/api`. Do not run both modes for the same environment. The existing AI
Function App is intentionally not provisioned or connected here.

## Parameters

At minimum provide unique names for `staticWebAppName`, `functionAppName`, `functionStorageName`, and `cosmosAccountName`, plus the organization's `tenantId`, initial administrator object ID, and `environmentCookieSecret`. The cookie secret must be supplied as a secure deployment parameter and is written only to the Function App setting.

The API reads `COSMOS_CONTROL_DATABASE`, `COSMOS_LIVE_DATABASE`, and
`COSMOS_TEST_DATABASE`; the default container names are `environment-access`
for control and `workspace` for both workspaces. The API uses managed identity
data-plane access and the Cosmos account disables key authentication.

After deployment, run the API environment bootstrap with the initial Entra
object IDs. Bootstrap is additive and idempotent: it creates control metadata,
initializes Live with configuration only, seeds Test from the dedicated
sanitized fixture, and grants Test access only to the approved administrator
IDs. It never copies Live records into Test.

Do not commit parameter files containing tenant IDs, subscription-specific values, credentials, or secrets. Use a secure deployment pipeline or local parameter file outside source control.
