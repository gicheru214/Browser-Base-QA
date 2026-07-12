import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  assertExpectedNavigation,
  assertObservedActionAllowed,
  selectGuardianMatrix,
  validateGuardianRegistry,
  validateSemanticResult,
} from "./lib/qa-guardian-policy.mjs";
import { waitForExpectedDeployment } from "./lib/qa-deployment-preflight.mjs";
import {
  sanitizeNetworkFailure,
  selectCriticalNetworkFailures,
  selectCriticalPageErrors,
} from "./lib/qa-browser-evidence.mjs";
import {
  runOwnerApiContracts,
  validateOwnerApiContractCatalog,
} from "./lib/qa-owner-api-contracts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const registryPath = resolve(root, process.env.QA_GUARDIAN_REGISTRY || "qa/guardian/desktop-journeys.json");
const ownerApiContractCatalogPath = resolve(
  root,
  process.env.QA_OWNER_API_CONTRACTS || "qa/guardian/desktop-owner-api-contracts.json",
);
const artifactRoot = resolve(root, process.env.QA_GUARDIAN_ARTIFACT_DIR || "artifacts/qa-guardian");

const PageStateSchema = z.object({
  pageTitle: z.string().default(""),
  headings: z.array(z.string()).default([]),
  navigationItems: z.array(z.string()).default([]),
  primaryActions: z.array(z.string()).default([]),
  errorMessages: z.array(z.string()).default([]),
  loadingIndicators: z.array(z.string()).default([]),
  summary: z.string().default(""),
  authenticatedDashboardVisible: z.boolean().default(false),
});

function parseArgs(argv) {
  const options = {
    dryRun: false,
    list: false,
    environment: process.env.QA_GUARDIAN_ENV || "production",
    journeyIds: [],
    deviceIds: [],
    maxTier: Number(process.env.QA_GUARDIAN_MAX_TIER || 1),
  };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--list") options.list = true;
    else if (arg.startsWith("--environment=")) options.environment = arg.split("=").slice(1).join("=");
    else if (arg.startsWith("--journey=")) options.journeyIds.push(...arg.slice("--journey=".length).split(",").filter(Boolean));
    else if (arg.startsWith("--device=")) options.deviceIds.push(...arg.slice("--device=".length).split(",").filter(Boolean));
    else if (arg.startsWith("--tier=")) options.maxTier = Number(arg.slice("--tier=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.maxTier) || options.maxTier < 0) throw new Error("--tier must be a non-negative number");
  return options;
}

function slug(value) {
  return String(value || "qa")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "qa";
}

function nowId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 4000);
}

function contextIdFor(registry, journey) {
  if (process.env.QA_GUARDIAN_CONTEXT_ID) return process.env.QA_GUARDIAN_CONTEXT_ID;
  const contextEnv = registry.personas[journey.persona]?.contextEnv;
  return contextEnv ? process.env[contextEnv] || "" : "";
}

