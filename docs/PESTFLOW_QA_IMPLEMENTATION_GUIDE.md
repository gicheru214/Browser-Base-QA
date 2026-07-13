# PestFlow QA Guardian Codebase Guide

This guide describes the QA and reliability code introduced or integrated by the
Reliability Command Center foundation. It is scoped to the QA system, its release
hooks, and the health metadata it needs; it is not a catalog of every PestFlow
application feature.

## 1. How the system works end to end

1. A pull request changes PestFlow code.
2. The change selector compares changed file paths with the versioned change map.
3. It selects required Browserbase journeys, devices, deterministic suites,
   read-only outcome oracles, and the maximum risk tier.
4. Pull-request CI validates policy, tests the incident classifier, and builds the
   exact source. It does not pretend current production validates undeployed code.
5. After a candidate is deployed, a deploy workflow calls the reusable release
   gate with app/API URLs and the expected commit SHA.
6. The candidate health endpoint must report that SHA. The runner waits briefly
   for rollout and fails as `deployment_not_ready` if the exact build never appears.
7. Public GET-only oracles verify frontend/API health, database reachability and
   clock freshness, critical schema structures, and both deployed service SHAs.
8. Playwright runs precise desktop checks. Browserbase/Stagehand runs only the
   selected policy-controlled semantic journeys.
9. The centralized verdict requires all selected evidence. Missing credentials,
   skipped required personas, absent summaries, or failed checks block release.
10. Failures are normalized, classified, fingerprinted, and packaged. An
   infrastructure-only failure does not create a product repair.
11. Repeated product failures update the same incident/branch/PR. A staging repair
    handoff is generated only after the product criteria are met.

## 2. Folder map

| Folder | Purpose |
|---|---|
| `qa/guardian/` | Versioned source of truth for desktop journeys, code-risk mapping, and release policy. |
| `scripts/lib/` | Small, testable decision libraries: policy, selection, deployment proof, classification, and verdict logic. |
| `scripts/` | Executable runners, report builders, incident packagers, repair handoffs, and their Node tests. |
| `e2e/` | Deterministic Playwright suites for critical desktop and broader feature behavior. |
| `.github/workflows/` | Schedules, PR checks, candidate release gate, existing canaries, and repair orchestration. |
| `.github/codex/` | Guardrails and instructions for the staging repair agent. |
| `server/` | PestFlow frontend/API health responses used to prove the deployed commit. |
| `docs/reliability-command-center/` | Product PRD and this engineering guide. |
| `docs/qa-guardian.md` | Day-to-day setup and operations runbook. |
| `artifacts/qa-guardian/` | Generated selection, run summaries, per-step result JSON, and screenshots; not source. |
| `artifacts/desktop-critical/` | Generated deterministic desktop evidence; not source. |
| `artifacts/staging-features/` | Generated delegated whole-app evidence; not source. |

## 3. Registry and policy files

### `qa/guardian/desktop-journeys.json`

Defines the current PestFlow desktop test catalog:

- personas and the environment variable holding each Browserbase context;
- 1920×1080, 1440×900, 1280×800, and 1024×768 devices;
- five journey families for auth, owner core, owner operations, owner growth and
  integrations, and public tools;
- step types (`navigate`, `extract`, `observe`, `act`, and combined route check);
- required concepts, forbidden content, expected paths/statuses, ready selectors,
  and safe action policy;
- tier, schedule, code areas, and delegated deterministic coverage.

It currently expands to 12 full tier-0/1 journey-device sessions. Production
journeys default to read-only observation.

### `qa/guardian/change-map.json`

Maps code globs to blast radius. A rule selects journey IDs, devices, maximum
tier, the deterministic critical suite, and/or the delegated 48-feature suite.
Tests enumerate every non-mobile file under `src/features` so a new desktop
feature cannot silently remain unmapped.

### `qa/guardian/quality-policy.json`

Central release requirements: which evidence is mandatory, whether skipped
journeys are allowed, and hydration warning/failure thresholds. Both workflows
and local verdict tests consume the same policy.

### `qa/guardian/outcome-oracles.json`

