# Live data and rollout plan

## Product boundary

Bremmar is the source of truth for the EOS operating system. The current phase
does not synchronize workspace data with Microsoft Planner, Teams, Graph,
email, or any other external service. Microsoft Graph is used only to resolve a
signed-in Entra username to its stable directory object ID at the API boundary.
Work is stored in the application data model and surfaced in standalone team
workspaces and L10 meetings.

The browser can run against an explicit local POC fixture or the Functions API.
The API contains the production boundary for Cosmos DB and maps the
Static-Web-Apps-specific principal ID to the Entra object ID before applying
application authorization.

## Live and Test environments

The application has one shared frontend and one API deployment backed by two
Cosmos databases and one Azure Storage Table:

- `eos-live` stores the production workspace.
- `eos-test` stores the dedicated sanitized Test workspace.
- `EnvironmentAccess` stores environment definitions, per-user Test grants, and
  grant audit events in the `org` partition.

Live is always the post-sign-in default. An authenticated organization user has
Live access by default; Test is shown only when an OrgAdmin has granted access
for that user's stable Entra object ID. Test access does not copy or modify Live
memberships, roles, teams, or work records, and there is no automatic
Live-to-Test synchronization.

The selected environment is held in a signed, `HttpOnly`, `Secure`,
`SameSite=Lax` cookie. The API validates the signature and the current control
plane grant on every request before selecting a workspace repository. Missing,
malformed, or tampered cookies resolve to Live; a revoked Test grant returns
`403` even if an old Test cookie remains in the browser. The client never uses a
query parameter or local-storage value as an authorization signal.

## Workspace hierarchy

The seeded hierarchy is:

```text
Leadership Team
├── Professional Services
│   ├── Projects
│   └── Cybersecurity
└── Managed Services
    ├── Service Development
    └── Service Delivery
```

Every seeded node is operational and can own its own Rocks, Tasks, To-Dos,
Issues, Scorecard, and L10. The Scorecard is configurable per team; for example,
Cybersecurity is seeded without it. Platform administrators can add nodes,
re-parent them, configure enabled L10 sections and section durations, define the
ordered escalation recipients, or make a node grouping-only after its direct
operational work has been resolved or moved.

## Data and authorization

- Operational records use `team:{teamId}` as their Cosmos DB partition key.
- Users, teams, memberships, settings, transfer envelopes, notifications, team
  messages, and audit events use the `org` Cosmos partition. Meetings and their
  IDS notes remain in the team partition with the operational records they
  coordinate. Environment definitions, Test grants, and environment access
  audit events use the `org` partition in the `EnvironmentAccess` Azure Table.
- Issues keep their stable ID and original `createdAt`. Because Cosmos
  partition keys are immutable, an accepted transfer is a versioned copy and
  redirect state machine: the source copy is redirected and the destination
  copy becomes active.
- Transfer decisions use a pending envelope, source version, transfer version,
  and idempotency key. The first valid TeamLead/Member decision wins.
- `PlatformAdmin` is a separate capability. It grants administration of
  organization configuration, not access to work data. Leadership membership
  grants read-only company visibility and read-only team drill-downs.
- All API reads and writes resolve access on the server. A selected team ID is
  never treated as proof of access.
- Important mutations produce immutable audit events and use version/ETag
  checks for optimistic concurrency.
- Rock, Issue, and To-Do detail edits are versioned. IDS notes are stored both on
  the meeting note record and as an append-only labeled entry on the Issue.
- Scorecard measurable definitions (`scorecardMetric`) and weekly results
  (`scorecardResult`) are team-scoped records in the owning `team:{teamId}`
  partition. Definitions keep the fixed target, unit, and accountable owner;
  results are keyed by `metricId + weekStartDate`, store the actual and
  explicitly selected status, and carry the derived trend. Workspace snapshots
  include definitions for authorized teams and only bounded current-quarter
  weekly results.
- TeamLead, Member, and existing OrgAdmin memberships can edit scorecard
  definitions and weekly results. Viewer memberships and Leadership-only
  visibility can read them but cannot write them. Grouping-only nodes cannot
  own scorecard measurables.
- A To-Do due-date edit is the rollover action: when incomplete work receives a
  later date, the API increments `carryForwardCount`, reopens it, synchronizes
  any linked Rock Task, and flags/converts it once on the fourth rollover. An
  unchanged or earlier date is an ordinary edit, and completed To-Dos never
  accrue rollovers. The original To-Do remains visible for provenance.
- Meetings carry an ISO Monday-start `weekStartDate`. New meetings set it at
  creation; legacy records receive a non-destructive current-week fallback
  during normalization. L10 Scorecard content and meeting recaps use only the
  result matching that week key. Teams also store a `meetingCadence` of
  `weekly` or `monthly`; monthly recurrence preserves the configured day of
  month and clamps to the last valid day when needed. Each occurrence stores
  `scheduledDate` and `scheduledTime`. The current open occurrence can be
  rescheduled as a versioned, audited mutation without changing the team’s
  recurring cadence; closed occurrences cannot be rescheduled.
