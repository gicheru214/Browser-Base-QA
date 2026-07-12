import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { selectQaForChanges, validateChangeMap } from "./lib/qa-change-selector.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function changedFiles() {
  const explicit = option("files") || process.env.QA_CHANGED_FILES || "";
  if (explicit) return explicit.split(/[\n,]/).map((file) => file.trim()).filter(Boolean);
  const base = option("base", process.env.QA_BASE_REF || "origin/main");
  const head = option("head", process.env.QA_HEAD_REF || "HEAD");
  const output = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], { cwd: root, encoding: "utf8" });
  return output.split(/\r?\n/).filter(Boolean);
}

const registry = JSON.parse(readFileSync(resolve(root, "qa/guardian/desktop-journeys.json"), "utf8"));
const changeMap = JSON.parse(readFileSync(resolve(root, "qa/guardian/change-map.json"), "utf8"));
const errors = validateChangeMap(changeMap, registry);
if (errors.length) throw new Error(errors.join("\n"));
const selection = selectQaForChanges({ files: changedFiles(), changeMap, registry });

const outputPath = option("output", process.env.QA_SELECTION_OUTPUT || "artifacts/qa-guardian/selection.json");
const fullOutputPath = resolve(root, outputPath);
await import("node:fs/promises").then(({ mkdir }) => mkdir(dirname(fullOutputPath), { recursive: true }));
writeFileSync(fullOutputPath, `${JSON.stringify(selection, null, 2)}\n`);

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `journeys=${selection.journeyIds.join(",")}`,
    `devices=${selection.devices.join(",")}`,
    `max_tier=${selection.maxTier}`,
    `checks=${selection.checks.join(",")}`,
    `requires_browser_qa=${selection.requiresBrowserQa}`,
    `requires_desktop_critical=${selection.requiresDesktopCritical}`,
    `requires_desktop_50=${selection.requiresDesktop50}`,
    `requires_outcome_oracles=${selection.requiresOutcomeOracles}`,
    `selection_path=${outputPath}`,
  ];
  writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, { flag: "a" });
}

console.log(JSON.stringify(selection, null, 2));
