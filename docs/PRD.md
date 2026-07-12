# PRD: PestFlow Reliability Command Center

## 1. General explanation

PestFlow is business software used to manage customers, jobs, schedules,
technicians, invoices, payments, messaging, routes, chemicals, reports, and
other daily operations. A production bug can therefore interrupt real work or
money movement even when the home page appears healthy.

The Reliability Command Center is an independent QA system that repeatedly uses
PestFlow like a customer, verifies the systems behind the screen, and decides
whether a specific release has earned the right to reach production.

## 2. Product statement

Build a fail-closed browser-based reliability platform that combines precise
Playwright-style contracts, Stagehand semantic recovery, Browserbase sessions,
service/data outcome oracles, deterministic PestFlow tests, incident
deduplication, and human approval for dangerous changes.

The objective is not to claim that bugs are impossible. The objective is to
drive escaped production defects toward zero, shorten detection and repair time,
and ensure every escaped defect permanently improves the system.

## 3. Users

- Founder/product owner: release confidence, risk visibility, and approvals.
- Engineer: reproducible failures, exact commit/route/device, and evidence.
- QA collaborator: journey authoring, replay review, coverage-gap ownership.
- Support/customer success: structured intake and incident status.

## 4. Core capabilities

### Release shield

- Verify the exact candidate commit is deployed before testing it.
- Select journeys from changed PestFlow files and risk rules.
- Require deterministic, browser, and backend evidence.
- Block on product failure, unknown failure, missing evidence, or stale deploy.
- Classify runner, billing, artifact, and Browserbase outages as infrastructure.

### Outside-in browser testing

- Anonymous and isolated authenticated personas.
- Recorded Browserbase sessions with screenshots and replay URLs.
- Four desktop sizes now; mobile/tablet expansion later.
- Exact route, status, heading/action, overflow, console, page-error, and network
  assertions.
- Stagehand extraction/observation for harmless UI movement without weakening the
  expected business outcome or safety policy.

### Outcome verification

- Public frontend, API, database, and schema health oracles.
- Future authenticated database, email, SMS, payment, and provider oracles.
- No success claim based only on clicking a button.

### Incident learning loop

- Stable fingerprint per journey, route, step, error class, and outcome.
- One incident and repair branch per recurring defect.
- Production replay and evidence attached to the incident.
- Fix must add a deterministic regression and outside-in journey.
- Close only after the repaired commit is deployed and receives consecutive
  green production runs.

### Command Center interface

Future tabs: Overview, Test Registry, Live Runs, Incidents, Browserbase Replays,
Device Matrix, Coverage Gaps, Releases, Costs, Settings, and Activity Log. The
Activity Log records meaningful actions toward the goal, including who/what ran,
target commit, result, evidence link, and next action.

## 5. Current foundation

- Registry of PestFlow journeys, personas, viewports, policies, and change rules.
- Shared 26-route owner readiness catalog.
- Browserbase/Stagehand runner with read-only enforcement and evidence capture.
- Exact-deployment preflight.
- Four public GET-only outcome oracles.
- Fail-closed release verdict.
- Scheduled workflow and reusable cross-repository PestFlow release gate.
- Excel tracker and written codebase/integration guides.

## 6. Safety and privacy

- Production runs are read-only by default.
- Never use a customer tenant as a QA persona.
- Writes require an isolated tenant, allowlisted destinations, idempotency,
  explicit policy approval, cleanup, and outcome proof.
- Never store credentials, session state, raw customer page content, or API
  response bodies in Git.
- Stagehand can recover selectors; it cannot rewrite assertions, release policy,
  or action permissions.

## 7. Success measures

- Escaped production defects per release and per active account.
- Critical journey pass rate and route/device coverage.
- Median time to detect, reproduce, repair, deploy, and verify.
- Reopen/recurrence rate by incident fingerprint.
- Percentage of customer reports already caught by a pre-production gate.
- False-red and quarantined-test rate.
- Cleanup success and synthetic-data residue.
- Browserbase cost and runtime per protected release.

## 8. Delivery phases

1. Foundation: registry, policies, runner, evidence, public oracles, workflows.
2. PestFlow connection: secrets, isolated owner context, required release gate.
3. Critical journeys: auth, owner day, technician day, invoice/payment,
   messaging, routes/GPS, inventory, and integrations.
4. Command Center UI and durable QA database.
5. Customer bug intake plus logs, deploy, and session correlation.
6. Safe write journeys and provider oracles.
7. Earned-trust repair proposals; never automatic production merge by default.

## 9. Acceptance criteria for the current repository

- `npm test` passes.
- `npm run guardian:dry-run` validates a non-empty execution matrix.
- Every static owner route is present in the shared route catalog.
- Every oracle is GET-only and same-origin constrained.
- Live authenticated execution cannot silently skip the owner persona when the
  release gate requires it.
- Artifacts include structured result, screenshot path, timing, and Browserbase
  session/replay reference.
- Missing browser evidence blocks a selected release.
