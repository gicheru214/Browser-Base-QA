export function globToRegex(pattern) {
  let source = "";
  const value = String(pattern);
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "*" && value[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

export function matchesPattern(file, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  return globToRegex(pattern).test(file);
}

export function validateChangeMap(changeMap, registry) {
  const errors = [];
  if (changeMap?.schemaVersion !== 1) errors.push("change map schemaVersion must be 1");
  if (!Array.isArray(changeMap?.rules) || !changeMap.rules.length) errors.push("change map must contain rules");
  const knownJourneys = new Set((registry?.journeys || []).map((journey) => journey.id));
  const ruleIds = new Set();
  for (const rule of changeMap?.rules || []) {
    if (!rule.id) errors.push("change-map rule id is required");
    if (ruleIds.has(rule.id)) errors.push(`duplicate change-map rule id: ${rule.id}`);
    ruleIds.add(rule.id);
    if (!Array.isArray(rule.patterns) || !rule.patterns.length) errors.push(`${rule.id}: patterns are required`);
    if (!Array.isArray(rule.journeys) || !rule.journeys.length) errors.push(`${rule.id}: journeys are required`);
    for (const journeyId of rule.journeys || []) {
      if (journeyId !== "*" && !knownJourneys.has(journeyId)) errors.push(`${rule.id}: unknown journey ${journeyId}`);
    }
  }
  return errors;
}

export function selectQaForChanges({ files, changeMap, registry }) {
  const normalizedFiles = [...new Set((files || []).map((file) => String(file).trim()).filter(Boolean))].sort();
  const allJourneyIds = (registry.journeys || []).map((journey) => journey.id);
  const journeyIds = new Set();
  const checks = new Set(["guardian-policy"]);
  const matchedRules = [];
  const matchedFiles = new Set();
  for (const rule of changeMap.rules || []) {
    const ruleFiles = normalizedFiles.filter((file) => (rule.patterns || []).some((pattern) => matchesPattern(file, pattern)));
    if (!ruleFiles.length) continue;
    matchedRules.push({ id: rule.id, description: rule.description, files: ruleFiles });
    ruleFiles.forEach((file) => matchedFiles.add(file));
    (rule.journeys || []).forEach((id) => {
      if (id === "*") allJourneyIds.forEach((journeyId) => journeyIds.add(journeyId));
      else journeyIds.add(id);
    });
    (rule.checks || []).forEach((check) => checks.add(check));
  }
  const unmatchedFiles = normalizedFiles.filter((file) => !matchedFiles.has(file));
  const selectedJourneys = allJourneyIds.filter((id) => journeyIds.has(id));
  const maxTier = selectedJourneys.reduce((highest, id) => {
    const journey = registry.journeys.find((candidate) => candidate.id === id);
    return Math.max(highest, Number(journey?.tier || 0));
  }, 0);
  return {
    schemaVersion: 1,
    changedFiles: normalizedFiles,
    matchedRules,
    unmatchedFiles,
    journeyIds: selectedJourneys,
    devices: changeMap.defaultDevices || ["desktop-1440"],
    maxTier,
    checks: [...checks].sort(),
    requiresBrowserQa: selectedJourneys.length > 0,
    requiresDesktopCritical: checks.has("desktop-critical"),
    requiresDesktop50: checks.has("desktop-50"),
    requiresOutcomeOracles: selectedJourneys.length > 0 || checks.has("desktop-critical") || checks.has("desktop-50"),
  };
}
