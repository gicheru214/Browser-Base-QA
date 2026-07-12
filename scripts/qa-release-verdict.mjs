import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateReleaseEvidence } from "./lib/qa-release-verdict.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), "utf8")) : null;
const policy = readJson("qa/guardian/quality-policy.json");
const selection = readJson(process.env.QA_SELECTION_PATH || "artifacts/qa-guardian/selection.json");
const guardianSummary = readJson(process.env.QA_GUARDIAN_SUMMARY_PATH || "artifacts/qa-guardian/summary.json");
const outcomeOracleSummary = readJson(process.env.QA_OUTCOME_ORACLE_SUMMARY_PATH || "artifacts/qa-guardian/outcome-oracles.json");
if (!policy || !selection) throw new Error("quality policy and QA selection are required");

const verdict = evaluateReleaseEvidence({
  policy,
  selection,
  guardianSummary,
  outcomeOracleSummary,
  deterministicExitCode: process.env.QA_DETERMINISTIC_EXIT_CODE,
  desktop50ExitCode: process.env.QA_DESKTOP_50_EXIT_CODE,
  browserConfigured: process.env.QA_BROWSER_CONFIGURED === "true",
});
const outputPath = join(root, process.env.QA_VERDICT_OUTPUT || "artifacts/qa-guardian/release-verdict.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(verdict, null, 2)}\n`);

const report = [
  "## Desktop QA release verdict",
  "",
  `- Status: **${verdict.status}**`,
  `- Browser evidence required: ${verdict.required.browser}`,
  `- Deterministic evidence required: ${verdict.required.deterministic}`,
  `- Desktop 48-feature evidence required: ${verdict.required.desktop50}`,
  `- Read-only outcome oracle evidence required: ${verdict.required.outcomeOracles}`,
  ...verdict.blockers.map((item) => `- BLOCKER: ${item}`),
  ...verdict.warnings.map((item) => `- WARNING: ${item}`),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: "a" });
console.log(JSON.stringify(verdict, null, 2));
if (verdict.status === "blocked") process.exitCode = 1;
