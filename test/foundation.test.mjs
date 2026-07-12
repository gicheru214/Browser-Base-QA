import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertObservedActionAllowed,
  selectGuardianMatrix,
  validateGuardianRegistry,
} from "../scripts/lib/qa-guardian-policy.mjs";
import {
  runOwnerApiContracts,
  validateOwnerApiContractCatalog,
} from "../scripts/lib/qa-owner-api-contracts.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const registry = await readJson("../qa/guardian/desktop-journeys.json");
const catalog = await readJson("../qa/guardian/desktop-owner-route-catalog.json");
const apiContracts = await readJson("../qa/guardian/desktop-owner-api-contracts.json");
const oracles = await readJson("../qa/guardian/outcome-oracles.json");

test("guardian registry is structurally valid and produces work", () => {
  assert.deepEqual(validateGuardianRegistry(registry), []);
  assert.ok(selectGuardianMatrix(registry, { maxTier: 1, journeyIds: [], deviceIds: [] }).length > 0);
});

test("shared catalog covers every static authenticated owner route", () => {
  const catalogPaths = new Set(catalog.routes.map((route) => route.expectedPath));
  const ownerPaths = new Set(
    registry.journeys
      .filter((journey) => journey.persona === "owner")
      .flatMap((journey) => journey.steps)
      .filter((step) => step.expectedPath && !step.expectedPath.includes(":"))
      .map((step) => step.expectedPath),
  );
  assert.equal(catalog.routes.length, 27);
  assert.deepEqual([...ownerPaths].sort(), [...catalogPaths].sort());
});

test("owner API catalog covers the broad data surface with GET-only relative contracts", () => {
  assert.equal(apiContracts.contracts.length, 32);
  assert.deepEqual(validateOwnerApiContractCatalog(apiContracts), []);
  const escaped = structuredClone(apiContracts);
  escaped.contracts[0].path = "//attacker.invalid/steal?token=value";
  assert.ok(validateOwnerApiContractCatalog(escaped).some((error) => /relative|secret|escape/i.test(error)));
});

test("owner API sweep records contract metadata without retaining response bodies", async (t) => {
  const catalogForTest = {
    schemaVersion: 1,
    contracts: [
      { id: "healthy", path: "/healthy", requiredKeys: ["rows", "metadata"], requiredArrayKeys: ["rows"] },
      { id: "broken", path: "/broken", requiredKeys: ["rows"], requiredArrayKeys: ["rows"] },
    ],
  };
  t.mock.method(globalThis, "fetch", async (target) => {
    if (String(target).endsWith("/healthy")) {
      return new Response(JSON.stringify({
        rows: [{ customerEmail: "private-customer@example.test" }],
        metadata: { accessToken: "do-not-retain" },
      }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
    return new Response(JSON.stringify({ error: "private database detail" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  });
  const page = { evaluate: async (callback, input) => callback(input) };
  const evidence = await runOwnerApiContracts({
    page,
    apiUrl: "https://api.pestflow.test",
    catalog: catalogForTest,
  });

  assert.equal(evidence.expectedChecks, 2);
  assert.equal(evidence.passedChecks, 1);
  assert.equal(evidence.failedChecks, 1);
  assert.equal(evidence.results[0].arrayCounts.rows, 1);
  assert.match(evidence.results[1].error, /HTTP 200.*500/);
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /private-customer|do-not-retain|private database detail/);
});

test("production oracles are read-only relative paths", () => {
  assert.ok(oracles.oracles.length >= 4);
  for (const oracle of oracles.oracles) {
    assert.equal(oracle.method, "GET");
    assert.match(oracle.path, /^\/(?!\/)/);
    assert.equal(new URL(oracle.path, "https://example.test").origin, "https://example.test");
  }
});

test("dangerous Stagehand actions are rejected even when semantically proposed", () => {
  const journey = registry.journeys.find((item) => item.persona === "owner");
  assert.throws(() => assertObservedActionAllowed(
    { description: "Delete this customer", method: "click", selector: "button" },
    {
      journey,
      step: { type: "act", allowedMethods: ["click"] },
      registry,
      allowWrites: false,
    },
  ), /forbidden|read-only/i);
});
