function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateOwnerApiContractCatalog(catalog) {
  const errors = [];
  if (!isPlainObject(catalog)) return ["catalog must be an object"];
  if (catalog.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(catalog.contracts) || catalog.contracts.length === 0) {
    errors.push("contracts must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  const paths = new Set();
  for (const [index, contract] of catalog.contracts.entries()) {
    const label = contract?.id || `contracts[${index}]`;
    if (!isPlainObject(contract)) {
      errors.push(`contracts[${index}] must be an object`);
      continue;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(contract.id || "")) {
      errors.push(`${label}: id must be a lowercase kebab-case string`);
    } else if (ids.has(contract.id)) {
      errors.push(`${label}: duplicate id`);
    }
    ids.add(contract.id);

    if (typeof contract.path !== "string" || !/^\/(?!\/)[^#\s]+$/.test(contract.path)) {
      errors.push(`${label}: path must be a relative absolute-path without a fragment`);
    } else {
      const resolved = new URL(contract.path, "https://pestflow.invalid");
      if (resolved.origin !== "https://pestflow.invalid") errors.push(`${label}: path escapes the configured API origin`);
      if (/(?:token|secret|password|api[_-]?key)=/i.test(resolved.search)) errors.push(`${label}: path contains a forbidden secret parameter`);
      if (paths.has(contract.path)) errors.push(`${label}: duplicate path`);
    }
    paths.add(contract.path);

    if (!Array.isArray(contract.requiredKeys) || contract.requiredKeys.length === 0) {
      errors.push(`${label}: requiredKeys must be a non-empty array`);
      continue;
    }
    if (contract.requiredKeys.some((key) => typeof key !== "string" || !key)) {
      errors.push(`${label}: requiredKeys must contain non-empty strings`);
    }
    if (new Set(contract.requiredKeys).size !== contract.requiredKeys.length) {
      errors.push(`${label}: requiredKeys must be unique`);
    }
    if (contract.requiredArrayKeys !== undefined && !Array.isArray(contract.requiredArrayKeys)) {
      errors.push(`${label}: requiredArrayKeys must be an array when present`);
      continue;
    }
    for (const key of contract.requiredArrayKeys || []) {
      if (!contract.requiredKeys.includes(key)) errors.push(`${label}: array key ${key} must also be required`);
    }
  }
  return errors;
}

export async function runOwnerApiContracts({ page, apiUrl, catalog }) {
  const validationErrors = validateOwnerApiContractCatalog(catalog);
  if (validationErrors.length) {
    throw new Error(`Invalid owner API contract catalog:\n- ${validationErrors.join("\n- ")}`);
  }

  const normalizedApiUrl = apiUrl.replace(/\/+$/, "");
  const results = [];
  for (const contract of catalog.contracts) {
    const startedAt = Date.now();
    let observed;
    try {
      observed = await page.evaluate(async ({ target, requiredKeys, requiredArrayKeys }) => {
        try {
          const response = await fetch(target, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          const contentType = response.headers.get("content-type") || "";
          let error = null;
          let body = null;
          if (response.status !== 200) {
            error = `expected HTTP 200, received ${response.status}`;
          } else if (!contentType.toLowerCase().includes("application/json")) {
            error = `expected application/json, received ${contentType || "missing content-type"}`;
          } else {
            try {
              const parsed = await response.json();
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                error = "expected a JSON object response";
              } else {
                body = parsed;
                const missingKeys = requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(body, key));
                const wrongArrayKeys = requiredArrayKeys.filter((key) => !Array.isArray(body[key]));
                if (missingKeys.length) error = `missing required keys: ${missingKeys.join(", ")}`;
                if (wrongArrayKeys.length) {
                  error = [error, `expected array keys: ${wrongArrayKeys.join(", ")}`].filter(Boolean).join("; ");
                }
              }
            } catch {
              error = "response body was not valid JSON";
            }
          }
          return {
            arrayCounts: Object.fromEntries(requiredArrayKeys.map((key) => [
              key,
              Array.isArray(body?.[key]) ? body[key].length : -1,
            ])),
            contentType: contentType.split(";")[0] || "missing",
            error,
            observedKeys: body ? Object.keys(body).sort() : [],
            status: response.status,
          };
        } catch {
          return {
            arrayCounts: {},
            contentType: "missing",
            error: "authenticated browser fetch failed",
            observedKeys: [],
            status: 0,
          };
        }
      }, {
        target: new URL(contract.path, `${normalizedApiUrl}/`).toString(),
        requiredKeys: contract.requiredKeys,
        requiredArrayKeys: contract.requiredArrayKeys || [],
      });
    } catch {
      observed = {
        arrayCounts: {},
        contentType: "missing",
        error: "browser evaluation failed",
        observedKeys: [],
        status: 0,
      };
    }

    results.push({
      ...observed,
      durationMs: Date.now() - startedAt,
      id: contract.id,
      passed: observed.error === null,
      path: contract.path,
    });
  }

  const failures = results.filter((row) => !row.passed);
  return {
    schemaVersion: catalog.schemaVersion,
    completedAt: new Date().toISOString(),
    expectedChecks: catalog.contracts.length,
    passedChecks: results.length - failures.length,
    failedChecks: failures.length,
    failures,
    results,
  };
}
