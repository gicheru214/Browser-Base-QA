const NOISE_HOSTS = [
  /(^|\.)posthog\.com$/i,
  /(^|\.)sentry\.io$/i,
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)segment\.io$/i,
  /(^|\.)browserbase\.com$/i,
];

const NON_FAILURE_ABORTS = [
  /net::ERR_ABORTED/i,
  /NS_BINDING_ABORTED/i,
  /cancelled by client/i,
];

const PAGE_ERROR_NOISE = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
];

const SENSITIVE_QUERY_KEY = /token|secret|password|passcode|api[-_]?key|authorization|email|phone/i;

function parseUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

export function redactEvidenceUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return String(value || "").slice(0, 2000);
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.set(key, "<redacted>");
  }
  return parsed.toString().slice(0, 2000);
}

export function sanitizeNetworkFailure(entry = {}) {
  return {
    kind: entry.kind === "requestfailed" ? "requestfailed" : "response",
    url: redactEvidenceUrl(entry.url),
    method: String(entry.method || "GET").slice(0, 20),
    resourceType: String(entry.resourceType || "other").slice(0, 40),
    status: Number(entry.status || 0),
    statusText: String(entry.statusText || "").slice(0, 300),
    errorText: String(entry.errorText || "").slice(0, 500),
    timestamp: String(entry.timestamp || new Date().toISOString()),
  };
}

function configuredOrigins(baseUrls = []) {
  return new Set(baseUrls.map(parseUrl).filter(Boolean).map((url) => url.origin));
}

function isNoiseHost(url) {
  return NOISE_HOSTS.some((pattern) => pattern.test(url.hostname));
}

export function networkFailureIsCritical(entry, { baseUrls = [] } = {}) {
  const failure = sanitizeNetworkFailure(entry);
  const url = parseUrl(failure.url);
  if (!url || isNoiseHost(url)) return false;
  const origins = configuredOrigins(baseUrls);
  if (origins.size && !origins.has(url.origin)) return false;
  if (NON_FAILURE_ABORTS.some((pattern) => pattern.test(failure.errorText))) return false;

  const resourceType = failure.resourceType.toLowerCase();
  const customerCriticalResource = ["document", "script", "stylesheet", "xhr", "fetch"].includes(resourceType);
  if (!customerCriticalResource) return false;

  if (failure.kind === "requestfailed") return true;
  if (failure.status >= 500) return true;
  if (failure.status === 429) return true;
  if (["document", "script", "stylesheet"].includes(resourceType) && failure.status >= 400) return true;
  return false;
}

export function selectCriticalNetworkFailures(entries, options = {}) {
  return (entries || [])
    .map(sanitizeNetworkFailure)
    .filter((entry) => networkFailureIsCritical(entry, options));
}

export function selectCriticalPageErrors(entries) {
  return (entries || [])
    .map((entry) => ({
      message: String(entry?.message || entry || "").slice(0, 2000),
      timestamp: String(entry?.timestamp || new Date().toISOString()),
    }))
    .filter((entry) => entry.message && !PAGE_ERROR_NOISE.some((pattern) => pattern.test(entry.message)));
}
