# Repository guidance for coding agents

## Project purpose and current state

This repository will contain a React/TypeScript application for managing the organisation's EOS Level 10 meetings across multiple teams.

The repository is currently greenfield. Inspect the existing tree, package manifests, configuration, and scripts before assuming that any planned directory or command exists.

## Target architecture

- React and TypeScript frontend hosted on Azure Static Web Apps.
- Azure Functions v4 application in `apps/api` for the core API and application authorization. The Static Web Apps workflow deploys it as the managed `/api` backend; the Bicep Function App is an alternative Bring Your Own Functions host for environments that require managed identity.
- Cosmos DB for NoSQL as the operational database, using team-oriented partitioning.
- Existing AI Function app remains separate and is not part of the core request path until AI is explicitly enabled.
- Prefer a target structure such as `apps/web`, `apps/api`, and `infra`, but create it only when the implementation requires it.
- Prefer Bicep for Azure infrastructure and managed identities for service-to-service access.
- Choose one API hosting mode per environment. Do not deploy the same API as both a Static Web Apps managed API and a linked standalone Function App.

## EOS domain rules

Keep these concepts distinct:

- **Rocks** are quarterly priorities owned by a person or team.
- **To-Dos** are owned commitments intended to be completed within seven days.
- **Issues** are unresolved problems, decisions, or opportunities that remain open until solved through IDS (Identify, Discuss, Solve).
- Solving an Issue may create one or more To-Dos.
- Off-track Rocks, off-track Scorecard measurables, and relevant Headlines may be added to the Issues list.
- L10 meetings use the structured seven-part agenda: Segue, Scorecard, Rock Review, Customer/Employee Headlines, To-Do Review, IDS, and Conclude.
- Meeting records should preserve attendees, statuses, IDS notes and decisions, created To-Dos, ratings, and the final recap.

Use the [EOS Level 10 agenda](https://www.eosworldwide.com/level-10-meeting) as the reference for meeting behavior.

## Authentication and authorization

- Use Microsoft Entra ID for authentication, scoped to the organisation's tenant.
- The application uses these roles: `OrgAdmin`, `TeamLead`, `Member`, and `Viewer`.
- Team membership and application roles are managed in the application data store, not inferred solely from client-side state or email domains.
- Enforce organization and team authorization on every API read and write. A user-selected team ID is never proof of access.
- Static Web Apps route protection is useful for requiring authentication, but it does not replace server-side API authorization.
- Use a stable Entra identity identifier as the user key. Email addresses and display names may change and must not be primary identity keys.
- Never expose Cosmos DB credentials, Function secrets, managed identity configuration, or other secrets in frontend code, committed configuration, logs, or error responses.
- Keep the core Function API inaccessible through an unauthenticated direct path, or validate authentication independently when a direct path is required.

See the [Static Web Apps authentication guidance](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization) and [API user information guidance](https://learn.microsoft.com/en-us/azure/static-web-apps/user-information) when implementing authentication.

## Cosmos DB data rules

- Use Cosmos DB for NoSQL through the server API; the browser must not connect directly to Cosmos DB.
- Use a synthetic partition key such as `org` for organization records and `team:{teamId}` for team operational records.
- Keep records that need atomic coordination during a team meeting in the same logical team partition.
- Include explicit entity kind, stable ID, team ID where applicable, quarter or meeting references, timestamps, actor identity, and version/concurrency data.
- Use optimistic concurrency for collaborative updates and immutable audit events for important changes.
- Design queries around the partition key. Avoid unbounded cross-partition scans; use bounded fan-out or maintained summaries for organization-wide views.
- Do not silently move unfinished Rocks or other work between quarters. Carry-forward must be an explicit, auditable action.
- Keep data access behind repository/service boundaries so storage-specific details do not leak into React components or API handlers.

Consult the [Cosmos DB partitioning guidance](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) before changing partitioning or query patterns.

## Product boundaries

- This application is the source of truth for EOS Rocks, To-Dos, Issues, Scorecards, Headlines, meeting records, and decisions.
- Planner migration is CSV-assisted in v1, with validation and import provenance. Do not add two-way Planner synchronization unless explicitly requested.
- V1 is a web application linked from Teams. Do not add a Teams tab, Graph notifications, or email reminders unless explicitly requested.
- V1 is AI-ready but does not perform AI enrichment. Preserve structured meeting context for a future, human-approved integration with the existing AI Function app.
- Team workspaces are shared by their members. Do not introduce private item-level visibility without an explicit product decision and security review.

## Development workflow

- Inspect before editing. Read relevant source, tests, configuration, and documentation before changing behavior.
- Follow existing repository conventions once they exist; do not introduce a competing framework or command pattern without a clear reason.
- Prefer typed API contracts and shared domain types over duplicated string literals or unvalidated payloads.
- Keep authorization and domain transitions in server-side services, not only in React components.
- Add or update tests for every behavior change, especially role checks, cross-team access, meeting transitions, quarter boundaries, and import validation.
- Before handoff, run the repository's available formatting, linting, type-check, build, and test commands. Do not invent commands when no package manifest or scripts exist; establish and document them as part of scaffolding.
- Use safe, non-destructive repository operations. Prefer `apply_patch` for edits and do not reset, delete, or overwrite unrelated user work.
- Keep generated files, local settings, credentials, and environment-specific values out of source control unless explicitly required.
- Update documentation when adding an API, Azure resource, permission, environment variable, migration rule, or operational dependency.

## Definition of done

A change is ready when it:

1. Matches the approved EOS workflow and product boundaries.
2. Enforces authentication, role, and team authorization server-side.
3. Preserves auditability and safe concurrent updates where relevant.
4. Includes appropriate automated tests and passes available checks.
5. Documents new setup, permissions, configuration, or deployment requirements.