Defines the public, production-safe release outcomes. The current four checks
cover frontend health, API health, database reachability/current clock, and the
critical desktop schema. The registry permits GET requests only, forbids query
strings, and identifies which service health response must match the candidate
SHA. The schema check also requires all 26 core, operational, provider, and field tenant-integrity foreign
keys, preventing a skipped migration from looking healthy.

## 4. Core libraries

### `scripts/lib/qa-guardian-policy.mjs`

Validates registry structure, expands tier/device filters, checks expected
navigation, validates Stagehand structured extraction, and rejects unsafe observed
actions. It is the main boundary preventing a semantic agent from freelancing in
production.

### `scripts/lib/qa-change-selector.mjs`

Implements glob matching and converts changed files into selected journeys,
devices, risk tier, deterministic-suite requirements, and unmatched-file evidence.

### `scripts/lib/qa-deployment-preflight.mjs`

Normalizes full/abbreviated Git SHAs, polls the candidate `/health` endpoint, and
requires `deployment.commitSha` to match the requested candidate. This prevents
QA from certifying an older build during a Railway rollout.

### `scripts/lib/qa-browser-evidence.mjs`

Sanitizes failed request/response metadata, redacts sensitive query parameters,
separates first-party customer-critical failures from analytics/abort noise, and
filters benign page errors. API 5xx, rate limits, missing documents/scripts, and
first-party connection failures become explicit failed steps with evidence.

### `scripts/lib/qa-outcome-oracles.mjs`

Validates the GET-only oracle registry, pins requests to configured origins,
applies timeouts, evaluates typed JSON assertions, checks candidate SHAs, and
returns sanitized results with the configured environment label. It deliberately
retains assertion results and HTTP metadata, never the response body.

### `scripts/lib/qa-release-verdict.mjs`

Combines selection, Browserbase configuration, deterministic exit code, delegated
feature-suite exit code, Guardian summary, skipped personas, and quality policy
into one allow/block decision.

### `scripts/lib/qa-failure-classifier.mjs`

Normalizes failures, separates product signals from GitHub/artifact/browser/test
infrastructure, assigns a category, and creates a stable SHA-256-derived incident
fingerprint from customer-relevant evidence.

## 5. Executable scripts and tests

