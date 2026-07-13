# Browser Base QA

Browser Base QA is an external reliability gate for PestFlow. It opens the real
PestFlow website in recorded Browserbase sessions, uses Stagehand to understand
what a human can see, checks exact technical contracts, and blocks a release when
the evidence is incomplete or broken.

In simple terms: PestFlow builds the product; this repository behaves like a
very strict customer and release inspector standing outside it.

## What it does

1. Confirms the intended PestFlow commit is actually deployed.
2. Runs read-only journeys as anonymous and owner personas.
3. Checks important pages across multiple desktop sizes.
4. Detects blank screens, wrong redirects, fatal text, console errors, failed
   first-party requests, missing actions, and layout overflow.
5. Uses Stagehand to recover from harmless selector drift while keeping business
   expectations and safety rules fixed.
6. Uses the authenticated owner browser session to verify 32 PestFlow API
   contracts behind the desktop, without storing response bodies.
7. Calls public health, database, and schema oracles.
8. Produces screenshots, Browserbase replay links, timings, and structured JSON.
9. Applies one release policy. Missing evidence blocks the release; infrastructure
   trouble is reported separately from a PestFlow product failure.

This cannot mathematically guarantee zero bugs. It makes production much more
brutal and effective by forcing every candidate to prove itself, continuously
testing the live product, and turning escaped bugs into permanent regression
tests instead of one-time fixes.

## Relationship to PestFlow

This is the reusable QA control plane. PestFlow remains the system under test.
The PestFlow repository should retain only product-side health endpoints,
deployment identity, safe fixture hooks, and the focused regression tests that
belong beside application code. Its deployment workflow can call
`.github/workflows/pestflow-release-gate.yml` from this repository and require a
green result before promotion.

## Quick start

```bash
npm install
cp .env.example .env
npm run audit
npm test
npm run guardian:dry-run
```

For a live recorded run, configure the Browserbase secrets and a dedicated,
non-customer PestFlow QA owner context, then run:

```bash
npm run guardian:tier0
```

Production writes are disabled by default. Do not point an authenticated context
at a real customer tenant.

The current Stagehand dependency tree reports low-severity resource-consumption
advisories in optional AI-provider packages, with no moderate, high, or critical
advisories. CI blocks at moderate severity while the upstream dependency is
tracked; it must not be "fixed" by downgrading Stagehand to an incompatible API.

## Activation status

The repository foundation and dry-run matrix are operational. Live public oracle
proof on July 12, 2026 passed database and schema checks but correctly blocked
the release contract because the currently deployed frontend and API health
responses do not yet expose `deployment.commitSha`. Browserbase secrets and the
isolated PestFlow owner context must also be added to this repository before its
scheduled authenticated run can execute. These are explicit activation blockers,
not claimed passes.

The owner API registry and Browserbase-session executor are now wired and covered
by six local policy tests. PestFlow's first equivalent synthetic-tenant production
sweep passed 31/32 and reproduced the already-known `/companies/branches` 500;
all five temporary accounts were deleted and login rejection was verified. The
repair remains on PestFlow's reviewed QA branch until deployment is authorized.
That branch now also protects scheduled SMS, signing email, team/portal invites,
and ProGlove scans before any provider call or persistence. Its exact head is
`a9c9e66` on PR #89. The complete local gate passed 794 unit tests, 48 Guardian
policy tests, 16 incident tests, TypeScript, lint, and the production build. The
read-only production inventory found zero mismatches across 536 provider/field
references and 259 paired relationships. Production is not certified until the
reviewed branch deploys and all 26 database constraints appear in `/health/schema`.

## Documentation

- [Product requirements](docs/PRD.md)
- [Codebase and folder guide](docs/CODEBASE_GUIDE.md)
- [PestFlow QA implementation guide](docs/PESTFLOW_QA_IMPLEMENTATION_GUIDE.md)
- [PestFlow integration](docs/PESTFLOW_INTEGRATION.md)
- [Activity tracker](tracker/Browser-Base-QA-Activity-Tracker.xlsx)
