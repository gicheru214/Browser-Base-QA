# PestFlow integration

## Recommended ownership split

Browser Base QA owns cross-repository orchestration, Browserbase sessions,
Stagehand semantics, device coverage, evidence, incident classification, and the
release verdict.

PestFlow owns its application code, health endpoints, deployment commit identity,
isolated QA fixture lifecycle, and focused unit/integration/browser regressions.

## Required PestFlow contracts

- `GET /health` on the frontend returns service identity and deployed commit SHA.
- `GET /health` on the API returns service identity and deployed commit SHA.
- `GET /health/db` proves the configured database is reachable and current.
- `GET /health/schema` proves critical production tables and columns exist.
- A dedicated Browserbase context logs into a disposable PestFlow QA company.
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
coverage discovered by the live audit. Those are not duplicated here. This
repository contains the reusable outside-in engine and shared contracts.