| File | Responsibility |
|---|---|
| `scripts/qa-guardian-stagehand.mjs` | Main Browserbase/Stagehand runner. Loads the registry, validates filters, verifies deployed SHA, creates isolated sessions, applies policy, records screenshots/console/history/metrics/replay URLs, and writes the summary. |
| `scripts/qa-deployment-preflight.mjs` | Standalone candidate-release preflight. It verifies the deployed SHA before any selected deterministic or semantic suite and writes auditable JSON evidence. |
| `scripts/qa-guardian-select.mjs` | CLI used by CI to calculate risk-based coverage and write `selection.json` plus GitHub outputs. |
| `scripts/qa-outcome-oracles.mjs` | Runs the public GET-only frontend/API/DB/schema oracles and writes sanitized release evidence. |
| `scripts/qa-operational-tenant-integrity.ts` | Runs an acknowledged, database-enforced read-only production inventory and emits only aggregate mismatch counts, QA/non-QA buckets, ownership/name relationship buckets, distinct-pair counts, and first/last timestamps. |
| `scripts/qa-release-verdict.mjs` | CLI that reads generated evidence, including required oracle results, and exits nonzero when the centralized release policy blocks. |
| `scripts/qa-build-incident.mjs` | Reads workflow/test artifacts, classifies the failure, fingerprints it, and creates a normalized incident package and summary. |
| `scripts/qa-build-codex-handoff.mjs` | Turns a qualified incident into a constrained staging repair handoff with evidence and explicit safety rules. |
| `scripts/qa-run-staging-repro.mjs` | Runs the incident's reproduction command against staging for repair qualification. |
| `scripts/qa-send-handoff-email.mjs` | Sends the human-readable handoff notification when policy allows it. |
| `scripts/qa-guardian-policy.test.mjs` | Registry, route-coverage, production action safety, semantic state, and navigation tests. |
| `scripts/qa-change-selector.test.mjs` | Change-map validity, feature-file completeness, glob behavior, shared-shell blast radius, docs-only behavior, and delegated-suite selection. |
| `scripts/qa-deployment-preflight.test.mjs` | Exact/abbreviated SHA matching, stale rollout polling, skip behavior, and timeout evidence. |
| `scripts/qa-browser-evidence.test.mjs` | First-party API/asset failures, expected auth responses, analytics/abort noise, redaction, and page-error filtering. |
| `scripts/qa-outcome-oracles.test.mjs` | Registry safety, GET enforcement, origin pinning, JSON assertions, timestamp freshness, SHA matching, and body non-retention. |
| `scripts/qa-release-verdict.test.mjs` | Green, missing Browserbase, missing/skipped evidence, hydration, and delegated-suite gate cases. |
| `scripts/qa-failure-classifier.test.mjs` | Product versus infrastructure classification and fingerprint stability. |
| `scripts/qa-build-incident.integration.test.mjs` | End-to-end incident packaging from realistic workflow artifacts and metadata. |
| `src/test/companyReferences.test.ts` | Locks malformed-ID rejection, company ownership, parent/customer consistency, normalized persistence IDs, and route wiring for the shared validator. |
| `src/test/coreTenantWriteRoutes.test.ts` | Proves six core desktop write routes return 404 before persistence when supplied references belong outside the authenticated company. |
| `src/test/remainingTenantWriteRoutes.test.ts` | Proves scheduled SMS, trap scans, team/portal invites, and signing emails reject foreign references or unauthorized recipients before persistence or provider delivery. |
| `src/test/providerDiagnosticSafety.test.ts` | Locks the Stripe diagnostic confirmation, ten-minute operation-specific idempotency, and confirmation wiring in every desktop/mobile caller. |
| `src/test/resendIdempotency.test.ts` | Locks deterministic, hashed provider event identity and the intentional manual resend window. |
| `src/test/resendIdempotencyCoverage.test.ts` | AST-scans all direct Resend calls so a new delivery path cannot bypass retry protection. |
| `src/test/serverReliabilityContracts.test.ts` | Locks full-stack typecheck wiring, Stripe SDK compatibility, and Website Chat import integrity. |
| `scripts/desktop-critical-report.mjs` | Aggregates deterministic desktop results and API health into report artifacts. |
| `scripts/desktop-critical-notify.mjs` | Formats/sends desktop critical workflow notification evidence. |
| `scripts/run-staging-features-qa.mjs` | Runs broader staging feature coverage and records Railway health. |
| `scripts/staging-features-report.mjs` | Converts the broad feature run into a structured coverage report. |
| `scripts/staging-features-notify.mjs` | Formats/sends the broad feature-suite result. |

## 6. Playwright suites

### `e2e/desktop-critical-workflows.spec.ts`

Thirteen deterministic production-safe desktop checks cover API/asset health, auth
entry, onboarding, customer/job/invoice persistence, cross-tenant denial, invited
role scoping, invoice identifiers/status, appointment mutation, company-branch
invariants, Settings/Inventory resource lifecycles, and responsive owner surfaces
at 1440, 1280, and 1024 widths. Before
the state-changing scenarios, it consumes a 32-endpoint owner API registry and
the shared 27-route owner catalog, attempting 32 authenticated data contracts and
81 route/width checks.
It asserts exact path/authentication, stable readiness, nonblank content,
horizontal overflow, fatal UI text, console/page errors, first-party 429/5xx,
failed same-origin requests, and missing documents/scripts. It writes
`owner-route-matrix.json` and delays the aggregate route failure until `afterAll`,
so business/security coverage and cleanup still run after a broken screen.
The API sweep similarly requires HTTP 200, JSON, required keys, and declared
array types, then writes `owner-api-contracts.json` without retaining response
bodies. The branch lifecycle creates two disposable branches, proves exactly one
primary remains, rejects cross-tenant mutation, safely transfers primary status,
and prevents deactivating the final primary branch.
The resource lifecycle independently creates, lists, updates, isolates, deletes,
and re-lists equipment, preset notes, and chemical products in the disposable
owner company. Explicit deletion is asserted before account teardown, while the
company cascade remains a second safety net if an assertion stops midway.
The provider-safe communications lifecycle creates and updates an unsigned
recipient-free service document, creates/archives a response template, creates
and deletes a disabled auto-response rule, writes one internal team message and
marks it read as an invited teammate, then changes and restores in-app
notification preferences. The suite deliberately omits signature data, recipient
addresses, enabled rules, sends, charges, and provider calls.
The operational-inventory lifecycle creates job equipment use and a chemical
application, proves job/customer rollups, tries both associations from an
unrelated owner, removes the explicit equipment-use row, and leaves only
company-cascaded synthetic records. The server rejects invalid UUIDs and checks
every supplied job, customer, technician, and equipment reference against the
caller company before either insert.

