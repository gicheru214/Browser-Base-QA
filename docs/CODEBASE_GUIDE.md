# Codebase guide

## How the pieces work together

The journey registry says what must be true. The Stagehand runner opens a
Browserbase session and gathers evidence. Public oracles check the deployed
services behind the screen. The release verdict compares all required evidence
with the quality policy and returns pass, warning, or blocked.

## Folders

| Path | Purpose |
| --- | --- |
| `qa/guardian/` | PestFlow journey, route, authenticated API, device, change, oracle, and release-policy definitions. This is the source of truth for coverage. |
| `scripts/` | Executable QA programs: Browserbase/Stagehand runner, public outcome-oracle runner, change selector, and release verdict. |
| `scripts/lib/` | Pure policy, evidence filtering, deployment-preflight, oracle, and verdict logic used by the commands and tests. |
| `test/` | Fast contract tests that reject an invalid registry, unsafe action policy, route drift, or unsafe oracle configuration. |
| `.github/workflows/` | Scheduled live QA and a reusable release gate that PestFlow can call before promotion. |
| `docs/` | Product requirements, integration contract, and this code map. |
| `tracker/` | Human-reviewable Excel tracker with the activity log, QA checks, product gaps, tasks, and overview. |
| `artifacts/` | Generated run evidence. It is intentionally ignored by Git and uploaded by Actions. |

## Important files

| File | What it does |
| --- | --- |
| `qa/guardian/desktop-journeys.json` | Defines personas, four desktop sizes, safe journeys, semantic expectations, and forbidden content. |
| `qa/guardian/desktop-owner-route-catalog.json` | Defines the 27 owner routes and their stable readiness contracts. |
| `qa/guardian/desktop-owner-api-contracts.json` | Defines 32 authenticated owner GET contracts, required JSON keys, and required array shapes. |
| `qa/guardian/outcome-oracles.json` | Defines GET-only frontend, API, database, and schema checks. |
| `qa/guardian/quality-policy.json` | Defines what evidence is required and what blocks release. |
| `qa/guardian/change-map.json` | Maps PestFlow code areas to the journeys and deterministic suites they must trigger. |
| `scripts/qa-guardian-stagehand.mjs` | Creates isolated Browserbase sessions, runs Stagehand, enforces read-only policy, records evidence, and writes the browser summary. |
| `scripts/lib/qa-owner-api-contracts.mjs` | Validates and executes all owner API contracts inside the authenticated browser session, retaining only status/schema/timing metadata. |
| `scripts/lib/qa-guardian-policy.mjs` | Validates the registry, navigation, semantic results, and proposed browser actions. Stagehand cannot override it. |
| `scripts/lib/qa-browser-evidence.mjs` | Separates customer-critical console/network failures from known browser or third-party noise and redacts sensitive URL data. |
| `scripts/lib/qa-deployment-preflight.mjs` | Waits for the expected PestFlow commit to appear at the deployed health endpoint so the wrong build cannot receive a false pass. |
| `scripts/qa-outcome-oracles.mjs` | Runs the public GET-only service and schema checks without retaining response bodies. |
| `scripts/qa-release-verdict.mjs` | Combines selected coverage, deterministic results, browser evidence, and oracles into one fail-closed decision. |

## Safety boundary

Stagehand is allowed to understand and locate controls; it is not trusted to
decide what is safe. The registry and policy code reject delete, send, charge,
refund, credential, invitation, integration-disconnect, and subscription actions.
Authenticated contexts must belong to isolated QA tenants. Evidence artifacts
must not contain passwords, tokens, customer page content, or raw API bodies.
The owner API executor parses responses inside the browser and returns only
status, content type, duration, top-level key names, and declared array counts.

## Adding coverage

Add or change the route/journey contract, add a policy test, run `npm test` and
`npm run guardian:dry-run`, then perform a recorded run. A discovered production
bug belongs in the incident tracker and must become a deterministic application
regression test plus the appropriate outside-in journey before it is closed.
