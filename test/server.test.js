const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadProjectConfiguration } = require("../src/config");
const { createProjectChangeFeed, createServer, getArg, isAllowedHost, shouldIgnoreWatchPath } = require("../server");

const fixtureManifest = path.join(__dirname, "fixtures", "custom-project", "project.yml");

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: options.path || "/",
      method: options.method || "GET",
      headers: options.headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("accepts only local Host headers", () => {
  assert.equal(isAllowedHost("127.0.0.1:5177"), true);
  assert.equal(isAllowedHost("localhost:5177"), true);
  assert.equal(isAllowedHost("[::1]:5177"), true);
  assert.equal(isAllowedHost("viewer.example:5177"), false);
  assert.equal(isAllowedHost(""), false);
});

test("rejects CLI options without values", () => {
  assert.throws(() => getArg(["--port"], "--port"), /Missing value for --port/);
  assert.throws(() => getArg(["--project", "--port", "5178"], "--project"), /Missing value for --project/);
});

test("debounces project changes and ignores generated dependency paths", async () => {
  let onChange;
  const watcher = new EventEmitter();
  watcher.close = () => {};
  const feed = createProjectChangeFeed("/fixture", {
    debounceMs: 10,
    heartbeatMs: 60000,
    watchFactory: (_root, options, callback) => {
      assert.equal(options.recursive, true);
      onChange = callback;
      return watcher;
    },
  });
  const req = new EventEmitter();
  req.method = "GET";
  const chunks = [];
  const res = {
    writeHead(status, headers) {
      assert.equal(status, 200);
      assert.match(headers["content-type"], /text\/event-stream/);
    },
    write(chunk) { chunks.push(chunk); },
    end() {},
  };
  feed.connect(req, res);
  assert.match(chunks.join(""), /event: ready/);
  assert.match(chunks.join(""), /"watching":true/);

  onChange("change", ".git/index");
  onChange("change", "docs/work/backlog.yml");
  onChange("rename", "docs/work/backlog.yml");
  await new Promise((resolve) => setTimeout(resolve, 30));

  const events = chunks.join("");
  assert.equal((events.match(/event: change/g) || []).length, 1);
  assert.match(events, /"revision":1/);
  assert.equal(shouldIgnoreWatchPath("node_modules/yaml/index.js"), true);
  assert.equal(shouldIgnoreWatchPath("docs/work/active-release.md"), false);
  req.emit("close");
  feed.close();
});

test("serves the local read-only API with browser security headers", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-server-state-"));
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  const config = await loadProjectConfiguration(fixtureManifest);
  const server = createServer(config);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });
  const { port } = server.address();

  const home = await request(port);
  assert.equal(home.status, 200);
  assert.match(home.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  assert.equal(home.headers["x-frame-options"], "DENY");

  const api = await request(port, { path: "/api/data" });
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(api.body).project.name, "Fixture Project");

  const eventsHead = await request(port, { method: "HEAD", path: "/api/events" });
  assert.equal(eventsHead.status, 200);
  assert.match(eventsHead.headers["content-type"], /text\/event-stream/);

  const head = await request(port, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");

  const post = await request(port, { method: "POST", path: "/api/data" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");

  const rebinding = await request(port, { headers: { host: "viewer.example" } });
  assert.equal(rebinding.status, 421);
  assert.equal(rebinding.body, "Misdirected request");
});
