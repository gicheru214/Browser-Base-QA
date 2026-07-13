#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const commands = {
  list: { script: "scripts/qa-guardian-stagehand.mjs", prefix: ["--list"] },
  plan: { script: "scripts/qa-guardian-select.mjs", prefix: [] },
  run: { script: "scripts/qa-guardian-stagehand.mjs", prefix: [] },
  oracles: { script: "scripts/qa-outcome-oracles.mjs", prefix: [] },
  verdict: { script: "scripts/qa-release-verdict.mjs", prefix: [] },
  dashboard: { script: "scripts/qa-dashboard-server.mjs", prefix: [] },
};

const commandHelp = {
  list: "browser-base-qa list [--tier=N] [--journey=id[,id]] [--device=id[,id]] [--environment=name]",
  plan: "browser-base-qa plan [--base=ref] [--head=ref] [--files=path[,path]] [--output=path]",
  run: "browser-base-qa run [--tier=N] [--journey=id[,id]] [--device=id[,id]] [--environment=name] [--dry-run]",
  oracles: "browser-base-qa oracles  # configure target URLs and expected SHA with QA_GUARDIAN_* environment variables",
  verdict: "browser-base-qa verdict  # reads artifacts/qa-guardian and exits nonzero when blocked",
  dashboard: "browser-base-qa dashboard [--host=127.0.0.1] [--port=4174]",
};

function help() {
  return `Browser Base QA

Usage:
  browser-base-qa <command> [options]

Commands:
  list        List selected Guardian journeys without opening a browser
  plan        Select required QA from changed files
  run         Run Browserbase + Stagehand journeys
  oracles     Run read-only PestFlow outcome oracles
  verdict     Evaluate the centralized release verdict
  dashboard   Open the local reliability dashboard

Examples:
  browser-base-qa list --tier=1
  browser-base-qa plan --base=origin/main --head=HEAD
  browser-base-qa run --tier=0 --journey=desktop-owner-core
  browser-base-qa dashboard --port=4174

Run evidence is written beneath artifacts/qa-guardian and the dashboard reads
that same evidence. Use --help after a command to see its accepted options.`;
}

function run(command, args) {
  const definition = commands[command];
  const child = spawn(process.execPath, [join(root, definition.script), ...definition.prefix, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(`[browser-base-qa] ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`[browser-base-qa] command stopped by ${signal}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(help());
} else if (!commands[command]) {
  console.error(`Unknown command: ${command}\n\n${help()}`);
  process.exitCode = 1;
} else if (args.includes("--help") || args.includes("-h")) {
  console.log(commandHelp[command]);
} else {
  run(command, args);
}
