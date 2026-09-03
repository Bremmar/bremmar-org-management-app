# Bremmar · EOS operating hub

Bremmar is a standalone React/Azure Functions operating system for multi-team
EOS work. It brings hierarchical team workspaces, quarterly Rocks and Tasks,
weekly To-Dos, Issues/IDS, Scorecard measurables, Headlines, meeting history,
cross-team messages and Issue handoffs, configurable L10 agendas, escalation
paths, and Leadership rollups into one source of truth.

## Repository layout

- `apps/web` — React + TypeScript frontend for Azure Static Web Apps.
- `apps/api` — Azure Functions v4 API deployed at the Static Web Apps `/api` route.
- `infra` — Bicep foundation for Static Web Apps, Functions, Cosmos DB, and Azure Table Storage.
- `AGENTS.md` — project guidance for coding agents and contributors.

## Local development

```bash
npm install
npm run dev
```

The frontend currently runs with an explicit local seeded workspace API so the
product flow can be explored without login or Azure resources. The local POC
contains the Leadership → Professional Services / Managed Services hierarchy,
one PlatformAdmin profile, role-aware team membership, and sample transfer
notices, editable Rock/Issue/To-Do detail, meeting-specific IDS notes, automatic
To-Do rollover Issues, and per-team L10/escalation configuration. The API package
can be built independently with `npm run build:api`.

The local POC keeps independent Live and Test workspace copies. Live is selected
on startup; the seeded POC administrator can switch to Test from the authenticated
shell, where edits remain isolated from Live. Set `VITE_LOCAL_POC_MODE=false` to
use the Functions API instead of the local fixture. The API's local settings use
`LOCAL_POC_MODE=true` and a signed-cookie fallback secret only for this local POC
mode.

If Azure Functions Core Tools is installed, copy
`apps/api/local.settings.sample.json` to `local.settings.json`, keep
`LOCAL_POC_MODE=true` for local development, build the API, and run it with
`func start --script-root apps/api`.

## Weekly scorecards and To-Do rollover

Scorecard definitions and Monday-start weekly results are stored in the owning
Cosmos `team:{teamId}` partition. The API exposes:

- `POST /api/teams/{teamId}/scorecard/metrics`
- `PATCH /api/scorecard/metrics/{metricId}`
- `PUT /api/scorecard/metrics/{metricId}/weeks/{weekStartDate}`

TeamLead, Member, and existing OrgAdmin team access can write these records;
Viewer and Leadership-only access is read-only. L10 reads the result matching
the meeting’s `weekStartDate`, while the Scorecard screen owns weekly entry and
history. Teams with the Scorecard section disabled have no Scorecard navigation
or L10 Scorecard content until an administrator enables it.

Changing an incomplete To-Do’s due date to a later date automatically reopens it,
increments its rollover count, synchronizes a linked Rock Task, and creates the
linked IDS Issue on the fourth rollover. Completed, unchanged, and earlier-date
edits do not count. There is no separate move-forward endpoint or button.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Deployment notes

The deployment workflow expects the app-specific
`AZURE_STATIC_WEB_APPS_API_TOKEN_VICTORIOUS_MEADOW_02A0D9700` GitHub secret.
The token binds the deployment to the Victorious Meadow Static Web App. It
deploys `apps/web` as the static frontend and the prepared `apps/api/dist`
artifact as the managed Azure Functions API under `/api`. The workflow places
`host.json` and a deployment `package.json` at the artifact root, with `main`
pointing to the compiled `index.js`, and installs only API runtime dependencies
before the Static Web Apps upload.

`infra/main.bicep` also contains a separate Bring Your Own Functions deployment
for environments that require a dedicated Function App. That deployment
configures the API with a Cosmos DB connection string. Choose one API hosting
mode per environment; do not deploy both to the same `/api` route. Disable
local POC mode and configure the approved single-tenant identity adapter before
allowing shared or production traffic.

The Bicep foundation provisions `eos-live` and `eos-test` in one Cosmos account
plus an `EnvironmentAccess` Azure Storage Table for environment metadata, Test
access grants, and grant audit events. All workspace records are stored only in
their selected Cosmos database. Supply the secure `environmentCookieSecret`
parameter, configure `COSMOS_CONNECTION_STRING`, `AZURE_STORAGE_CONNECTION_STRING`,
and `AZURE_STORAGE_TABLE_NAME` for a Static Web Apps managed API when
applicable, and run
`npm run bootstrap:environments --workspace @eos/api` after deployment with the
initial Entra object IDs. Bootstrap initializes Live with the organization
configuration and an empty initial Leadership L10 shell, seeds Test from the
dedicated sanitized fixture, and is additive/idempotent.

### Entra identity mapping

Azure Static Web Apps assigns each signed-in user an app-specific `userId`; it
is not the Entra directory object ID used by bootstrap. The API therefore
resolves the signed-in Entra username/email through Microsoft Graph and uses the
returned directory `id` as the application identity key. This is an identity
lookup only—Bremmar does not synchronize Graph users or groups into workspace
data.

Creating a user from Admin uses the same Graph credentials to look up the
submitted email against `userPrincipalName` or `mail`, then stores that
directory object ID as the new profile's stable key. The email must belong to
an Entra user in the configured tenant; otherwise the API returns a clear
directory-not-found response and does not create a local-only profile.

For the managed Static Web Apps API, add these settings to the Static Web App's
Configuration page (never commit the secret):

```text
ENTRA_TENANT_ID=<your Entra tenant ID>
ENTRA_GRAPH_CLIENT_ID=<app registration client ID>
ENTRA_GRAPH_CLIENT_SECRET=<client secret value>
```

The app registration must be in the organization tenant, have the Microsoft
Graph **Application** permission `User.Read.All`, and have admin consent. The
dedicated Function App provisioned by `infra/main.bicep` receives a system-
assigned managed identity and the tenant setting; grant that identity the same
Graph permission, or configure the three settings above on that Function App.
Do not use the Static Web Apps `userId` as the bootstrap object ID. After adding
the settings, sign out/in once and reload the app; existing profiles bootstrapped
with the Entra object ID do not need to be recreated.

Planner, Teams, Graph, email, and other external synchronization are out of
scope for this phase. See [docs/live-data-plan.md](docs/live-data-plan.md) for
the API/data boundary and rollout notes.
