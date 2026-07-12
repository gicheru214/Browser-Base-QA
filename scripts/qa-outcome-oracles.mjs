import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { runOutcomeOracles } from "./lib/qa-outcome-oracles.mjs";

const registryPath = resolve(process.env.QA_OUTCOME_ORACLE_REGISTRY || "qa/guardian/outcome-oracles.json");
const outputPath = resolve(process.env.QA_OUTCOME_ORACLE_OUTPUT || "artifacts/qa-guardian/outcome-oracles.json");

let summary;
try {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  summary = await runOutcomeOracles({
    registry,
    environment: process.env.QA_GUARDIAN_ENV || "production",
    bases: {
      app: process.env.QA_GUARDIAN_BASE_URL || "https://new.pestflow.org",
      api: process.env.QA_GUARDIAN_API_URL || "https://api.pestflow.org",
    },
    expectedSha: process.env.QA_GUARDIAN_EXPECTED_SHA || "",
  });
} catch (error) {
  summary = {
    schemaVersion: 1,
    environment: process.env.QA_GUARDIAN_ENV || "production",
    status: "failed",
    counts: { total: 0, passed: 0, failed: 1 },
    error: error instanceof Error ? error.message : String(error),
    results: [],
  };
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

const lines = [
  "## PestFlow read-only outcome oracles",
  "",
  `- Status: **${summary.status}**`,
  `- Passed: ${summary.counts?.passed || 0}`,
  `- Failed: ${summary.counts?.failed || 0}`,
  ...summary.results.map((result) => `- ${result.status === "passed" ? "PASS" : "FAIL"}: ${result.title} (${result.statusCode ?? "no response"})${result.error ? ` - ${result.error}` : ""}`),
  summary.error ? `- FAIL: ${summary.error}` : "",
  "",
].filter(Boolean);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "passed") process.exitCode = 1;
