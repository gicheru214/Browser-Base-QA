export function evaluateReleaseEvidence({ policy, selection, guardianSummary, outcomeOracleSummary, deterministicExitCode, desktop50ExitCode, browserConfigured = false }) {
  const blockers = [];
  const warnings = [];
  const requiresBrowser = Boolean(selection?.requiresBrowserQa);
  const requiresDeterministic = Boolean(selection?.requiresDesktopCritical);
  const requiresDesktop50 = Boolean(selection?.requiresDesktop50);
  const requiresOutcomeOracles = Boolean(selection?.requiresOutcomeOracles ?? (requiresBrowser || requiresDeterministic || requiresDesktop50));

  if (requiresOutcomeOracles) {
    if (!outcomeOracleSummary) blockers.push("read-only outcome oracle evidence is missing");
    else {
      const oracleResults = Array.isArray(outcomeOracleSummary.results) ? outcomeOracleSummary.results : [];
      const minimum = Number(policy.outcomeOracles?.minRequired ?? 1);
      const failed = Math.max(
        Number(outcomeOracleSummary.counts?.failed || 0),
        oracleResults.filter((result) => result.status !== "passed").length,
      );
      if (oracleResults.length < minimum) blockers.push(`outcome oracle evidence contains ${oracleResults.length}/${minimum} required results`);
      if (outcomeOracleSummary.status !== "passed" || failed > Number(policy.outcomeOracles?.maxFailed ?? 0)) {
        blockers.push(`${Math.max(1, failed)} read-only outcome oracle(s) failed`);
      }
    }
  }

  if (requiresDeterministic) {
    if (deterministicExitCode === null || deterministicExitCode === undefined || deterministicExitCode === "") {
      blockers.push("deterministic desktop evidence is missing");
    } else if (Number(deterministicExitCode) !== Number(policy.deterministic.requiredExitCode)) {
      blockers.push(`deterministic desktop suite exited ${deterministicExitCode}`);
    }
  }

  if (requiresDesktop50) {
    if (desktop50ExitCode === null || desktop50ExitCode === undefined || desktop50ExitCode === "") {
      blockers.push("desktop 48-feature evidence is missing");
    } else if (Number(desktop50ExitCode) !== Number(policy.deterministic.requiredExitCode)) {
      blockers.push(`desktop 48-feature suite exited ${desktop50ExitCode}`);
    }
  }

  if (requiresBrowser && !browserConfigured) blockers.push("Browserbase Guardian was selected but is not configured");
  if (requiresBrowser && browserConfigured && !guardianSummary) blockers.push("Browserbase Guardian summary is missing");

  if (guardianSummary) {
    const guardianResults = Array.isArray(guardianSummary.results) ? guardianSummary.results : [];
    if (requiresBrowser && !guardianResults.length) blockers.push("Browserbase Guardian summary contains no journey results");
    const observedJourneyIds = new Set(guardianResults.map((result) => result.journeyId));
    for (const journeyId of selection?.journeyIds || []) {
      if (!observedJourneyIds.has(journeyId)) blockers.push(`Browserbase Guardian summary is missing selected journey ${journeyId}`);
    }
    const failed = Number(guardianSummary.counts?.failed || 0);
    const skipped = Number(guardianSummary.counts?.skipped || 0);
    if (failed > policy.browser.maxFailed) blockers.push(`${failed} Guardian matrix entries failed`);
    if (skipped > policy.browser.maxSkipped) blockers.push(`${skipped} Guardian matrix entries were skipped`);
    for (const result of guardianResults) {
      if (result.status !== "passed") continue;
      if (policy.evidence.requireSessionUrl && !result.sessionUrl) blockers.push(`${result.journeyId}/${result.deviceId} has no Browserbase session URL`);
      for (const step of result.steps || []) {
        if (step.status === "passed" && policy.evidence.requirePassedStepScreenshot && !step.screenshot) {
          blockers.push(`${result.journeyId}/${result.deviceId}/${step.id} has no screenshot evidence`);
        }
        const readyAfterMs = Number(step.output?.navigation?.readyAfterMs ?? step.output?.readyAfterMs ?? 0);
        if (readyAfterMs > policy.browser.blockUiReadyMs) blockers.push(`${result.journeyId}/${step.id} took ${readyAfterMs} ms to become usable`);
        else if (readyAfterMs > policy.browser.warnUiReadyMs) warnings.push(`${result.journeyId}/${step.id} took ${readyAfterMs} ms to become usable`);
      }
      const criticalConsoleErrors = (result.consoleErrors || []).filter((entry) => /uncaught|typeerror|referenceerror|chunkloaderror|cannot read properties/i.test(entry.text || ""));
      if (criticalConsoleErrors.length > policy.browser.maxCriticalConsoleErrors) {
        blockers.push(`${result.journeyId}/${result.deviceId} emitted ${criticalConsoleErrors.length} critical console errors`);
      }
    }
  }

  return {
    schemaVersion: 1,
    status: blockers.length ? "blocked" : warnings.length ? "passed-with-warnings" : "passed",
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    required: { browser: requiresBrowser, deterministic: requiresDeterministic, desktop50: requiresDesktop50, outcomeOracles: requiresOutcomeOracles },
  };
}
