import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDashboardModel } from "./lib/qa-dashboard-model.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardRoot = join(root, "dashboard");

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const host = option("host", process.env.QA_DASHBOARD_HOST || "127.0.0.1");
const port = Number(option("port", process.env.QA_DASHBOARD_PORT || "4174"));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function headers(type) {
  return {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data: https://browserbase.com; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

async function handler(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
  if (request.method !== "GET") {
    response.writeHead(405, headers("application/json; charset=utf-8"));
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  if (url.pathname === "/api/dashboard") {
    const model = await loadDashboardModel({ root });
    response.writeHead(200, headers("application/json; charset=utf-8"));
    response.end(`${JSON.stringify(model)}\n`);
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const allowed = new Set(["index.html", "app.js", "styles.css"]);
  if (!allowed.has(safePath)) {
    response.writeHead(404, headers("text/plain; charset=utf-8"));
    response.end("Not found");
    return;
  }
  const body = await readFile(join(dashboardRoot, safePath));
  response.writeHead(200, headers(contentTypes[extname(safePath)] || "application/octet-stream"));
  response.end(body);
}

const server = createServer((request, response) => {
  handler(request, response).catch((error) => {
    response.writeHead(500, headers("application/json; charset=utf-8"));
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  });
});

server.listen(port, host, () => {
  console.log(`[browser-base-qa] dashboard http://${host}:${port}`);
  console.log("[browser-base-qa] reading artifacts/qa-guardian; refreshes every 15 seconds");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
