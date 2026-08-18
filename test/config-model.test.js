const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ConfigurationError, discoverManifest, loadProjectConfiguration } = require("../src/config");
const { buildHealth, calculateWidgets, createFinding, linkModel } = require("../src/model");
const { parseActiveRelease, parseBacklog, parseCompletionValues, parseRequests } = require("../src/parsers");
const { getData, usage } = require("../server");

const fixtureRoot = path.join(__dirname, "fixtures", "custom-project");

test("discovers the conventional docs/work manifest from a nested directory", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-discovery-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const nested = path.join(root, "src", "nested");
  await fs.mkdir(path.join(root, "docs", "work"), { recursive: true });
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, "docs", "work", "project.yml"), "model_version: 4\n");
  const result = await discoverManifest(nested);
  assert.equal(result.manifestFile, path.join(root, "docs", "work", "project.yml"));
});

test("resolves model v4 monorepo paths from the project boundary", async (context) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-monorepo-"));
  context.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const projectRoot = path.join(repositoryRoot, "apps", "tool-a");
  const manifestFile = path.join(projectRoot, "docs", "work", "project.yml");
  const nested = path.join(projectRoot, "src", "nested");
  await fs.mkdir(path.dirname(manifestFile), { recursive: true });
  await fs.mkdir(nested, { recursive: true });
  // Worktrees expose `.git` as a file, which is still a valid repository boundary.
  await fs.writeFile(path.join(repositoryRoot, ".git"), "gitdir: /tmp/example\n");
  const fixtureManifest = await fs.readFile(path.join(fixtureRoot, "project.yml"), "utf8");
  const scopedManifest = fixtureManifest
    .replace("root: null", "root: apps/tool-a")
    .replace("system: none", "system: git")
    .replace("changelog: CHANGELOG.md", "changelog: /CHANGELOG.md");
  await fs.writeFile(manifestFile, scopedManifest);

  const config = await loadProjectConfiguration(nested);
  assert.equal(config.manifestFile, manifestFile);
  assert.equal(config.root, projectRoot);
  assert.equal(config.vcsRoot, repositoryRoot);
  assert.equal(config.workDir, path.join(projectRoot, "work"));
  assert.equal(config.files.changelog, path.join(repositoryRoot, "CHANGELOG.md"));
  assert.equal(config.resolveProjectPath("/shared/config.yml"), path.join(repositoryRoot, "shared", "config.yml"));
});

test("stops on a stale manifest before reading project fields", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-stale-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, "project.yml");
  await fs.writeFile(manifest, "model_version: 2\n");
  await assert.rejects(() => loadProjectConfiguration(manifest), (error) => error instanceof ConfigurationError && error.code === "UNSUPPORTED_MODEL_VERSION");
});

test("continues to load a conforming model v3 manifest", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-v3-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, "project.yml");
  const source = await fs.readFile(path.join(fixtureRoot, "project.yml"), "utf8");
  const versionThreeSource = source
    .replace("model_version: 4", "model_version: 3")
    .replace(/scope:\n  root: null\n  writes_outside: \[\]\n  agents_dir: project\n/, "")
    .replace("  tag_template: null\n", "");
  await fs.writeFile(manifest, versionThreeSource);

  const config = await loadProjectConfiguration(manifest);
  assert.equal(config.manifest.model_version, 3);
  assert.equal(config.root, root);
  assert.equal(config.workDir, path.join(root, "work"));
});

test("rejects a model v4 manifest that omits its new compatibility fields", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-shape-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = path.join(root, "project.yml");
  const source = await fs.readFile(path.join(fixtureRoot, "project.yml"), "utf8");
  await fs.writeFile(manifest, source.replace("  tag_template: null\n", ""));
  await assert.rejects(
    () => loadProjectConfiguration(manifest),
    (error) => error instanceof ConfigurationError
      && error.code === "INVALID_MANIFEST_SHAPE"
      && error.details.includes("version.tag_template"),
  );
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
  assert.deepEqual(health.summary, { errors: 0, warnings: 0, recommendations: 0, total: 0 });
  assert.equal(calculateWidgets(linked.requests, linked.backlog, activeRelease, health).activeReleaseRequests, 1);
});