### `migrations/a24_operational_tenant_integrity.sql`

Creates composite `(company_id, id)` uniqueness on referenced tables and
seventeen composite foreign keys for jobs, invoices, notes, agreements,
documents, contracts, chemical logs, and job-equipment usage. The
foreign keys are `NOT VALID`, which means new or changed rows are enforced while
the three already-audited historical mismatches remain untouched. After a
separately approved repair, the constraints can be validated without changing
the application contract.

### `migrations/a25_provider_field_tenant_integrity.sql`

Makes the ProGlove trap-scan table reproducible from source and adds nine
composite tenant foreign keys across notification email, scheduled SMS, invites,
and ProGlove records. Tenant-preserving `ON DELETE SET NULL` actions clear only
the optional reference, never the non-null company ID. A disposable PostgreSQL
17 verification proved cross-company inserts fail and valid reference deletion
retains the tenant boundary.

The suite creates only prefixed identities on the reserved E2E domain. A callback
registers each account for cleanup immediately after signup returns, before later
setup can fail. The reverse-order teardown restores any session invalidated by a
role-switch test, deletes the account, checks for a null session, retries through
bounded authentication throttles, and proves the same credentials can no longer
sign in. The hook writes `fixture-cleanup.json` and throws an aggregate failure
if any account or proof is incomplete.

### `e2e/staging-feature-pages.spec.ts`

The delegated broad desktop suite checks the large feature catalog on staging.
The QA work replaced a brittle hard-coded “Tools 72” label with a stable
`desktop-tools-trigger` test ID and semantic text so adding a legitimate tool no
longer creates a false regression. Local execution defaults to the dedicated
`127.0.0.1:5187` server, requires `--strictPort`, and refuses to reuse a running
server unless `E2E_REUSE_EXISTING_SERVER=1` is deliberately set. This keeps a
different worktree's Vite process from producing false evidence.

Other existing Playwright workflows remain separate specialist layers and are
consumed by incident orchestration rather than being deleted or duplicated.

### `checkly/browser/desktop-login.spec.ts`

Uses the existing canary owner account as an interim authenticated production
fallback while Browserbase activation is pending. After login it performs a
read-only sweep of every static owner path in `desktop-owner-route-catalog.json` at
1366×900: 27 paths across the core desk, operations, compliance, messaging,
integrations, sales, and settings. A policy test compares the two registries and
fails if they drift. The check records per-route readiness timing, tags
first-party 5xx/connection evidence with the active page path, and emits
sanitized route-state diagnostics on failure without query strings or page
content. It never clicks create/send/payment actions.
The GitHub proof workflow can run it in isolation without email; updating the
managed six-hour Checkly monitor remains a deliberate post-review deploy. The
workflow's single CLI retry mirrors the retry configured on every managed check;
first-attempt failures remain in the session evidence.

### Shared owner-route and application contracts

