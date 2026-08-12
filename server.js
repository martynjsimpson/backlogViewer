#!/usr/bin/env node

const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const { ConfigurationError, loadProjectConfiguration } = require("./src/config");
const { updateWidgetHistory } = require("./src/history");
const { buildHealth, calculateWidgets, createSummaries, linkModel } = require("./src/model");
const { parseActiveRelease, parseBacklog, parseRequests } = require("./src/parsers");

const publicDir = path.join(__dirname, "public");
const allowedHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const securityHeaders = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function getArg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new ConfigurationError(`Missing value for ${name}`, "INVALID_ARGUMENT");
  }
  return value;
}

function usage() {
  return `work-management-viewer [options]\n\nOptions:\n  --project <path>  Project directory or project.yml (default: current directory)\n  --port <number>   Local port (default: 5177)\n  --help            Show this help\n`;
}

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(statusCode, {
    ...securityHeaders,
    "cache-control": "no-store",
    "content-type": contentType,
    ...headers,
  });
  res.end(res.req?.method === "HEAD" ? undefined : body);
}

function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  try {
    const address = new URL(`http://${hostHeader}`);
    return !address.username
      && !address.password
      && address.pathname === "/"
      && !address.search
      && !address.hash
      && allowedHostnames.has(address.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function getData(config) {
  const [requestsMarkdown, backlogYaml, activeReleaseMarkdown] = await Promise.all([
    fs.readFile(config.files.requests, "utf8"),
    fs.readFile(config.files.backlog, "utf8"),
    readOptional(config.files.activeRelease),
  ]);
  const requestDocument = parseRequests(requestsMarkdown, config.ids);
  const backlogDocument = parseBacklog(backlogYaml, config.ids);
  const activeRelease = parseActiveRelease(activeReleaseMarkdown, config.ids);
  const linked = linkModel(requestDocument.items, backlogDocument.items);
  const health = await buildHealth({
    config,
    requestDocument,
    backlogDocument,
    activeRelease,
    ...linked,
  });
  const widgets = calculateWidgets(linked.requests, linked.backlog, activeRelease, health);
  const widgetHistory = await updateWidgetHistory(config.root, widgets);
  return {
    generated_at: new Date().toISOString(),
    project: {
      name: config.manifest.project.name,
      description: config.manifest.project.description,
      root: config.root,
      manifest: config.manifest,
    },
    files: {
      manifest: config.files.manifest,
      requests: config.files.requests,
      backlog: config.files.backlog,
      active_release: config.files.activeRelease,
      spikes: config.files.spikes,
      changelog: config.files.changelog,
    },
    requests: linked.requests,
    backlog: linked.backlog,
    active_release: activeRelease,
    health,
    widgets,
    widget_history: widgetHistory,
    summaries: createSummaries(linked.requests, linked.backlog),
  };
}

async function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
    send(res, 403, "Forbidden");
    return;
  }
  try {
    send(res, 200, await fs.readFile(filePath), mimeTypes[path.extname(filePath)] || "application/octet-stream");
  } catch (error) {
    send(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Unable to read asset");
  }
}

function createServer(config) {
  return http.createServer(async (req, res) => {
    if (!isAllowedHost(req.headers.host)) {
      send(res, 421, "Misdirected request");
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      send(res, 405, "Method not allowed", "text/plain; charset=utf-8", { allow: "GET, HEAD" });
      return;
    }
    let pathname;
    try {
      ({ pathname } = new URL(req.url, "http://127.0.0.1"));
    } catch {
      send(res, 400, "Invalid request URL");
      return;
    }
    if (pathname === "/api/data") {
      try {
        send(res, 200, JSON.stringify(await getData(config)), "application/json; charset=utf-8");
      } catch (error) {
        send(res, 500, JSON.stringify({ error: error.message, code: error.code || "DATA_ERROR", details: error.details || [] }), "application/json; charset=utf-8");
      }
      return;
    }
    await serveStatic(res, pathname);
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return null;
  }
  const projectInput = getArg(argv, "--project") || process.env.WORK_MANAGEMENT_PROJECT || process.cwd();
  const port = Number(getArg(argv, "--port") || process.env.PORT || 5177);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigurationError(`Invalid port: ${port}`, "INVALID_PORT");
  const config = await loadProjectConfiguration(projectInput);
  const server = createServer(config);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Work Management Viewer listening at http://127.0.0.1:${port}`);
  console.log(`Project: ${config.manifest.project.name}`);
  console.log(`Manifest: ${config.manifestFile}`);
  return server;
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      for (const detail of error.details || []) console.error(`- ${detail}`);
    } else {
      console.error(error.stack || error.message);
    }
    process.exitCode = 1;
  });
}

module.exports = { createServer, getArg, getData, isAllowedHost, main, usage };
