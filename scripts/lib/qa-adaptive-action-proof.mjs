import { runOwnerApiContracts, validateOwnerApiContractCatalog } from "./qa-owner-api-contracts.mjs";

export const ADAPTIVE_ACTION_PROOF_CONTRACT = "adaptive-action-deterministic-proof";

const FORBIDDEN_SECRET_PATTERN = /(password|secret|token|api[_-]?key)\s*[:=]/i;
const CRITICAL_CONSOLE_PATTERN = /uncaught|typeerror|referenceerror|chunkloaderror|error boundary|cannot read properties/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateRelativePath(path, label, errors) {
  if (typeof path !== "string" || !/^\/(?!\/)[^#\s]*$/.test(path)) {
    errors.push(`${label}: path must be a same-origin relative absolute path`);
  }
  if (FORBIDDEN_SECRET_PATTERN.test(String(path || ""))) errors.push(`${label}: path contains secret-like data`);
}

export function validateAdaptiveActionProof(proof, { label = "proof", writePolicy = "read-only" } = {}) {
  const errors = [];
  if (!isPlainObject(proof)) return [`${label}: deterministic proof is required`];

  const hasOutcome = Boolean(proof.url)
    || (Array.isArray(proof.visible) && proof.visible.length > 0)
    || (Array.isArray(proof.responses) && proof.responses.length > 0)
    || (Array.isArray(proof.apiContracts) && proof.apiContracts.length > 0);
  if (!hasOutcome) errors.push(`${label}: at least one URL, visible state, HTTP response, or API contract outcome is required`);

  if (proof.url !== undefined) {
    if (!isPlainObject(proof.url)) errors.push(`${label}.url must be an object`);
    else {
      validateRelativePath(proof.url.path, `${label}.url`, errors);
      if (!['exact', 'prefix'].includes(proof.url.match || "exact")) errors.push(`${label}.url: match must be exact or prefix`);
    }
  }

  if (proof.visible !== undefined && !Array.isArray(proof.visible)) errors.push(`${label}.visible must be an array`);
  for (const [index, expected] of (proof.visible || []).entries()) {
    const itemLabel = `${label}.visible[${index}]`;
    if (!isPlainObject(expected) || typeof expected.selector !== "string" || !expected.selector.trim()) {
      errors.push(`${itemLabel}: selector is required`);
      continue;
    }
    if (FORBIDDEN_SECRET_PATTERN.test(`${expected.selector} ${expected.text || ""}`)) errors.push(`${itemLabel}: secret-like text is forbidden`);
    if (expected.source !== undefined && !["text", "value"].includes(expected.source)) {
      errors.push(`${itemLabel}: source must be text or value`);
    }
    if (expected.match !== undefined && !["contains", "equals"].includes(expected.match)) {
      errors.push(`${itemLabel}: match must be contains or equals`);
    }
  }

  if (proof.responses !== undefined && !Array.isArray(proof.responses)) errors.push(`${label}.responses must be an array`);
  for (const [index, expected] of (proof.responses || []).entries()) {
    const itemLabel = `${label}.responses[${index}]`;
    if (!isPlainObject(expected)) {
      errors.push(`${itemLabel}: response contract must be an object`);
      continue;
    }
    validateRelativePath(expected.path, itemLabel, errors);
    if (!/^[A-Z]+$/.test(expected.method || "")) errors.push(`${itemLabel}: uppercase HTTP method is required`);
    if (!Array.isArray(expected.statuses) || !expected.statuses.length || expected.statuses.some((status) => !Number.isInteger(status))) {
      errors.push(`${itemLabel}: statuses must contain integer HTTP statuses`);
    }
    if (!['exact', 'prefix'].includes(expected.match || "exact")) errors.push(`${itemLabel}: match must be exact or prefix`);
  }

  if (proof.apiContracts !== undefined) {
    const catalogErrors = validateOwnerApiContractCatalog({ schemaVersion: 1, contracts: proof.apiContracts });
    errors.push(...catalogErrors.map((error) => `${label}.apiContracts: ${error}`));
  }

  for (const field of ["maxCriticalConsoleErrors", "maxCriticalNetworkFailures"]) {
    if (!Number.isInteger(proof[field]) || proof[field] < 0) errors.push(`${label}.${field} must be a non-negative integer`);
  }
  if (writePolicy === "qa-tenant-write" && !(proof.apiContracts?.length || proof.responses?.length)) {
    errors.push(`${label}: a write journey requires HTTP response or follow-up API proof`);
  }
  return errors;
}

function pathMatches(actual, expected, match = "exact") {
  return match === "prefix" ? actual.startsWith(expected) : actual === expected;
}

export async function verifyAdaptiveActionProof({ page, proof, baseUrl, apiUrl, httpResponses = [], consoleErrors = [], criticalNetworkFailures = [] }) {
  const validationErrors = validateAdaptiveActionProof(proof);
  if (validationErrors.length) throw new Error(validationErrors.join("; "));

  const evidence = {
    contract: ADAPTIVE_ACTION_PROOF_CONTRACT,
    url: null,
    visible: [],
    responses: [],
    apiContracts: null,
    criticalConsoleErrors: 0,
    criticalNetworkFailures: criticalNetworkFailures.length,
  };

  if (proof.url) {
    const actual = new URL(page.url());
    const expectedOrigin = new URL(baseUrl).origin;
    if (actual.origin !== expectedOrigin) throw new Error(`deterministic proof left the expected origin: ${actual.origin}`);
    if (!pathMatches(actual.pathname, proof.url.path, proof.url.match)) {
      throw new Error(`deterministic URL proof expected ${proof.url.match || "exact"} ${proof.url.path}, received ${actual.pathname}`);
    }
    evidence.url = { path: actual.pathname, match: proof.url.match || "exact" };
  }

  for (const expected of proof.visible || []) {
    const locator = page.locator(expected.selector);
    await locator.waitFor({ state: "visible", timeout: Number(expected.timeoutMs || 15_000) });
    const source = expected.source || "text";
    const observedText = String(source === "value" ? await locator.inputValue() : await locator.textContent() || "").trim();
    if (expected.text !== undefined) {
      const passed = (expected.match || "contains") === "equals"
        ? observedText === String(expected.text)
        : observedText.includes(String(expected.text));
      if (!passed) throw new Error(`deterministic visible proof failed for ${expected.selector}`);
    }
    evidence.visible.push({ selector: expected.selector, source, textMatched: expected.text === undefined ? null : true });
  }

  for (const expected of proof.responses || []) {
    const match = httpResponses.find((response) => (
      response.method === expected.method
      && pathMatches(response.path, expected.path, expected.match)
      && expected.statuses.includes(response.status)
    ));
    if (!match) {
      throw new Error(`deterministic HTTP proof missing ${expected.method} ${expected.path} with status ${expected.statuses.join(" or ")}`);
    }
    evidence.responses.push({ method: match.method, path: match.path, status: match.status });
  }

  if (proof.apiContracts?.length) {
    const apiEvidence = await runOwnerApiContracts({
      page,
      apiUrl,
      catalog: { schemaVersion: 1, contracts: proof.apiContracts },
    });
    if (apiEvidence.failedChecks > 0) throw new Error(`${apiEvidence.failedChecks}/${apiEvidence.expectedChecks} deterministic API proofs failed`);
    evidence.apiContracts = apiEvidence;
  }

  const criticalConsoleErrors = consoleErrors.filter((entry) => CRITICAL_CONSOLE_PATTERN.test(entry.text || entry.message || ""));
  evidence.criticalConsoleErrors = criticalConsoleErrors.length;
  if (criticalConsoleErrors.length > proof.maxCriticalConsoleErrors) {
    throw new Error(`deterministic console proof found ${criticalConsoleErrors.length} critical errors`);
  }
  if (criticalNetworkFailures.length > proof.maxCriticalNetworkFailures) {
    throw new Error(`deterministic network proof found ${criticalNetworkFailures.length} critical failures`);
  }

  return evidence;
}
