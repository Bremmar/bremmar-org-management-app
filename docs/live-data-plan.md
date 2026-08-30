# Connect Bremmar to live data

## Summary

Replace the in-memory demo workspace with a production API-backed workspace:

- React loads data from `/api`.
- Azure Functions reads and writes Cosmos DB.
- Microsoft Entra authenticates users.
- Bremmar manages roles and team membership.
- All Planner tasks are migrated once through a CSV import.
- Bremmar becomes the source of truth; no ongoing Planner sync.

Static Web Apps uses the workflow's `api_location` and `api_build_command` to
deploy the Functions API. See the [Static Web Apps build configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration).

## Implementation changes

### API and data

Expand the Functions API with:

- `GET /api/me`
- `GET /api/teams/{teamId}/workspace`
- Rock status updates
- To-Do creation and status updates
- Issue creation, IDS start, and solve actions
- Meeting close and recap persistence
- Planner CSV preview and commit endpoints

Every request will:

- Read the Entra client principal supplied by Static Web Apps.
- Resolve the stable user ID.
- Validate Bremmar membership and role in Cosmos.
- Reject unauthorized team access server-side.
- Use Cosmos partition `team:{teamId}` for team records.
- Use optimistic concurrency with ETags/version checks.
- Write immutable audit events for important changes.

The frontend will receive typed DTOs rather than Cosmos documents.

### Frontend

Add an `HttpWorkspaceApi` implementation and make it the production default.

The app will:

- Load the signed-in user and accessible teams from `/api/me`.
- Load the selected team's live workspace from Cosmos.
- Show loading, retry, empty, unauthorized, and API-error states.
- Never silently fall back to fake data in production.
- Keep `initialWorkspace` only as an explicit local-development fixture.
- Preserve the existing Rocks, To-Dos, Issues, Scorecard, and L10 workflows against live API mutations.

The existing Functions v4 entry point will remain `dist/index.js`, as required
by the Functions runtime. See the [Azure Functions TypeScript build options](https://learn.microsoft.com/en-us/azure/azure-functions/typescript-build-options).

### Cosmos and Azure configuration

Configure the existing Static Web App API settings with:

- `COSMOS_ENDPOINT`
- `COSMOS_KEY`
- `COSMOS_DATABASE`
- `COSMOS_CONTAINER`
- `BREMMAR_ORG_ID`
- Bootstrap administrator object ID

The Cosmos key will exist only as a server-side Static Web Apps API setting and
will never be sent to the browser.

Before deployment, verify that the existing Cosmos account permits key
authentication and network access from the Static Web Apps API. If key
authentication is prohibited, switch to the standalone Function App model with
managed identity; Static Web Apps managed APIs do not provide the same
managed-identity option. See the [Static Web Apps FAQ](https://learn.microsoft.com/en-us/azure/static-web-apps/faq).

## Planner migration

Build an Admin-only CSV migration flow:

1. Upload Planner exports.
2. Preview detected plans, teams, owners, dates, statuses, and duplicates.
3. Map Planner plans to Bremmar teams.
4. Resolve owners to Entra users.
5. Import every Planner task with source metadata and import-batch ID.
6. Convert Planner tasks into To-Dos only.
7. Store completed or old tasks as historical or archived records so they do not clutter the active weekly view.
8. Require explicit creation of Rocks and Issues in Bremmar.
9. Make imports idempotent using the Planner task ID.
10. Preserve rejected rows and warnings for correction.

After validation, freeze Planner edits and use Bremmar as the operational
source of truth.

## Testing and rollout

Add tests for:

- API authentication and cross-team authorization.
- OrgAdmin, TeamLead, Member, and Viewer permissions.
- Cosmos partition selection.
- ETag conflict handling.
- Rock, To-Do, Issue, IDS, and meeting transitions.
- Planner import mapping, duplicate detection, owner resolution, and archived tasks.
- Frontend loading, API errors, team switching, and mutation rollback.

Roll out in this order:

1. Configure Entra and Cosmos settings in a non-production Static Web Apps environment.
2. Bootstrap Bremmar's first OrgAdmin.
3. Import Planner data using preview mode.
4. Validate one pilot team.
5. Run the complete migration.
6. Verify `/api/health`, authenticated `/api/me`, team reads, and writes.
7. Move teams from Planner to Bremmar.

## Assumptions

- Bremmar already has the Static Web App, Cosmos account, and Entra tenant.
- The managed Static Web Apps API remains the selected production model.
- A server-side Cosmos key is acceptable for that model.
- A one-time migration is required; there will be no two-way Graph/Planner synchronization.
- All Planner tasks are migrated; completed and old tasks are archived from the active weekly view.
- Planner tasks become To-Dos; Rocks and Issues are created or reviewed manually.
- AI remains disconnected until explicitly enabled through the existing AI Function App.
