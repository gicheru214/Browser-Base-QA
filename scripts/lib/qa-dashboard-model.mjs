import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeText(value, fallback = "") {
  return String(value ?? fallback)
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 1000);
}

function safeReplayUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)browserbase\.com$/i.test(url.hostname) ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeJourney(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  return {
    id: safeText(result?.journeyId, "unknown"),
    title: safeText(result?.journeyTitle, result?.journeyId || "Unknown journey"),
    device: safeText(result?.deviceId, "unknown"),
    persona: safeText(result?.persona, "unknown"),
    status: ["passed", "failed", "skipped"].includes(result?.status) ? result.status : "unknown",
    passedSteps: steps.filter((step) => step?.status === "passed").length,
    failedSteps: steps.filter((step) => step?.status === "failed").length,
    totalSteps: steps.length,
    replayUrl: safeReplayUrl(result?.sessionUrl),
    error: safeText(result?.error || steps.find((step) => step?.status === "failed")?.error),
  };
}

function normalizeOracle(result) {
  return {
    id: safeText(result?.id, "unknown"),
    title: safeText(result?.title, result?.id || "Unknown oracle"),
    status: result?.status === "passed" ? "passed" : "failed",
    statusCode: Number.isFinite(Number(result?.statusCode)) ? Number(result.statusCode) : null,
    durationMs: Number.isFinite(Number(result?.durationMs)) ? Number(result.durationMs) : null,
    error: safeText(result?.error),
  };
}

export function buildDashboardModel({ registry, routeCatalog, apiCatalog, oracleCatalog, selection, guardianSummary, oracleSummary, verdict }) {
  const journeys = Array.isArray(registry?.journeys) ? registry.journeys : [];
  const devices = registry?.devices && typeof registry.devices === "object" ? registry.devices : {};
  const results = (Array.isArray(guardianSummary?.results) ? guardianSummary.results : []).map(normalizeJourney);
  const oracles = (Array.isArray(oracleSummary?.results) ? oracleSummary.results : []).map(normalizeOracle);
  const blockers = (Array.isArray(verdict?.blockers) ? verdict.blockers : []).map((item) => safeText(item));
  const warnings = (Array.isArray(verdict?.warnings) ? verdict.warnings : []).map((item) => safeText(item));
  if (!blockers.length && oracleSummary?.status === "failed") {
    for (const oracle of oracles.filter((item) => item.status === "failed")) {
      blockers.push(`${oracle.title}: ${oracle.error || "outcome contract failed"}`);
    }
  }
  const selectedJourneyIds = Array.isArray(selection?.journeyIds) ? selection.journeyIds.map((item) => safeText(item)) : [];
  const status = verdict?.status || guardianSummary?.status || oracleSummary?.status || "not-run";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    readiness: {
      status: safeText(status, "not-run"),
      environment: safeText(guardianSummary?.environment || oracleSummary?.environment || "not-run"),
      commit: safeText(guardianSummary?.gitSha || "not-recorded"),
      blockers,
      warnings,
    },
    metrics: {
      registeredJourneys: journeys.length,
      registeredDevices: Object.keys(devices).length,
      matrixEntries: journeys.reduce((total, journey) => total + (Array.isArray(journey.viewports) ? journey.viewports.length : 0), 0),
      ownerRoutes: Array.isArray(routeCatalog?.routes) ? routeCatalog.routes.length : 0,
      apiContracts: Array.isArray(apiCatalog?.contracts) ? apiCatalog.contracts.length : 0,
      outcomeOracles: Array.isArray(oracleCatalog?.oracles) ? oracleCatalog.oracles.length : 0,
      selectedJourneys: selectedJourneyIds.length,
      passed: results.filter((item) => item.status === "passed").length,
      failed: results.filter((item) => item.status === "failed").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      oraclesPassed: oracles.filter((item) => item.status === "passed").length,
      oraclesFailed: oracles.filter((item) => item.status === "failed").length,
    },
    run: {
      id: safeText(guardianSummary?.runId, "No Guardian run yet"),
      createdAt: safeText(guardianSummary?.createdAt),
      status: safeText(guardianSummary?.status, "not-run"),
      baseUrl: safeText(guardianSummary?.baseUrl || registry?.defaultBaseUrl),
      selectedJourneyIds,
      results,
    },
    oracles: {
      status: safeText(oracleSummary?.status, "not-run"),
      startedAt: safeText(oracleSummary?.startedAt),
      finishedAt: safeText(oracleSummary?.finishedAt),
      results: oracles,
    },
    registry: journeys.map((journey) => ({
      id: safeText(journey.id),
      title: safeText(journey.title, journey.id),
      tier: Number(journey.tier || 0),
      persona: safeText(journey.persona),
      writePolicy: safeText(journey.writePolicy),
      devices: Array.isArray(journey.viewports) ? journey.viewports.map((item) => safeText(item)) : [],
      steps: Array.isArray(journey.steps) ? journey.steps.length : 0,
    })),
  };
}

export async function loadDashboardModel({ root }) {
  const [registry, routeCatalog, apiCatalog, oracleCatalog, selection, guardianSummary, oracleSummary, verdict] = await Promise.all([
    readJson(join(root, "qa/guardian/desktop-journeys.json")),
    readJson(join(root, "qa/guardian/desktop-owner-route-catalog.json")),
    readJson(join(root, "qa/guardian/desktop-owner-api-contracts.json")),
    readJson(join(root, "qa/guardian/outcome-oracles.json")),
    readJson(join(root, "artifacts/qa-guardian/selection.json")),
    readJson(join(root, "artifacts/qa-guardian/summary.json")),
    readJson(join(root, "artifacts/qa-guardian/outcome-oracles.json")),
    readJson(join(root, "artifacts/qa-guardian/release-verdict.json")),
  ]);
  return buildDashboardModel({ registry, routeCatalog, apiCatalog, oracleCatalog, selection, guardianSummary, oracleSummary, verdict });
}