| File | Responsibility |
| --- | --- |
| `qa/guardian/desktop-owner-route-catalog.json` | One 27-route readiness catalog consumed by deterministic production coverage and the Checkly owner fallback. |
| `qa/guardian/desktop-owner-api-contracts.json` | One 32-endpoint authenticated GET registry covering the data contracts behind the owner desktop. |
| `src/components/AppLayout.tsx` | Supplies a navigation-derived title when a feature omits one, preventing the shared help center from crashing the page. |
| `src/components/DesktopHelpCenter.tsx` | Normalizes title defensively and memoizes checklist actions without weakening visible-page assertions. |
| `src/features/operations/SmsContacts.tsx` | Supplies the required SMS Contacts layout title and keeps its loading/error callbacks lint-safe. |
| `src/features/operations/MessageResponses.tsx` | Supplies the correct Common Replies, email inbox, or VoIP layout title. |
| `server/routes/companies.ts` | Implements company-scoped branch list/create/update/soft-deactivate routes before the dynamic company-id route. |
| `server/routes/job-equipment-used.ts` | Rejects cross-company or invalid job/equipment references before recording visit equipment. |
| `server/routes/chemical-logs.ts` | Rejects cross-company or invalid customer/technician/job references before recording regulated application history. |
| `server/lib/companyReferences.ts` | Shared UUID, company-ownership, and parent/customer consistency validator for core desktop writes. |
| `server/routes/jobs.ts` | Validates customer, location, technician, and location/customer consistency before job creation or reassignment. |
| `server/routes/invoices.ts` | Validates customer/job ownership and job/customer consistency before invoice creation; the real Stripe test-send requires explicit confirmation and operation-specific ten-minute idempotency. |
| `server/routes/customer-notes.ts` | Validates customer/job ownership and their relationship before adding a note. |
| `server/routes/service-agreements.ts` | Validates the agreement customer before persistence. |
| `server/routes/service-documents.ts` | Validates customer and invoice ownership before document creation or linkage. |
| `server/routes/service-types.ts` | Validates the customer before creating an enrollment contract. |
| `server/routes/sms-scheduled.ts` | Validates scheduled-message customer/job ownership and job/customer consistency before persistence. |
| `server/routes/proglove.ts` | Validates optional job/customer/technician ownership before recording a field scan. |
| `server/routes/invites.ts` | Validates supplied technician and optional customer ledger references before invite or portal-provider work. |
| `server/routes/messaging.ts` | Requires an owned document/customer and matching recipient before contract-signing email can reach Resend. |
| `server/routes/feature-actions.ts` | Sends owner-facing feature-action receipts; its 28-email staging proof endpoint fails closed with 404 in production. |
| `server/lib/resendIdempotency.ts` | Generates non-PII SHA-256 Resend keys and the one-minute bucket used only for intentionally repeatable human actions. |
| `server/lib/sqlJson.ts` | Converts loosely typed request/internal metadata to a validated JSON-safe postgres.js parameter before persistence. |
| `tsconfig.server.json` | Adds the complete Hono server tree to TypeScript verification; `npm run typecheck` now checks frontend and server together. |
| `src/test/companyBranchesRoute.test.ts` | Locks route ordering, company isolation, name validation, creation, and primary-branch protection. |
| `src/test/operationalInventoryTenantScope.test.ts` | Locks UUID validation and tenant ownership for equipment-use and chemical-application writes. |
| `src/test/companyReferences.test.ts` | Locks the reusable core reference validator and its audited route inventory. |
| `src/test/coreTenantWriteRoutes.test.ts` | Locks foreign-reference rejection across notes, jobs, invoices, agreements, documents, and contracts. |
| `src/test/remainingTenantWriteRoutes.test.ts` | Locks provider/field rejection and proves external delivery is not reached for unauthorized input. |
| `src/test/providerDiagnosticSafety.test.ts` | Locks production bulk-preview denial and Stripe diagnostic confirmation/idempotency across all callers. |
| `src/test/resendIdempotency.test.ts` | Proves stable durable retries, event isolation, non-PII keys, and the manual resend minute boundary. |
| `src/test/resendIdempotencyCoverage.test.ts` | Parses every server TypeScript file and fails when a direct Resend request lacks an `Idempotency-Key`. |
| `src/test/serverReliabilityContracts.test.ts` | Locks the full server typecheck/release wiring plus current Stripe and Website Chat SDK contracts. |
| `src/test/desktopAppLayoutContract.test.ts` | Locks the title fallback and both previously crashing feature titles. |

The disposable cloud browser may receive two first-run local onboarding dialogs
even when the canary account already exists. Payment onboarding intentionally
schedules setup-goal onboarding after it closes, so a one-pass dismissal races
the second timer. The spec uses a bounded polling state machine, closes only the
two known dialogs through Radix's normal `onOpenChange(false)` path, waits for a
quiet window, and then asserts the Reports heading. This changes only local
browser onboarding state and prevents an overlay from hiding owner-page headings
from the accessibility tree.

### `checkly/browser/mobile-field-signup.spec.ts`

