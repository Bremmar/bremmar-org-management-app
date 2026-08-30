# Bremmar · EOS operating hub

Bremmar is a React-based operating hub for multi-team EOS Level 10 meetings.
It brings quarterly Rocks, weekly To-Dos, Issues/IDS, Scorecard measurables,
Headlines, and meeting history into one shared workspace.

## Repository layout

- `apps/web` — React + TypeScript frontend for Azure Static Web Apps.
- `apps/api` — Azure Functions v4 API deployed at the Static Web Apps `/api` route.
- `infra` — Bicep foundation for Static Web Apps, Functions, and Cosmos DB.
- `AGENTS.md` — project guidance for coding agents and contributors.

## Local development

```bash
npm install
npm run dev
```

The frontend currently runs with a local workspace API so the product flow can
be explored before Azure resources and Microsoft Entra configuration are
available. The API package can be built independently with `npm run build:api`.

If Azure Functions Core Tools is installed, build the API first and run it
locally with `func start --script-root apps/api`.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

## Deployment notes

The frontend workflow expects the `AZURE_STATIC_WEB_APPS_API_TOKEN` GitHub
secret. It deploys `apps/web` as the static frontend and `apps/api` as the
managed Azure Functions API under `/api`. The API's `main` field points Azure
Functions at `dist/index.js` after the TypeScript build.

`infra/main.bicep` also contains a separate Bring Your Own Functions deployment
for environments that require a dedicated Function App and managed identity
for Cosmos DB. Choose one API hosting mode per environment; do not deploy both
to the same `/api` route. Configure a single-tenant Microsoft Entra provider
before allowing production traffic.