test("requires request completion only when derived work shipped in a release", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const [requestSource, backlogSource, releaseSource] = await Promise.all([
    fs.readFile(config.files.requests, "utf8"),
    fs.readFile(config.files.backlog, "utf8"),
    fs.readFile(config.files.activeRelease, "utf8"),
  ]);
  const requestDocument = parseRequests(requestSource, config.ids);
  const backlogDocument = parseBacklog(backlogSource, config.ids);
  const activeRelease = parseActiveRelease(releaseSource, config.ids);
  const request = requestDocument.items.find((item) => item.id === "ASK-0001");
  request.done_in = [];

  const referredWork = {
    ...backlogDocument.items[0],
    id: "TASK-0003",
    source_request: "ASK-0002",
    status: "done",
    done_in: parseCompletionValues("v1.2.3", config.ids),
  };
  backlogDocument.items.push(referredWork);
  request.work_items.push(referredWork.id);

  let linked = linkModel(requestDocument.items, backlogDocument.items);
  let health = await buildHealth({ config, requestDocument, backlogDocument, activeRelease, ...linked });
  assert.equal(health.findings.some((finding) => finding.code === "COMPLETION_MISSING" && finding.entity_id === request.id), false);

  const derivedWork = backlogDocument.items.find((item) => item.id === "TASK-0001");
  derivedWork.status = "done";
  derivedWork.done_in = parseCompletionValues("v1.2.3", config.ids);
  linked = linkModel(requestDocument.items, backlogDocument.items);
  health = await buildHealth({ config, requestDocument, backlogDocument, activeRelease, ...linked });
  const finding = health.findings.find((entry) => entry.code === "COMPLETION_MISSING" && entry.entity_id === request.id);
  assert.match(finding.message, /TASK-0001: v1\.2\.3/);
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
  assert.deepEqual(data.release_dates, { "1.2.3": "2025-04-06" });
  assert.deepEqual(data.health.summary, { errors: 0, warnings: 0, recommendations: 0, total: 0 });
  assert.equal(data.widgets.healthErrors, 0);
  assert.match(data.widget_history.state_file, /[a-f0-9]{16}\.json$/);
});

test("documents the project and port CLI options", () => {
  assert.match(usage(), /--project <path>/);
  assert.match(usage(), /--port <number>/);
});

test("turns health codes into concrete remediation guidance", () => {
  const annotated = createFinding(
    "warning",
    "ANNOTATED_COMPLETION_VALUE",
    "Remove explanatory text from this completion value",
    "v1.2.3 (partial — TASK-0001)",
    { entity_type: "request", entity_id: "ASK-0001" },
  );
  assert.equal(annotated.action_type, "fix");
  assert.match(annotated.meaning, /machine-readable completion field/);
  assert.match(annotated.recommended_action, /replace .* with only the release version/i);
  assert.match(annotated.recommended_action, /Notes:/);

  const unknown = createFinding(
    "warning",
    "UNKNOWN_REQUEST_FIELD",
    "Move unsupported request field: Remaining",
    "Line 20: follow-up work",
    { entity_type: "request", entity_id: "ASK-0002" },
  );
  assert.match(unknown.recommended_action, /Move the Remaining: text into Notes:/);

  const pruning = createFinding(
    "recommendation",
    "PRUNING_HYGIENE",
    "Review old completed records for pruning",
    "42 old records",
    { entity_type: "project", entity_id: "Fixture Project" },
  );
  assert.equal(pruning.severity, "recommendation");
  assert.equal(pruning.action_type, "maintenance");
  assert.equal(pruning.command, "/work-prune");
  assert.match(pruning.meaning, /No immediate correctness fix is required/);

  const nonScalar = createFinding(
    "error",
    "NON_SCALAR_COMPLETION_VALUE",
    "Quote this non-scalar completion value",
    "SPIKE: TASK-0001",
    { entity_type: "work", entity_id: "TASK-0001" },
  );
  assert.match(nonScalar.meaning, /object rather than a string/);
  assert.match(nonScalar.recommended_action, /quote the whole marker/i);

  const otherWarningCodes = [
    ["INVALID_COMPLETION_VALUE", "Replace this free-text completion value", { entity_type: "work", entity_id: "TASK-0001" }],
    ["MISSING_AGENT_PATH", "Review this missing agent path", { entity_type: "agent", entity_id: "implementer" }],
    ["REQUEST_SECTION_STRUCTURE", "Merge legacy request sections", { entity_type: "file", entity_id: "requests.md" }],
    ["REQUEST_ID_FORMAT", "Review this request ID format", { entity_type: "request", entity_id: "ASK-1" }],
    ["WORK_ID_FORMAT", "Review this work-item ID format", { entity_type: "work", entity_id: "TASK-1" }],
    ["RELEASE_STATUS_DRIFT", "Synchronise release status", { entity_type: "work", entity_id: "TASK-0001" }],
    ["VCS_MISMATCH", "Review the Git repository mismatch", { entity_type: "manifest", entity_id: "vcs.system" }],
    ["MISSING_CHANGELOG", "Create or correct the configured changelog", { entity_type: "manifest", entity_id: "paths.changelog" }],
  ];
  for (const [code, title, entity] of otherWarningCodes) {
    const result = createFinding("warning", code, title, "observed value", entity);
    assert.ok(result.meaning, `${code} should explain what it means`);
    assert.ok(result.recommended_action, `${code} should provide a recommended action`);
    assert.ok(result.action_type, `${code} should classify the response`);
    assert.doesNotMatch(result.meaning, /^This value differs/, `${code} should not use fallback guidance`);
  }
});