Creates a fresh email signup identity and verifies that the live mobile field
app advances from signup to the active role-selection screen. Assertions are
scoped to the active auth screen so dormant screens and sample modals that remain
in the single-page app DOM cannot create a false failure. The GitHub proof
workflow can run this check alone with `mobile_signup_only=true` and no email.

### `src/routes/redirects.tsx`

Owns the shared lazy-route fallback used while protected desktop code or session
state is loading. It immediately exposes an accessible `Loading PestFlow…`
status. After twelve seconds it explains that loading is delayed and offers a
`Reload PestFlow` recovery action, preventing a long anonymous spinner from
looking like a dead application. `src/test/routeFallback.test.tsx` locks both the
ordinary and delayed states.

## 7. GitHub Actions workflows

### New orchestration

#### `.github/workflows/desktop-stagehand-guardian.yml`

Runs tier 0 hourly, the full matrix nightly, and selected tiers/devices manually.
It checks Browserbase configuration before spending sessions, uses one concurrency
group to protect shared contexts, records summaries, and uploads evidence with
short retention. The public outcome oracles still run when Browserbase is not
configured, so API, database, schema, and service-identity regressions remain
detectable. Missing Browserbase configuration is reported as setup, not a product
bug.

#### `.github/workflows/desktop-qa-release-gate.yml`

On pull requests it validates selection/policy/incident logic and builds source.
As a `workflow_call` or manual run after deployment, it accepts candidate app/API
URLs, environment, base ref, full-run flag, and expected SHA. It runs public
outcome oracles, installs Chromium only when selected, runs deterministic/
Stagehand/delegated suites, and enforces one central verdict. A deployment pipeline should require this reusable workflow
before promoting the same commit.

### Existing workflows integrated or hardened

| Workflow | Role in the system |
|---|---|
| `desktop-critical-integration.yml` | Scheduled/manual deterministic critical desktop proof. |
| `desktop-50-gorilladesk-features.yml` | Broad staging/feature regression coverage. |
| `daily-canary.yml` | API, DB, auth, and production canary layer. |
| `mobile-field-morning.yml` | Mobile field workflow layer. |
| `mobile-auth-onboarding.yml` | Mobile authentication/onboarding layer. |
| `mobile-crash-watchdog.yml` | Mobile crash and entry regression layer. |
| `checkly-proof-report.yml` | Checkly synthetic proof aggregation. Manual runs default to no email; scheduled proof still emails. |
| `qa-codex-staging-repair.yml` | Incident packaging, stable repair branch/PR reuse, staging handoff, and notifications. |

Artifact uploads were made nonblocking with seven-day retention where needed.
That preserves evidence when quota is available without turning storage quota
exhaustion into a false PestFlow failure.

## 8. Repair guardrails

### `.github/codex/prompts/qa-staging-repair.md`

Defines how a repair agent must read evidence, reproduce on staging, avoid broad
or destructive changes, add a regression test, and leave a reviewable draft PR.

### `docs/qa-codex-staging-handoff.md`

Explains operator expectations, incident qualification, deduplication, and why an
infrastructure-only run must not trigger product repair.

### Stable occurrence handling

`qa-codex-staging-repair.yml` derives one branch/PR identity from the incident
fingerprint. If it already exists, a new occurrence is committed/commented on the
same repair rather than generating duplicate email, branch, and PR noise.

## 9. Server-side release and fixture safeguards

### `server/lib/qaIdentity.ts`

Normalizes email values and defines two deliberately separate boundaries: the
whole reserved `pestflow-e2e.test` domain for suppressing customer communication,
and the narrower `codex-critical-` prefix plus domain required before destructive
desktop-suite cleanup. Lookalike and non-string values are rejected.

### `server/lib/signupWelcomeEmail.ts`

Returns `internal_test_recipient` before any SQL log or email-provider work for
the reserved E2E domain. Normal signup welcome and activation behavior is
unchanged for real recipients.

### `server/lib/accountDeletion.ts`

Keeps optional user-scoped cleanup best-effort, but makes owned-company deletion
strict. The auth user is not deleted if the company cascade fails, preventing an
orphaned customer/job/invoice business graph. Unit tests lock both ordering and
failure propagation.

### `scripts/qa-fixture-inventory.ts`

