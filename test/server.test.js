const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadProjectConfiguration } = require("../src/config");
const { createServer, getArg, isAllowedHost } = require("../server");

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
