# PestFlow integration

## Recommended ownership split

Browser Base QA owns cross-repository orchestration, Browserbase sessions,
Stagehand semantics, device coverage, evidence, incident classification, and the
release verdict.

PestFlow owns its application code, health endpoints, deployment commit identity,
isolated QA fixture lifecycle, and focused unit/integration/browser regressions.

There is one hybrid browser journey. Stagehand handles only adaptable semantic
navigation or extraction; Playwright retains deterministic assertions, network
and console evidence, viewport checks, screenshots, and the final verdict.
Browserbase hosts and records that journey. Maintaining a parallel Stagehand suite
and Playwright suite for the same business flow would be redundant and is not the
recommended architecture.

## Required PestFlow contracts

- `GET /health` on the frontend returns service identity and deployed commit SHA.
- `GET /health` on the API returns service identity and deployed commit SHA.
- `GET /health/db` proves the configured database is reachable and current.
- `GET /health/schema` proves critical production tables and columns exist.
- `GET /health/schema` proves all 26 core, operational, provider, and field
  tenant-reference constraints exist before promotion.
- A dedicated Browserbase context logs into a disposable PestFlow QA company.
- The authenticated session can read all 32 paths in
  `qa/guardian/desktop-owner-api-contracts.json` with HTTP 200 and the declared
  JSON contract.
- Any future write journey uses allowlisted destinations, idempotency, automatic
  cleanup, and a backend/provider outcome oracle.

## Calling the release gate

Add a job in PestFlow after deploying a candidate:

```yaml
jobs:
  external-browser-qa:
    uses: gicheru214/Browser-Base-QA/.github/workflows/pestflow-release-gate.yml@main
    with:
      expected_sha: ${{ github.sha }}
      base_url: https://new.pestflow.org
      api_url: https://api.pestflow.org
      max_tier: 1
    secrets: inherit
```

Configure `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and
`PESTFLOW_QA_OWNER_CONTEXT_ID` in the calling repository or organization. Make
the reusable gate a required promotion check. A GitHub runner/billing refusal is
infrastructure-blocked evidence, never a PestFlow pass.

As of July 12, 2026, the live frontend and API `/health` endpoints return their
service identities but not the deployed commit SHA. Database and schema oracles
pass. Deploy the PestFlow health-metadata change before enabling this as a
required exact-candidate gate; until then the missing identity must remain red.

## Current handoff boundary

The PestFlow QA branch contains product fixes and in-repository deterministic
coverage discovered by the live audit. The 32-endpoint read-only registry is
shared here because it is an outside-in release contract; state-changing branch
and business regressions remain beside PestFlow application code. The recorded
Browserbase owner session runs the external contract once per Guardian run and
stores no response bodies.

Current reviewed head `9083c93` on PestFlow PR #89 adds provider/field tenant
validation, nine database constraints, the missing ProGlove schema migration,
and eight focused provider/field regressions. Its aggregate-only production
inventory inspected 536 populated references and 259 paired relationships with
zero mismatches and without sending email, SMS, invitations, or signatures.
It also makes the 28-email preview endpoint unavailable in production and gives
the intentional Stripe test-send server-verified confirmation plus a ten-minute
operation-specific idempotency window. The same head typechecks the complete
frontend and Hono server graphs and protects all 24 direct Resend deliveries with
deterministic idempotency keys enforced by a repository-wide source contract.