Runs only after an explicit `read-only` acknowledgement and forces the Postgres
transaction into read-only mode. It counts reserved-domain identities, auth rows,
owned companies, direct email references, and all nonempty company-scoped tables.
Its report contains table/column names and aggregate counts only. A source-policy
test rejects SQL write verbs from the inventory script.

### `scripts/qa-operational-tenant-integrity.ts`

Requires `QA_OPERATIONAL_TENANT_AUDIT_CONFIRM=read-only`, forces a Postgres
read-only transaction, and counts company/reference inconsistencies in
`chemical_logs` and `job_equipment_used`. It distinguishes reserved QA from
non-QA rows, same-owner from different-owner relationships, company-name parity,
same-name product availability, distinct company pairs, and the mismatch time
window without returning any record identifiers or business content. It also
counts eleven core company/reference relationships and four paired
customer/parent consistency relationships; the first production run found zero
mismatches across 453 populated core references and 29 paired rows.
It also discovers the four provider/field tables without assuming every
environment has already migrated, then audits nine reference relationships and
four paired relationships. Production contained all four tables and returned
zero mismatches across 536 populated references and 259 paired rows.

### `server/lib/companyReferences.ts`

Normalizes supplied UUIDs, verifies customer, location, technician, job, invoice,
and service-document ownership in one company-scoped query, and separately reports
location/customer, job/customer, invoice/customer, and document/customer consistency. Core write
routes return 400 for malformed or inconsistent relationships and 404 for
foreign/missing references before persistence.

### `server/lib/deploymentIdentity.ts`

Reads Railway's `RAILWAY_GIT_COMMIT_SHA`, environment, and service metadata with
safe fallbacks. It exposes no credentials or customer data.

### `server/frontend.ts`

The frontend `/health` and `/_health` responses now include deployment identity.
The browser gate queries this public operational metadata before testing.

### `server/routes/health.ts`

The API `/health` response includes the same identity. Existing DB/schema health
routes return structural metadata only. `/health/schema` now exposes the names
and historical-validation state of the 26 tenant constraints; the
release oracle requires every name before promotion.

## 10. Package and configuration changes

- `package.json` adds Guardian, selector, verdict, policy, incident, fixture
  inventory, operational tenant-audit, and complete frontend/server typecheck commands.
- `package-lock.json` pins Stagehand and Browserbase SDK dependencies.
- `.env.example` documents Browserbase project, context, model, environment, and
  safety variables without containing real secrets.
- `docs/qa-guardian.md` is the detailed setup/runbook and activation checklist.

Important commands:

```bash
npm run test:qa:guardian:dry-run -- --tier=1
npm run typecheck
npm run test:qa:guardian:policy
npm run test:qa:guardian:oracles
npm run test:qa:incident
npm run test:qa:guardian:select -- --base=origin/main --head=HEAD
npm run test:e2e:desktop-critical
npm run test:e2e:staging-features
npm run qa:fixtures:inventory
```

Live Stagehand execution additionally needs the Browserbase secrets and owner
context described in the runbook.

## 11. Generated evidence

`artifacts/qa-guardian/selection.json` records changed files, matched rules,
unmatched files, journeys, devices, tier, and delegated suites. A live run adds:

```text
artifacts/qa-guardian/summary.json
artifacts/qa-guardian/outcome-oracles.json
artifacts/qa-guardian/<run-id>/<journey>/<device>/result.json
artifacts/qa-guardian/<run-id>/<journey>/<device>/<step>.png
artifacts/desktop-critical/fixture-cleanup.json
```

Result JSON includes status, persona, device, session/replay/debug URLs, step
outputs, console errors, page errors, sanitized network failures, critical
first-party failure subsets, Stagehand history, metrics, logs, timestamps, and
deployment preflight evidence. Secrets are redacted from surfaced errors and
sensitive URL query parameters.

The fixture cleanup artifact contains IDs and boolean outcomes only. Test
passwords and session cookies are never written to it.

## 12. Safety invariants

- Production writes default off (`QA_GUARDIAN_ALLOW_WRITES=0`).
- Every observed action passes method/target/argument policy before execution.
- Authenticated contexts are isolated and never persisted from a run.
- An unavailable required persona is a release block, not a silent pass.
- Stagehand extraction uses a typed Zod schema.
- Visible application readiness is awaited before semantic inspection.
- Fatal console errors can fail an otherwise visually healthy step.
- Browserbase credentials are never written to source or artifacts.
- Artifact upload errors do not become product regressions.
- A GitHub Actions billing/spending refusal is `github_infrastructure`; because
  no runner or product test started, it is neither a product pass nor a failure.
