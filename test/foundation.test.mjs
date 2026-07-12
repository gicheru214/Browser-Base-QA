import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertObservedActionAllowed,
  selectGuardianMatrix,
  validateGuardianRegistry,
} from "../scripts/lib/qa-guardian-policy.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const registry = await readJson("../qa/guardian/desktop-journeys.json");
const catalog = await readJson("../qa/guardian/desktop-owner-route-catalog.json");
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
  assert.equal(catalog.routes.length, 26);
  assert.deepEqual([...ownerPaths].sort(), [...catalogPaths].sort());
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
