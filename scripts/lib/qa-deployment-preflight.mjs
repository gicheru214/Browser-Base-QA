const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 5_000;

export function normalizeSha(value) {
  return String(value || "").trim().toLowerCase();
}

export function deploymentMatches(actualSha, expectedSha) {
  const actual = normalizeSha(actualSha);
  const expected = normalizeSha(expectedSha);
  if (!actual || !expected) return false;
  return actual.startsWith(expected) || expected.startsWith(actual);
}

export async function waitForExpectedDeployment({
  baseUrl,
  expectedSha,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
}) {
  const expected = normalizeSha(expectedSha);
  if (!expected) return { checked: false, reason: "no expected SHA configured" };

  const healthUrl = new URL("/health", `${String(baseUrl).replace(/\/+$/, "")}/`).toString();
  const startedAt = now();
  let attempts = 0;
  let lastActualSha = "";
  let lastError = "";

  while (now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      const response = await fetchImpl(healthUrl, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
      });
      if (!response.ok) throw new Error(`health returned HTTP ${response.status}`);
      const payload = await response.json();
      lastActualSha = normalizeSha(payload?.deployment?.commitSha);
      if (deploymentMatches(lastActualSha, expected)) {
        return {
          checked: true,
          matched: true,
          expectedSha: expected,
          actualSha: lastActualSha,
          attempts,
          healthUrl,
          deployment: payload.deployment,
        };
      }
      lastError = lastActualSha
        ? `deployed SHA ${lastActualSha} does not match expected SHA ${expected}`
        : "health response did not expose deployment.commitSha";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (now() - startedAt >= timeoutMs) break;
    await sleep(intervalMs);
  }

  throw new Error(
    `Deployment preflight timed out after ${attempts} attempt(s): ${lastError || `expected ${expected}`}`,
  );
}