- The handoff workflow captures both the upstream log and human-readable run
  summary so zero-step runner refusals retain their GitHub annotation text.
- Local Playwright suites use strict dedicated ports and require explicit opt-in
  before reusing a server, preventing cross-worktree false evidence.
- Missing selected evidence blocks the release verdict.
- Expected deployed SHA must match before candidate certification when supplied.
- Outcome-oracle requests are GET-only, origin-pinned, and response-body-free.
- Destructive deterministic cleanup refuses every identity outside the exact QA
  prefix/domain boundary.
- A deterministic write run is not green until every created identity is deleted,
  its session is empty, and its credentials are rejected.

## 13. What is implemented versus still planned

### Implemented on this branch

- desktop journey registry and change map;
- policy-controlled Stagehand runner and Browserbase evidence plumbing;
- deterministic desktop and delegated feature integration;
- failure classification, fingerprinting, and repair deduplication;
- release selection, centralized verdict, and exact deployed-SHA preflight;
- public frontend/API/database/schema outcome oracles and incident integration;
- authenticated read-only Checkly owner-route fallback while Browserbase is inactive;
- shared 27-route catalog with 81 deterministic production route/viewport checks;
- regression fixes for SMS Contacts/Common Replies layout crashes and Settings branch API routing;
- deterministic QA identity/email safeguards and self-cleaning fixture evidence;
- schedules, reusable candidate gate, documentation, and Excel activity tracker.

### Requires account/deployment activation

- add `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and
  `PESTFLOW_QA_OWNER_CONTEXT_ID` to GitHub;
- create/validate the isolated owner context;
- make the real staging/deploy pipeline call the reusable gate with
  `expected_sha` and require the result before promotion;
- configure GitHub required checks when the repository plan supports protection.
- deploy the reviewed Checkly configuration to update the managed six-hour owner
  smoke; the branch proof run does not mutate the live Checkly definition.
- restore GitHub Actions billing/spending capacity and rerun the isolated owner
  proof plus complete catalog at the exact final commit.
- deploy this branch, then require a new 81/81 live owner-route certification;
  local and branch evidence does not certify the currently served production bundle.

### Standalone control-plane repository

The reusable outside-in QA engine, registry, workflows, PRD, and tracker are now
also published in `gicheru214/Browser-Base-QA`. PestFlow intentionally keeps the
application-specific health metadata, fixture lifecycle, regression tests, and
product fixes. The external repository can be called as a reusable release gate
and is the collaboration surface for `yawbtng`.

That repository now exposes one `browser-base-qa` CLI for listing, planning,
running, checking oracles, calculating the verdict, and starting the dashboard.
Its local Command Center reads the exact JSON artifacts produced by those
commands and displays readiness, blockers, coverage, journey results, production
oracles, Browserbase replays, and the source registry without triggering tests or
mutating PestFlow.

### Planned Command Center expansion

- durable QA database, hosted owner authentication, and historical run API behind the local dashboard foundation;
- complete Browserbase persona contexts and safe fixtures for future write journeys;
- authenticated row/delivery/provider oracles for future write journeys;
- customer bug intake and observability correlation;
- read-only whole-app exploration and coverage-gap proposals;
- consecutive-pass incident closure and richer reliability metrics;
- gated test-only and product repair proposals with earned trust levels.

## 14. Review checklist for future changes

When adding a journey or feature, reviewers should verify:

1. The business goal and persona are explicit.
2. The feature path is mapped in `change-map.json`.
3. Required devices and deterministic/oracle coverage are declared.
4. Production actions are read-only or explicitly approved and isolated.
5. Expected route, structured UI state, forbidden content, console, and network
   behavior are asserted.
6. A state-changing test proves the backend/delivery outcome and cleanup.
7. Failure classification and fingerprint fields are sufficient.
8. The run produces replayable evidence without secrets.
9. The release verdict fails closed when required evidence is unavailable.
10. The Activity Log and coverage gaps are updated.
