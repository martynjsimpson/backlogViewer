const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ConfigurationError, discoverManifest, loadProjectConfiguration } = require("../src/config");
const { buildHealth, calculateWidgets, linkModel } = require("../src/model");
const { parseActiveRelease, parseBacklog, parseRequests } = require("../src/parsers");
const { getData, usage } = require("../server");

const fixtureRoot = path.join(__dirname, "fixtures", "custom-project");

test("discovers the conventional docs/work manifest from a nested directory", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-discovery-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const nested = path.join(root, "src", "nested");
  await fs.mkdir(path.join(root, "docs", "work"), { recursive: true });
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, "docs", "work", "project.yml"), "model_version: 3\n");
  const result = await discoverManifest(nested);
  assert.equal(result.manifestFile, path.join(root, "docs", "work", "project.yml"));
});

test("stops on a stale manifest before reading project fields", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-stale-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, "project.yml");
  await fs.writeFile(manifest, "model_version: 2\n");
  await assert.rejects(() => loadProjectConfiguration(manifest), (error) => error instanceof ConfigurationError && error.code === "UNSUPPORTED_MODEL_VERSION");
});

test("links both directions and validates a conforming fixture", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const [requestSource, backlogSource, releaseSource] = await Promise.all([
    fs.readFile(config.files.requests, "utf8"),
    fs.readFile(config.files.backlog, "utf8"),
    fs.readFile(config.files.activeRelease, "utf8"),
  ]);
  const requestDocument = parseRequests(requestSource, config.ids);
  const backlogDocument = parseBacklog(backlogSource, config.ids);
  const activeRelease = parseActiveRelease(releaseSource, config.ids);
  const linked = linkModel(requestDocument.items, backlogDocument.items);
  const health = await buildHealth({ config, requestDocument, backlogDocument, activeRelease, ...linked });
  assert.deepEqual(linked.requests.find((request) => request.id === "ASK-0001").resolved_backlog_items, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(health.summary, { errors: 0, warnings: 0, total: 0 });
  assert.equal(calculateWidgets(linked.requests, linked.backlog, activeRelease, health).activeReleaseRequests, 1);
});

test("builds the complete API model from a project manifest", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-state-"));
  context.after(async () => {
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const data = await getData(config);
  assert.equal(data.project.name, "Fixture Project");
  assert.equal(data.active_release.status, "proposed");
  assert.deepEqual(data.health.summary, { errors: 0, warnings: 0, total: 0 });
  assert.equal(data.widgets.healthErrors, 0);
  assert.match(data.widget_history.state_file, /[a-f0-9]{16}\.json$/);
});

test("documents the project and port CLI options", () => {
  assert.match(usage(), /--project <path>/);
  assert.match(usage(), /--port <number>/);
});
