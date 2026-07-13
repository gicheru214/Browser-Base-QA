import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ADAPTIVE_ACTION_PROOF_CONTRACT,
  validateAdaptiveActionProof,
  verifyAdaptiveActionProof,
} from "../scripts/lib/qa-adaptive-action-proof.mjs";
import { validateGuardianRegistry } from "../scripts/lib/qa-guardian-policy.mjs";

const registry = JSON.parse(await readFile(new URL("../qa/guardian/desktop-journeys.json", import.meta.url), "utf8"));

const proof = {
  url: { path: "/jobs/created", match: "exact" },
  visible: [{ selector: "[data-testid='job-created']", text: "Job created", match: "contains" }],
  responses: [{ method: "POST", path: "/jobs", statuses: [201] }],
  maxCriticalConsoleErrors: 0,
  maxCriticalNetworkFailures: 0,
};

test("AADP proof accepts deterministic URL, visible, response, console, and network contracts", async () => {
  assert.deepEqual(validateAdaptiveActionProof(proof), []);
  const page = {
    url: () => "https://new.pestflow.org/jobs/created?from=qa",
    locator: (selector) => ({
      waitFor: async ({ state }) => assert.equal(state, "visible"),
      textContent: async () => selector.includes("job-created") ? "Job created successfully" : "",
      inputValue: async () => "",
    }),
  };
  const evidence = await verifyAdaptiveActionProof({
    page,
    proof,
    baseUrl: "https://new.pestflow.org",
    apiUrl: "https://api.pestflow.org",
    httpResponses: [{ method: "POST", path: "/jobs", status: 201 }],
    consoleErrors: [],
    criticalNetworkFailures: [],
  });
  assert.equal(evidence.contract, ADAPTIVE_ACTION_PROOF_CONTRACT);
  assert.deepEqual(evidence.url, { path: "/jobs/created", match: "exact" });
  assert.deepEqual(evidence.responses, [{ method: "POST", path: "/jobs", status: 201 }]);
  assert.deepEqual(evidence.visible, [{ selector: "[data-testid='job-created']", source: "text", textMatched: true }]);
});

test("AADP fails closed on a critical console error", async () => {
  const page = {
    url: () => "https://new.pestflow.org/jobs/created",
    locator: () => ({ waitFor: async () => {}, textContent: async () => "Job created", inputValue: async () => "" }),
  };
  await assert.rejects(() => verifyAdaptiveActionProof({
    page,
    proof,
    baseUrl: "https://new.pestflow.org",
    apiUrl: "https://api.pestflow.org",
    httpResponses: [{ method: "POST", path: "/jobs", status: 201 }],
    consoleErrors: [{ text: "TypeError: cannot read properties of undefined" }],
  }), /console proof/i);
});

test("every adaptive act in the Guardian registry requires deterministic proof", () => {
  const missingProof = structuredClone(registry);
  missingProof.journeys[0].steps.push({
    id: "adaptive-action-without-proof",
    type: "act",
    instruction: "Open the customer details",
    safeInteraction: true,
  });
  assert.ok(validateGuardianRegistry(missingProof).some((error) => /deterministic proof is required/i.test(error)));

  const withProof = structuredClone(registry);
  withProof.journeys[0].steps.push({
    id: "adaptive-action-with-proof",
    type: "act",
    instruction: "Open the customer details",
    safeInteraction: true,
    proof: {
      url: { path: "/customers", match: "prefix" },
      maxCriticalConsoleErrors: 0,
      maxCriticalNetworkFailures: 0,
    },
  });
  assert.deepEqual(validateGuardianRegistry(withProof), []);
});

test("write-enabled adaptive action requires HTTP or API system-of-record proof", () => {
  assert.ok(validateAdaptiveActionProof({
    visible: [{ selector: "[data-testid='saved']", text: "Saved" }],
    maxCriticalConsoleErrors: 0,
    maxCriticalNetworkFailures: 0,
  }, { writePolicy: "qa-tenant-write" }).some((error) => /write journey requires/i.test(error)));
});
