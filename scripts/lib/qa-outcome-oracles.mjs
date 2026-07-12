const ALLOWED_BASES = new Set(["app", "api"]);
const ALLOWED_OPERATORS = new Set(["equals", "present", "includesAll", "isoWithinSeconds"]);

function valueAtPath(payload, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], payload);
}

export function validateOutcomeOracleRegistry(registry) {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push("outcome oracle schemaVersion must be 1");
  if (!Array.isArray(registry?.oracles) || !registry.oracles.length) errors.push("at least one outcome oracle is required");
  const ids = new Set();
  for (const oracle of registry?.oracles || []) {
    if (!oracle.id) errors.push("outcome oracle id is required");
    if (ids.has(oracle.id)) errors.push(`duplicate outcome oracle id: ${oracle.id}`);
    ids.add(oracle.id);
    if (!ALLOWED_BASES.has(oracle.base)) errors.push(`${oracle.id}: base must be app or api`);
    if ((oracle.method || "GET").toUpperCase() !== "GET") errors.push(`${oracle.id}: only GET is allowed`);
    if (!String(oracle.path || "").startsWith("/")) errors.push(`${oracle.id}: path must start with /`);
    if (String(oracle.path || "").startsWith("//")) errors.push(`${oracle.id}: protocol-relative paths are forbidden`);
    if (/[?#]/.test(String(oracle.path || ""))) errors.push(`${oracle.id}: query strings and fragments are forbidden`);
    if (!Array.isArray(oracle.expectedStatuses) || !oracle.expectedStatuses.length) errors.push(`${oracle.id}: expectedStatuses are required`);
    if (!Array.isArray(oracle.assertions) || !oracle.assertions.length) errors.push(`${oracle.id}: assertions are required`);
    for (const assertion of oracle.assertions || []) {
      if (!assertion.path) errors.push(`${oracle.id}: assertion path is required`);
      if (!ALLOWED_OPERATORS.has(assertion.operator)) errors.push(`${oracle.id}: unsupported operator ${assertion.operator}`);
      if (assertion.operator === "includesAll" && !Array.isArray(assertion.value)) errors.push(`${oracle.id}: includesAll value must be an array`);
      if (assertion.operator === "isoWithinSeconds" && !(Number(assertion.value) > 0)) errors.push(`${oracle.id}: isoWithinSeconds value must be positive`);
    }
  }
  return errors;
}

export function evaluateOutcomeAssertion(assertion, payload, now = () => Date.now()) {
  const actual = valueAtPath(payload, assertion.path);
  let passed = false;
  let reason = "";
  if (assertion.operator === "equals") {
    passed = Object.is(actual, assertion.value);
    reason = passed ? "matched expected value" : "response value did not match the configured expectation";
  } else if (assertion.operator === "present") {
    passed = actual !== undefined && actual !== null && actual !== "";
    reason = passed ? "value is present" : "value is missing";
  } else if (assertion.operator === "includesAll") {
    const missing = Array.isArray(actual) ? assertion.value.filter((item) => !actual.includes(item)) : assertion.value;
    passed = Array.isArray(actual) && missing.length === 0;
    reason = passed ? `all ${assertion.value.length} required values are present` : `missing values: ${missing.join(", ")}`;
  } else if (assertion.operator === "isoWithinSeconds") {
    const timestamp = Date.parse(actual);
    const ageSeconds = Number.isFinite(timestamp) ? Math.abs(now() - timestamp) / 1000 : Number.POSITIVE_INFINITY;
    passed = ageSeconds <= Number(assertion.value);
    reason = passed ? `timestamp age ${Math.round(ageSeconds)}s is within limit` : `timestamp is invalid or older than ${assertion.value}s`;
  }
  return { path: assertion.path, operator: assertion.operator, passed, reason };
}

function safeEndpoint(baseUrl, path) {
  const origin = new URL(String(baseUrl));
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("oracle base URL must use http or https");
  const endpoint = new URL(path, `${origin.origin}/`);
  if (endpoint.origin !== origin.origin) throw new Error("oracle endpoint must stay on its configured origin");
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error("oracle endpoint may not contain credentials, query strings, or fragments");
  return endpoint.toString();
}

function shaMatches(actualSha, expectedSha) {
  const actual = String(actualSha || "").trim().toLowerCase();
  const expected = String(expectedSha || "").trim().toLowerCase();
  return Boolean(actual && expected && (actual.startsWith(expected) || expected.startsWith(actual)));
}

export async function runOutcomeOracle({ oracle, bases, expectedSha = "", fetchImpl = fetch, now = () => Date.now(), defaultTimeoutMs = 15000 }) {
  const startedAtMs = now();
  const result = {
    id: oracle.id,
    title: oracle.title,
    status: "failed",
    method: "GET",
    url: "",
    statusCode: null,
    durationMs: 0,
    checks: [],
  };
  try {
    if ((oracle.method || "GET").toUpperCase() !== "GET") throw new Error("only GET outcome oracles are allowed");
    if (!ALLOWED_BASES.has(oracle.base) || !bases?.[oracle.base]) throw new Error(`missing allowed ${oracle.base} base URL`);
    result.url = safeEndpoint(bases[oracle.base], oracle.path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(oracle.timeoutMs || defaultTimeoutMs));
    let response;
    try {
      response = await fetchImpl(result.url, {
        method: "GET",
        headers: { accept: "application/json", "cache-control": "no-cache" },
        redirect: "error",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    result.statusCode = response.status;
    if (!(oracle.expectedStatuses || []).includes(response.status)) {
      throw new Error(`expected HTTP ${(oracle.expectedStatuses || []).join("/")}, received ${response.status}`);
    }
    const contentType = response.headers?.get?.("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) throw new Error(`expected JSON content type, received ${contentType || "none"}`);
    const payload = await response.json();
    result.checks = (oracle.assertions || []).map((assertion) => evaluateOutcomeAssertion(assertion, payload, now));
    if (oracle.matchExpectedSha && expectedSha) {
      const actualSha = valueAtPath(payload, "deployment.commitSha");
      const passed = shaMatches(actualSha, expectedSha);
      result.checks.push({
        path: "deployment.commitSha",
        operator: "matchesExpectedSha",
        passed,
        reason: passed ? "deployment SHA matches the candidate" : "deployment SHA does not match the candidate",
      });
    }
    const failures = result.checks.filter((check) => !check.passed);
    if (failures.length) throw new Error(`${failures.length} assertion(s) failed`);
    result.status = "passed";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.durationMs = Math.max(0, now() - startedAtMs);
  return result;
}

export async function runOutcomeOracles({ registry, bases, environment = "unknown", expectedSha = "", fetchImpl = fetch, now = () => Date.now() }) {
  const errors = validateOutcomeOracleRegistry(registry);
  if (errors.length) throw new Error(errors.join("\n"));
  const startedAt = new Date(now()).toISOString();
  const results = [];
  for (const oracle of registry.oracles) {
    results.push(await runOutcomeOracle({ oracle, bases, expectedSha, fetchImpl, now, defaultTimeoutMs: registry.defaultTimeoutMs }));
  }
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  return {
    schemaVersion: 1,
    environment,
    status: failed ? "failed" : "passed",
    startedAt,
    finishedAt: new Date(now()).toISOString(),
    counts: { total: results.length, passed, failed },
    results,
  };
}
