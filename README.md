# Bremmar · EOS operating hub

Bremmar is a standalone React/Azure Functions operating system for multi-team
EOS work. It brings hierarchical team workspaces, quarterly Rocks and Tasks,
weekly To-Dos, Issues/IDS, Scorecard measurables, Headlines, meeting history,
cross-team messages and Issue handoffs, configurable L10 agendas, escalation
paths, and Leadership rollups into one source of truth. Team configuration
supports weekly or monthly L10 cadence, and an open/current meeting can be
rescheduled when its date or time changes. In-progress L10s record a continuous
meeting timer, per-section durations, the facilitator, an overall rating, and
facilitator-entered attendee ratings. IDS uses a focused selection of up to five
Issues, an explicit order, issue-by-issue notes, and Solve or Park outcomes.

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

## Meeting history, cadence, and AI recap

Team configuration stores `meetingCadence` as `weekly` or `monthly`. Monthly
recurrence preserves the selected day of month and clamps month-end meetings
to the last valid day. Four upcoming occurrences are kept for every
operational team. Every occurrence stores its `scheduledDate`, `scheduledTime`,
and nominal `recurrenceDate`; a one-off move changes only the selected open
occurrence. Team editors can update it through:

- `PATCH /api/teams/{teamId}/meetings/{meetingId}`
- `POST /api/teams/{teamId}/meetings/{meetingId}/skip`
- `POST /api/teams/{teamId}/meetings/{meetingId}/start`
- `PATCH /api/teams/{teamId}/meetings/{meetingId}/section`
- `PATCH /api/teams/{teamId}/meetings/{meetingId}/ids/selection`
- `PATCH /api/teams/{teamId}/meetings/{meetingId}/ids/order`

Start writes an immutable server UTC timestamp. Skip requires a public holiday,
annual leave, or other reason, keeps the occurrence in history, records the
actor/time, and leaves the cadence unchanged. Schedule, start, and skip actions
are version-checked and limited to editors of the meeting’s own team; parent
TeamLeads and Viewers can review descendant meetings but remain read-only.

`GET /api/meetings/review` powers Past meetings. It accepts grouped `filter`
values or precise `status` values alongside team, date, and cursor filters. It
derives Missed (the
scheduled slot passed without a start) and Overdue (an open meeting exceeded
the configured agenda duration) at read time. `GET
/api/teams/{teamId}/meetings/{meetingId}` returns the full read-only meeting
record for detail review.

Closing stores the manual recap, action summary, and a same-team immutable
context snapshot in a `meetingSummaryJob`, then queues the existing AI Function.
The post-Conclude recap shows queued/generating/ready/failed states and stores
structured Executive summary, Decisions, Commitments, Risks, and Next focus
output on the meeting. A direct team editor can regenerate a ready recap or
retry a failed job; legacy closed meetings show Not generated and can be
requested once. Core API
worker requests and callbacks use HMAC signatures with timestamp and attempt
checks to prevent replayed results.

Changing an incomplete To-Do’s due date to a later date automatically reopens it,
increments its rollover count, synchronizes a linked Rock Task, and creates the
linked IDS Issue on the fourth rollover. Dates are validated and stored as
`YYYY-MM-DD`; completed, unchanged, and earlier-date edits do not count. There
is no separate move-forward endpoint or button.

To-Dos can contain embedded checklists. New checklist items default to the
To-Do owner, while assignment is limited to active members of the owning team;
checklist changes use the parent To-Do version for optimistic concurrency and do
not change the parent To-Do status. Notes use a sanitized compact rich-text
format (bold, italic, bulleted lists, and numbered lists), with legacy plain
text converted safely when loaded. To-Dos solved from an Issue retain a
`sourceIssueId` and show the linked Issue’s context read-only in the To-Do
dialog.

Issue health is based on total meetings passed, not age: neutral at 0, green at
1, yellow at 2, orange at 3, and red/escalated at 4 or more. At meeting close,
all unresolved Issues that predate the meeting start are counted, including
Issues not placed on the IDS list. Issues solved during the meeting and Issues
created during it are excluded. `ageInDays` remains visible as neutral reference
text for compatibility. Rock progress is derived from completed versus
remaining Tasks/Milestones; there is no manually entered percentage. Rock Tasks
can be opened for editing and deletion. Deleting a Task unlinks, but preserves,
an existing linked To-Do. Only unread, unconverted team messages are shown at
the start of Segue, with explicit Open, Mark read, and Create Issue actions.

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
applicable. When enabling the existing AI Function, also configure
`AI_WORKER_URL`, `AI_WORKER_SHARED_SECRET`, and `AI_CALLBACK_URL`; keep the
shared secret in secure deployment settings and configure the same secret on
the worker. Run
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

Existing users can be edited from the Admin user directory. Name, email, and
Platform Admin capability changes update the app profile in place; in Entra
mode, a changed email is allowed only when the new address resolves to the
same directory object ID.

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