function semanticInstruction(step) {
  return step.instruction || [
    "Inspect the current PestFlow page and report only what is visibly rendered.",
    "Return the page title, headings, navigation items, primary actions, visible error messages, loading indicators, a short summary, and whether an authenticated dashboard is visible.",
    step.requiredAny?.length ? `Pay special attention to these expected concepts: ${step.requiredAny.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

async function captureScreenshot(page, outputDir, stepId, suffix = "") {
  const file = join(outputDir, `${slug(stepId)}${suffix ? `-${slug(suffix)}` : ""}.png`);
  await page.screenshot({ path: file, fullPage: false, type: "png", animations: "disabled" });
  return file;
}

async function navigateStep({ page, step, baseUrl }) {
  const target = new URL(step.path, baseUrl).toString();
  const navigationStartedAt = Date.now();
  const response = await page.goto(target, { waitUntil: "domcontentloaded", timeoutMs: 45_000 });
  const status = response?.status() ?? 0;
  const readySelector = step.readySelector || process.env.QA_GUARDIAN_UI_READY_SELECTOR || "#root > *";
  await page.waitForSelector(readySelector, {
    state: "visible",
    timeout: Number(process.env.QA_GUARDIAN_UI_READY_TIMEOUT || 15_000),
  });
  assertExpectedNavigation({
    actualUrl: page.url(),
    baseUrl,
    expectedPath: step.expectedPath,
    expectedStatuses: step.expectedStatuses || [200],
    status,
  });
  return { target, actualUrl: page.url(), status, readySelector, readyAfterMs: Date.now() - navigationStartedAt };
}

async function extractStep({ stagehand, page, step, registry }) {
  const state = await stagehand.extract(
    semanticInstruction(step),
    PageStateSchema,
    { page, serverCache: false, timeout: 45_000 },
  );
  const expectations = step.expectations || {
    requiredAny: step.requiredAny || [],
    forbiddenAny: [],
    maxErrorMessages: 0,
  };
  const errors = validateSemanticResult(state, expectations, registry.globalForbiddenContent || []);
  if (errors.length) throw new Error(errors.join("; "));
  return state;
}

async function observeStep({ stagehand, page, step, journey, registry }) {
  const instruction = step.instruction || step.observe;
  const actions = await stagehand.observe(instruction, { page, serverCache: false, timeout: 45_000 });
  const minimumActions = Number(step.minimumActions || 1);
  if (actions.length < minimumActions) {
    throw new Error(`expected at least ${minimumActions} observed actions, received ${actions.length}`);
  }
  const policyStep = {
    ...step,
    type: step.type === "route-check" ? "observe" : step.type,
    allowedMethods: step.allowedMethods || ["click", "fill", "type", "press", "selectOption"],
  };
  for (const action of actions) {
    assertObservedActionAllowed(action, { journey, step: policyStep, registry, allowWrites: false });
  }
  return actions.map((action) => ({
    description: action.description,
    method: action.method,
    selector: action.selector,
    arguments: action.arguments,
  }));
}

async function executeStep(context) {
  const { step } = context;
  if (step.type === "navigate") return navigateStep(context);
  if (step.type === "extract") return extractStep(context);
  if (step.type === "observe") return observeStep(context);
  if (step.type === "act") {
    const actions = await context.stagehand.observe(step.instruction, { page: context.page, serverCache: false, timeout: 45_000 });
    if (!actions.length) throw new Error("Stagehand did not propose an action");
    const action = actions[0];
    assertObservedActionAllowed(action, {
      journey: context.journey,
      step,
      registry: context.registry,
      allowWrites: process.env.QA_GUARDIAN_ALLOW_WRITES === "1",
    });
    return context.stagehand.act(action, { page: context.page, serverCache: false, timeout: 45_000 });
  }
  if (step.type === "route-check") {
    const navigation = await navigateStep(context);
    const state = await extractStep(context);
    const actions = await observeStep(context);
    return { navigation, state, actions };
  }
  throw new Error(`Unsupported step type: ${step.type}`);
}

async function runMatrixEntry({
  registry,
  ownerApiContractCatalog,
  runApiContracts,
  baseUrl,
  apiUrl,
  runId,
  journey,
  deviceId,
  device,
  environment,
}) {
  const outputDir = join(artifactRoot, runId, slug(journey.id), slug(deviceId));
  await mkdir(outputDir, { recursive: true });
  const persona = registry.personas[journey.persona];
  const contextId = contextIdFor(registry, journey);
  const requireAllPersonas = process.env.QA_GUARDIAN_REQUIRE_ALL_PERSONAS === "1";
  if (persona.authenticated && !contextId) {
    return {
      journeyId: journey.id,
      journeyTitle: journey.title,
      deviceId,
      persona: journey.persona,
      status: requireAllPersonas ? "failed" : "skipped",
      error: `${persona.contextEnv} is required for authenticated desktop coverage`,
      steps: [],
    };
  }

  const stagehandLogs = [];
  const consoleErrors = [];
  const networkFailures = [];
  const pageErrors = [];
  const stepResults = [];
  let stagehand;
  let sessionId = "";
  let sessionUrl = "";
  let debugUrl = "";

  try {
    const { Stagehand } = await import("@browserbasehq/stagehand");
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: process.env.QA_GUARDIAN_MODEL || "openai/gpt-5-mini",
      selfHeal: true,
      serverCache: false,
      verbose: 0,
      disablePino: true,
      logger: (line) => {
        if ((line.level ?? 1) <= 1) stagehandLogs.push({ category: line.category, level: line.level, message: line.message });
      },
      systemPrompt: [
        "You are validating PestFlow for production QA.",
        "Never delete data, send messages, charge money, pay invoices, change credentials, invite users, disconnect integrations, or submit destructive actions.",
        "Observe exactly what is rendered and prefer the named PestFlow control that matches the requested goal.",
      ].join(" "),
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        timeout: Number(process.env.QA_GUARDIAN_SESSION_TIMEOUT || 1200),
        userMetadata: {
          suite: registry.suite,
          runId,
          journeyId: journey.id,
          persona: journey.persona,
          deviceId,
          environment,
          gitSha: process.env.GITHUB_SHA || "local",
        },
        browserSettings: {
          viewport: { width: device.width, height: device.height },
          recordSession: true,
          logSession: true,
          solveCaptchas: false,
          ...(contextId ? { context: { id: contextId, persist: false } } : {}),
        },
      },
    });

    await stagehand.init();
    sessionId = stagehand.browserbaseSessionID || "";
    sessionUrl = stagehand.browserbaseSessionURL || (sessionId ? `https://browserbase.com/sessions/${sessionId}` : "");
    debugUrl = stagehand.browserbaseDebugURL || "";
    const page = stagehand.context.pages()[0];
    if (!page) throw new Error("Browserbase session opened without a page");
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push({ text: message.text(), location: message.location(), timestamp: message.timestamp() });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push({ message: safeError(error), timestamp: new Date().toISOString() });
    });
    page.on("response", (response) => {
      try {
        if (response.status() < 400) return;
        const request = response.request();
        networkFailures.push(sanitizeNetworkFailure({
          kind: "response",
          url: response.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          status: response.status(),
          statusText: response.statusText(),
          timestamp: new Date().toISOString(),
        }));
      } catch {
        // Evidence collection must never interrupt the customer journey.
      }
    });
    page.on("requestfailed", (request) => {
      try {
        networkFailures.push(sanitizeNetworkFailure({
          kind: "requestfailed",
          url: request.url(),
          method: request.method(),
          resourceType: request.resourceType(),
          errorText: request.failure()?.errorText || "request failed",
          timestamp: new Date().toISOString(),
        }));
      } catch {
        // Evidence collection must never interrupt the customer journey.
      }
    });

    for (const step of journey.steps) {
      const startedAt = new Date().toISOString();
      try {
        const output = await executeStep({ stagehand, page, step, journey, registry, baseUrl });
        const screenshot = await captureScreenshot(page, outputDir, step.id);
        stepResults.push({ id: step.id, type: step.type, status: "passed", startedAt, completedAt: new Date().toISOString(), screenshot, output });
      } catch (error) {
        let screenshot = "";
        try {
          screenshot = await captureScreenshot(page, outputDir, step.id, "failure");
        } catch {
          screenshot = "";
        }
        stepResults.push({
          id: step.id,
          type: step.type,
          status: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          screenshot,
          error: safeError(error),
          url: page.url(),
        });
        break;
      }
    }

    if (runApiContracts) {
      const startedAt = new Date().toISOString();
      try {
        const apiContractEvidence = await runOwnerApiContracts({
          page,
          apiUrl,
          catalog: ownerApiContractCatalog,
        });
        await writeFile(
          join(artifactRoot, runId, "owner-api-contracts.json"),
          `${JSON.stringify(apiContractEvidence, null, 2)}\n`,
        );
        stepResults.push({
          id: "owner-api-contracts",
          type: "authenticated-api-contracts",
          status: apiContractEvidence.failedChecks > 0 ? "failed" : "passed",
          startedAt,
          completedAt: new Date().toISOString(),
          output: apiContractEvidence,
          ...(apiContractEvidence.failedChecks > 0
            ? { error: `${apiContractEvidence.failedChecks}/${apiContractEvidence.expectedChecks} owner API contracts failed` }
            : {}),
        });
      } catch (error) {
        stepResults.push({
          id: "owner-api-contracts",
          type: "authenticated-api-contracts",
          status: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          error: safeError(error),
        });
      }
    }

    const criticalConsoleErrors = consoleErrors.filter((entry) => (
      /uncaught|typeerror|referenceerror|chunkloaderror|error boundary|cannot read properties/i.test(entry.text) &&
      !/favicon/i.test(entry.text)
    ));
    if (criticalConsoleErrors.length && !stepResults.some((step) => step.status === "failed")) {
      stepResults.push({
        id: "console-errors",
        type: "console",
        status: "failed",
        error: criticalConsoleErrors.map((entry) => entry.text).join(" | ").slice(0, 4000),
      });
    }
    const criticalNetworkFailures = selectCriticalNetworkFailures(networkFailures, {
      baseUrls: [baseUrl, apiUrl],
    });
    if (criticalNetworkFailures.length && !stepResults.some((step) => step.status === "failed")) {
      stepResults.push({
        id: "network-failures",
        type: "network",
        status: "failed",
        error: criticalNetworkFailures
          .map((entry) => `${entry.method} ${entry.status || entry.errorText} ${entry.url}`)
          .join(" | ")
          .slice(0, 4000),
      });
    }
    const criticalPageErrors = selectCriticalPageErrors(pageErrors);
    if (criticalPageErrors.length && !stepResults.some((step) => step.status === "failed")) {
      stepResults.push({
        id: "page-errors",
        type: "pageerror",
        status: "failed",
        error: criticalPageErrors.map((entry) => entry.message).join(" | ").slice(0, 4000),
      });
    }

    const history = await stagehand.history;
    const metrics = await stagehand.metrics;
    const status = stepResults.some((step) => step.status === "failed") ? "failed" : "passed";
    const result = {
      journeyId: journey.id,
      journeyTitle: journey.title,
      deviceId,
      device,
      persona: journey.persona,
      status,
      sessionId,
      sessionUrl,
      debugUrl,
      steps: stepResults,
      consoleErrors,
      networkFailures: networkFailures.slice(-200),
      criticalNetworkFailures,
      pageErrors,
      criticalPageErrors,
      stagehandHistory: history,
      stagehandMetrics: metrics,
      stagehandLogs: stagehandLogs.slice(-100),
    };
    await writeFile(join(outputDir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const result = {
      journeyId: journey.id,
      journeyTitle: journey.title,
      deviceId,
      device,
      persona: journey.persona,
      status: "failed",
      sessionId,
      sessionUrl,
      debugUrl,
      error: safeError(error),
      steps: stepResults,
      consoleErrors,
      networkFailures: networkFailures.slice(-200),
      pageErrors,
      stagehandLogs: stagehandLogs.slice(-100),
    };
    await writeFile(join(outputDir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const ownerApiContractCatalog = JSON.parse(await readFile(ownerApiContractCatalogPath, "utf8"));
  const registryErrors = validateGuardianRegistry(registry);
  if (registryErrors.length) throw new Error(`Invalid QA Guardian registry:\n- ${registryErrors.join("\n- ")}`);
  const ownerApiContractErrors = validateOwnerApiContractCatalog(ownerApiContractCatalog);
  if (ownerApiContractErrors.length) {
    throw new Error(`Invalid owner API contract catalog:\n- ${ownerApiContractErrors.join("\n- ")}`);
  }
  const matrix = selectGuardianMatrix(registry, options);
  if (!matrix.length) throw new Error("No desktop Guardian journeys matched the requested filters");

  if (options.list || options.dryRun) {
    const rows = matrix.map(({ journey, deviceId }) => ({ journeyId: journey.id, title: journey.title, tier: journey.tier, persona: journey.persona, deviceId }));
    console.log(JSON.stringify({
      registry: registryPath,
      ownerApiContracts: ownerApiContractCatalogPath,
      ownerApiContractCount: ownerApiContractCatalog.contracts.length,
      valid: true,
      count: rows.length,
      rows,
    }, null, 2));
    return;
  }

  if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required unless --dry-run is used");
  }

  const runId = process.env.QA_GUARDIAN_RUN_ID || `${nowId()}-${slug(process.env.GITHUB_SHA || "local")}`;
  const baseUrl = (process.env.QA_GUARDIAN_BASE_URL || registry.defaultBaseUrl).replace(/\/+$/, "");
  const apiUrl = (process.env.QA_GUARDIAN_API_URL || "https://api.pestflow.org").replace(/\/+$/, "");
  await mkdir(join(artifactRoot, runId), { recursive: true });
  const deploymentPreflight = await waitForExpectedDeployment({
    baseUrl,
    expectedSha: process.env.QA_GUARDIAN_EXPECTED_SHA,
    timeoutMs: Number(process.env.QA_GUARDIAN_DEPLOYMENT_WAIT_MS || 180_000),
    intervalMs: Number(process.env.QA_GUARDIAN_DEPLOYMENT_POLL_MS || 5_000),
  });
  const results = [];
  let ownerApiContractsPending = true;
  for (const entry of matrix) {
    console.log(`[qa-guardian] ${entry.journey.id} on ${entry.deviceId}`);
    const runApiContracts = ownerApiContractsPending && entry.journey.persona === "owner";
    results.push(await runMatrixEntry({
      registry,
      ownerApiContractCatalog,
      runApiContracts,
      baseUrl,
      apiUrl,
      runId,
      environment: options.environment,
      ...entry,
    }));
    if (runApiContracts) ownerApiContractsPending = false;
  }

  const summary = {
    schemaVersion: 1,
    suite: registry.suite,
    runId,
    environment: options.environment,
    baseUrl,
    apiUrl,
    gitSha: process.env.GITHUB_SHA || "local",
    deploymentPreflight,
    createdAt: new Date().toISOString(),
    status: results.some((result) => result.status === "failed") ? "failed" : results.some((result) => result.status === "skipped") ? "warning" : "passed",
    counts: {
      total: results.length,
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
    results,
  };
  await writeFile(join(artifactRoot, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ status: summary.status, counts: summary.counts, summaryPath: join(artifactRoot, "summary.json") }, null, 2));
  if (summary.status === "failed") process.exitCode = 1;
}

main().catch(async (error) => {
  await mkdir(artifactRoot, { recursive: true });
  const failure = {
    schemaVersion: 1,
    suite: "PestFlow Desktop Guardian",
    createdAt: new Date().toISOString(),
    status: "failed",
    error: safeError(error),
    results: [],
  };
  await writeFile(join(artifactRoot, "summary.json"), JSON.stringify(failure, null, 2));
  console.error(`[qa-guardian] ${failure.error}`);
  process.exitCode = 1;
});
