import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { buildDashboardModel } from "../scripts/lib/qa-dashboard-model.mjs";

const execFileAsync = promisify(execFile);

test("CLI exposes the reliability commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["bin/browser-base-qa.mjs", "--help"]);
  for (const command of ["list", "plan", "run", "oracles", "verdict", "dashboard"]) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`));
  }
});

test("CLI list delegates to the guarded registry without opening Browserbase", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["bin/browser-base-qa.mjs", "list", "--tier=0"]);
  const output = JSON.parse(stdout);
  assert.equal(output.valid, true);
  assert.ok(output.count > 0);
  assert.ok(output.rows.every((row) => row.tier === 0));
});

test("dashboard model combines registry and evidence without exposing secrets", () => {
  const model = buildDashboardModel({
    registry: {
      defaultBaseUrl: "https://new.pestflow.org",
      devices: { desktop: { width: 1440, height: 900 } },
      journeys: [{ id: "owner", title: "Owner desk", tier: 0, persona: "owner", writePolicy: "read-only", viewports: ["desktop"], steps: [{ id: "dashboard" }] }],
    },
    routeCatalog: { routes: [{ id: "dashboard" }] },
    apiCatalog: { contracts: [{ id: "me" }] },
    oracleCatalog: { oracles: [{ id: "health" }] },
    selection: { journeyIds: ["owner"] },
    guardianSummary: {
      runId: "run-1",
      status: "passed",
      environment: "staging",
      gitSha: "abc123",
      results: [{ journeyId: "owner", journeyTitle: "Owner desk", deviceId: "desktop", persona: "owner", status: "passed", sessionUrl: "https://browserbase.com/sessions/one", steps: [{ status: "passed" }] }],
    },
    oracleSummary: { status: "passed", results: [{ id: "health", title: "Health", status: "passed", statusCode: 200, durationMs: 12 }] },
    verdict: { status: "blocked", blockers: ["token=super-secret"], warnings: [] },
  });

  assert.equal(model.readiness.status, "blocked");
  assert.equal(model.metrics.matrixEntries, 1);
  assert.equal(model.metrics.ownerRoutes, 1);
  assert.equal(model.metrics.apiContracts, 1);
  assert.equal(model.metrics.outcomeOracles, 1);
  assert.equal(model.run.results[0].replayUrl, "https://browserbase.com/sessions/one");
  assert.doesNotMatch(JSON.stringify(model), /super-secret/);
});

test("dashboard drops non-Browserbase replay URLs", () => {
  const model = buildDashboardModel({
    registry: { devices: {}, journeys: [] },
    guardianSummary: { results: [{ journeyId: "x", status: "failed", sessionUrl: "https://example.com/leak" }] },
  });
  assert.equal(model.run.results[0].replayUrl, "");
});