- An Issue counted in IDS for three closed meetings is scheduled to escalate in
  seven days. At the due point it routes through the team’s configured hierarchy
  and notifies the current recipient; an unresolved next level can be routed
  after the next seven-day interval.

The partitioning and transactional design follows the Cosmos DB guidance for
[partition keys](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning)
and
[transactional batches](https://learn.microsoft.com/en-us/azure/cosmos-db/transactional-batch).
Cross-partition Issue transfers must remain idempotent and recoverable because
the source and destination cannot be committed as one cross-partition batch.

## API surface

The Functions API exposes typed server contracts for:

- `GET /api/me` — local identity/session context and accessible hierarchy.
- `PUT /api/me/environment` — select `live` or granted `test` and set the signed
  environment cookie.
- `GET /api/workspace` — load the environment-scoped workspace snapshot used by
  the authenticated shell.
- `GET/PATCH /api/platform-admin/environment-access...` — OrgAdmin-managed Test access
  grants and immutable grant audit records; these routes are available from the
  Live Admin center only.
- `GET /api/teams/{teamId}/workspace` and the legacy dashboard route.
- `GET /api/company/overview` — Leadership-only read-only rollups.
- `GET/PATCH /api/notifications...` and `GET/PATCH /api/profile`.
- Rock, Rock Task, To-Do, Issue, IDS, and Task-to-To-Do routes.
- Team message send/read/convert-to-Issue routes and meeting IDS-note/close
  routes.
- `PATCH /api/teams/{teamId}/meetings/{meetingId}` — reschedule the current
  open meeting occurrence with `If-Match` concurrency protection.
- Weekly Scorecard routes:
  - `POST /api/teams/{teamId}/scorecard/metrics` creates a team measurable.
  - `PATCH /api/scorecard/metrics/{metricId}` edits its definition.
  - `PUT /api/scorecard/metrics/{metricId}/weeks/{weekStartDate}` upserts one
    Monday-start weekly actual and selected status, using `If-Match` for
    existing result versions.
- To-Do due-date rollover is handled by `PATCH /api/todos/{todoId}`; there is
  no separate move-forward endpoint or control.
- Issue transfer request, accept, reject, and cancel routes.
- Platform administration routes for teams, users, memberships, aging settings,
  L10 section configuration, and escalation hierarchies.

The API returns `401`, `403`, `404`, `409`, and `422` for the corresponding
authentication, authorization, not-found, concurrency, and validation cases.

## Local POC mode

Copy the API sample settings when running Azure Functions locally and keep
`LOCAL_POC_MODE=true` only for local development:

```json
{
  "LOCAL_POC_MODE": "true",
  "LOCAL_POC_USER_ID": "ava-khan"
}
```

The POC has one seeded local PlatformAdmin user. This bypasses real login only
when explicitly enabled. Before shared or production deployment, disable the
flag and configure the API's Entra identity resolver with the tenant and
Microsoft Graph application credentials (or a managed identity with
`User.Read.All`). The application-level memberships and capabilities remain the
authorization source of truth.

## Rollout sequence

1. Validate the local hierarchy, role matrix, transfer and messaging workflows,
   aging/escalation behavior, task/To-Do synchronization, meeting recap/IDS
   notes, and readable responsive layouts.
2. Provision the two workspace databases/containers and the `EnvironmentAccess`
   Azure Table, then configure the Cosmos and storage connection strings before
   running `bootstrap:environments` with the initial OrgAdmin and approved Test
   administrator object IDs.
3. Verify the smoke path: authenticate, confirm Live is selected, grant Test
   access from Live Admin, switch to Test, edit a record, switch back to Live,
   and confirm the Live workspace is unchanged.
4. Verify the Cosmos conditional ETag writes and same-partition transactional
   batches in the deployment smoke test before selecting the API for shared
   traffic.
5. Disable local POC mode, configure the approved Entra identity resolver, and
   verify that the signed-in user's Graph object ID matches the bootstrapped
   local profile ID.
6. Pilot with one operational team, then add the remaining teams and validate
   Leadership read-only rollups.

No Planner import, migration, or two-way synchronization is part of this
phase. A future import can be designed as a separate, explicit migration with
provenance and validation if the product decision changes.

## Follow-on roadmap

The current UI includes long-term Issues, Issue history/audit, priorities,
Rock Tasks/Milestones, linked To-Dos, team workspaces, role-aware visibility,
company rollups, and profile avatars.

Follow-on capabilities remain intentionally separate: My 90 personal view,
comments/followers, notification preferences, archive/restore, permission-aware
search, ranking/voting/Top 3, deadline-based conversion, and Org Chart seats and
directory enhancements.
