const DEFAULT_FORBIDDEN = [
  "delete",
  "remove account",
  "send invoice",
  "send email",
  "send text",
  "charge",
  "pay now",
  "refund",
  "change password",
  "invite user",
  "disconnect integration",
  "cancel subscription",
];

function asText(value) {
  return String(value || "").toLowerCase();
}

function includesAny(value, patterns = []) {
  const text = asText(value);
  return patterns.some((pattern) => text.includes(asText(pattern)));
}

export function validateGuardianRegistry(registry) {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!registry?.defaultBaseUrl) errors.push("defaultBaseUrl is required");
  if (!registry?.devices || !Object.keys(registry.devices).length) errors.push("at least one device is required");
  if (!registry?.personas || !Object.keys(registry.personas).length) errors.push("at least one persona is required");
  if (!Array.isArray(registry?.journeys) || !registry.journeys.length) errors.push("at least one journey is required");

  const journeyIds = new Set();
  for (const journey of registry?.journeys || []) {
    if (!journey.id) errors.push("journey id is required");
    if (journeyIds.has(journey.id)) errors.push(`duplicate journey id: ${journey.id}`);
    journeyIds.add(journey.id);
    if (!registry.personas?.[journey.persona]) errors.push(`${journey.id}: unknown persona ${journey.persona}`);
    if (!["read-only", "qa-tenant-write"].includes(journey.writePolicy)) errors.push(`${journey.id}: invalid writePolicy`);
    if (!Array.isArray(journey.viewports) || !journey.viewports.length) errors.push(`${journey.id}: viewports are required`);
    for (const viewport of journey.viewports || []) {
      if (!registry.devices?.[viewport]) errors.push(`${journey.id}: unknown viewport ${viewport}`);
    }
    if (!Array.isArray(journey.steps) || !journey.steps.length) errors.push(`${journey.id}: steps are required`);
    const stepIds = new Set();
    for (const step of journey.steps || []) {
      if (!step.id) errors.push(`${journey.id}: step id is required`);
      if (stepIds.has(step.id)) errors.push(`${journey.id}: duplicate step id ${step.id}`);
      stepIds.add(step.id);
      if (!["navigate", "extract", "observe", "act", "route-check"].includes(step.type)) {
        errors.push(`${journey.id}/${step.id}: unsupported step type ${step.type}`);
      }
      if (["navigate", "route-check"].includes(step.type) && !step.path) {
        errors.push(`${journey.id}/${step.id}: path is required`);
      }
      if (["extract", "observe", "act"].includes(step.type) && !step.instruction) {
        errors.push(`${journey.id}/${step.id}: instruction is required`);
      }
    }
  }
  return errors;
}

export function selectGuardianMatrix(registry, { journeyIds = [], deviceIds = [], maxTier = 1 } = {}) {
  const selectedJourneyIds = new Set(journeyIds.filter(Boolean));
  const selectedDeviceIds = new Set(deviceIds.filter(Boolean));
  return (registry.journeys || []).flatMap((journey) => {
    if (selectedJourneyIds.size && !selectedJourneyIds.has(journey.id)) return [];
    if (Number(journey.tier ?? 1) > maxTier) return [];
    return journey.viewports
      .filter((deviceId) => !selectedDeviceIds.size || selectedDeviceIds.has(deviceId))
      .map((deviceId) => ({ journey, deviceId, device: registry.devices[deviceId] }));
  });
}

export function assertObservedActionAllowed(action, { journey, step, registry, allowWrites = false } = {}) {
  const method = String(action?.method || "");
  const description = [step?.instruction, action?.description, ...(action?.arguments || [])].join(" ");
  const forbidden = [...DEFAULT_FORBIDDEN, ...(registry?.forbiddenActionPatterns || [])];
  const allowedMethods = step?.allowedMethods || ["click"];
  if (method && !allowedMethods.includes(method)) {
    throw new Error(`Stagehand proposed disallowed method ${method || "<empty>"} for ${journey?.id}/${step?.id}`);
  }
  if (!method && step?.type === "act") {
    throw new Error(`Stagehand proposed an action without a method for ${journey?.id}/${step?.id}`);
  }
  if (step?.type === "act" && includesAny(description, forbidden)) {
    throw new Error(`Stagehand proposed a forbidden action for ${journey?.id}/${step?.id}: ${description}`);
  }
  if (step?.type === "act" && journey?.writePolicy === "qa-tenant-write" && !allowWrites) {
    throw new Error(`Write-enabled journey ${journey.id} requires QA_GUARDIAN_ALLOW_WRITES=1`);
  }
  if (step?.type === "act" && journey?.writePolicy === "read-only" && !step?.safeInteraction) {
    throw new Error(`Read-only journey ${journey?.id} cannot execute ${step?.id} without safeInteraction=true`);
  }
  return true;
}

export function validateSemanticResult(result, expectations = {}, globalForbidden = []) {
  const errors = [];
  const haystack = JSON.stringify(result || {}).toLowerCase();
  const requiredAny = expectations.requiredAny || [];
  const forbiddenAny = [...globalForbidden, ...(expectations.forbiddenAny || [])];
  if (requiredAny.length && !requiredAny.some((value) => haystack.includes(asText(value)))) {
    errors.push(`none of the required terms were visible: ${requiredAny.join(", ")}`);
  }
  const foundForbidden = forbiddenAny.filter((value) => haystack.includes(asText(value)));
  if (foundForbidden.length) errors.push(`forbidden error content was visible: ${foundForbidden.join(", ")}`);
  if (Number.isFinite(expectations.maxErrorMessages)) {
    const messages = Array.isArray(result?.errorMessages) ? result.errorMessages.filter(Boolean) : [];
    if (messages.length > expectations.maxErrorMessages) {
      errors.push(`expected at most ${expectations.maxErrorMessages} error messages, found ${messages.length}: ${messages.join(" | ")}`);
    }
  }
  return errors;
}

export function assertExpectedNavigation({ actualUrl, baseUrl, expectedPath, expectedStatuses, status }) {
  const actual = new URL(actualUrl);
  const base = new URL(baseUrl);
  if (actual.origin !== base.origin) throw new Error(`navigation left the expected origin: ${actual.origin}`);
  if (expectedPath && actual.pathname !== expectedPath) {
    throw new Error(`expected path ${expectedPath}, received ${actual.pathname}`);
  }
  if (Array.isArray(expectedStatuses) && expectedStatuses.length && !expectedStatuses.includes(status)) {
    throw new Error(`expected navigation status ${expectedStatuses.join(" or ")}, received ${status}`);
  }
  return true;
}
