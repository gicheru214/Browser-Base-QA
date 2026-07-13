const byId = (id) => document.getElementById(id);

function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusClass(status) {
  const safe = ["passed", "failed", "blocked", "warning", "passed-with-warnings", "skipped"].includes(status) ? status : "loading";
  return `is-${safe}`;
}

function renderMetrics(metrics) {
  const items = [
    ["Registered journeys", metrics.registeredJourneys, `${metrics.matrixEntries} journey-device checks`],
    ["Owner routes", metrics.ownerRoutes, "deterministic page contracts"],
    ["API contracts", metrics.apiContracts, "authenticated and read-only"],
    ["Browser passed", metrics.passed, `${metrics.failed} failed · ${metrics.skipped} skipped`],
    ["Oracles passed", metrics.oraclesPassed, `${metrics.oraclesFailed} currently failing`],
    ["Device profiles", metrics.registeredDevices, `${metrics.selectedJourneys} journeys selected`],
  ];
  const grid = byId("metric-grid");
  clear(grid);
  for (const [label, value, note] of items) {
    const card = element("article", "metric");
    card.append(element("span", "", label), element("strong", "", String(value)), element("small", "", note));
    grid.append(card);
  }
}

function renderResults(target, results, kind) {
  clear(target);
  if (!results.length) {
    target.append(element("p", "empty-state", kind === "journey" ? "No Guardian evidence has been written yet." : "Run the oracle command to populate production evidence."));
    return;
  }
  for (const result of results) {
    const row = element("div", `result-row ${statusClass(result.status)}`);
    const dot = element("i");
    const copy = element("div");
    const detail = kind === "journey"
      ? `${result.device} · ${result.persona} · ${result.passedSteps}/${result.totalSteps} steps${result.error ? ` · ${result.error}` : ""}`
      : `${result.statusCode ?? "No response"} · ${result.durationMs ?? "—"} ms${result.error ? ` · ${result.error}` : ""}`;
    copy.append(element("strong", "", result.title), element("small", "", detail));
    row.append(dot, copy);
    if (kind === "journey" && result.replayUrl) {
      const link = element("a", "result-action", "Replay");
      link.href = result.replayUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      row.append(link);
    } else {
      row.append(element("span", "chip", result.status));
    }
    target.append(row);
  }
}

function renderRegistry(registry) {
  const body = byId("registry-body");
  clear(body);
  byId("registry-count").textContent = `${registry.length} journeys`;
  for (const journey of registry) {
    const row = document.createElement("tr");
    for (const value of [journey.title, `Tier ${journey.tier}`, journey.persona, journey.writePolicy, journey.devices.join(", "), journey.steps]) {
      row.append(element("td", "", String(value)));
    }
    body.append(row);
  }
}

function render(model) {
  const readiness = byId("readiness-card");
  readiness.className = `readiness-card ${statusClass(model.readiness.status)}`;
  byId("readiness-status").textContent = model.readiness.status.replaceAll("-", " ");
  byId("last-updated").textContent = `Evidence read ${new Date(model.generatedAt).toLocaleString()}`;
  byId("run-id").textContent = model.run.id;
  byId("oracle-status").textContent = model.oracles.status.replaceAll("-", " ");

  const attention = byId("attention-panel");
  const blockerList = byId("blocker-list");
  clear(blockerList);
  attention.hidden = model.readiness.blockers.length === 0;
  for (const blocker of model.readiness.blockers) blockerList.append(element("li", "", blocker));

  renderMetrics(model.metrics);
  renderResults(byId("journey-list"), model.run.results, "journey");
  renderResults(byId("oracle-list"), model.oracles.results, "oracle");
  renderRegistry(model.registry);
}

async function refresh() {
  const button = byId("refresh-button");
  button.disabled = true;
  button.textContent = "Refreshing…";
  try {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    render(await response.json());
  } catch (error) {
    const readiness = byId("readiness-card");
    readiness.className = "readiness-card is-failed";
    byId("readiness-status").textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
    button.textContent = "Refresh evidence";
  }
}

byId("refresh-button").addEventListener("click", refresh);
refresh();
setInterval(refresh, 15_000);
