const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { ConfigurationError, discoverManifest, loadProjectConfiguration } = require("../src/config");
const { buildHealth, calculateWidgets, createFinding, linkModel } = require("../src/model");
const { parseActiveRelease, parseBacklog, parseCompletionValues, parseRequests } = require("../src/parsers");
const { getData, usage } = require("../server");

const fixtureRoot = path.join(__dirname, "fixtures", "custom-project");

function manifestSourceForVersion(source, modelVersion) {
  const manifest = YAML.parse(source);
  manifest.model_version = modelVersion;
  if (modelVersion < 5) {
    manifest.vcs = { system: manifest.vcs.system, owner: null, branching: null };
    manifest.version.owner = "command";
  }
  if (modelVersion < 4) {
    delete manifest.scope;
    delete manifest.version.tag_template;
  }
  return YAML.stringify(manifest);
}

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
  const scopedManifest = YAML.parse(manifestSourceForVersion(fixtureManifest, 4));
  scopedManifest.scope.root = "apps/tool-a";
  scopedManifest.vcs = { system: "git", owner: "command", branching: "branch" };
  scopedManifest.paths.changelog = "/CHANGELOG.md";
  await fs.writeFile(manifestFile, YAML.stringify(scopedManifest));

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
  await fs.writeFile(manifest, manifestSourceForVersion(source, 3));

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
  const versionFour = YAML.parse(manifestSourceForVersion(source, 4));
  delete versionFour.version.tag_template;
  await fs.writeFile(manifest, YAML.stringify(versionFour));
  await assert.rejects(
    () => loadProjectConfiguration(manifest),
    (error) => error instanceof ConfigurationError
      && error.code === "INVALID_MANIFEST_SHAPE"
      && error.details.includes("version.tag_template"),
  );
});

test("loads model v5 release stages and rejects incomplete stage maps", async (context) => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  assert.equal(config.manifest.model_version, 5);
  assert.deepEqual(Object.keys(config.manifest.vcs.stages), ["branch", "commit", "push", "merge", "pull_request", "tag"]);
  assert.equal(config.manifest.vcs.delete_branch, "after-merge");
  assert.equal(config.manifest.version.owner, "agent");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-v5-shape-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifestFile = path.join(root, "project.yml");
  const invalid = structuredClone(config.manifest);
  delete invalid.vcs.stages.pull_request;
  await fs.writeFile(manifestFile, YAML.stringify(invalid));
  await assert.rejects(
    () => loadProjectConfiguration(manifestFile),
    (error) => error instanceof ConfigurationError
      && error.code === "INVALID_MANIFEST_SHAPE"
      && error.details.includes("vcs.stages.pull_request"),
  );
});

test("reports invalid model v5 stage combinations and a missing version file", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  config.manifest.vcs = {
    system: "git",
    stages: {
      branch: "none",
      commit: "none",
      push: "none",
      merge: "agent",
      pull_request: "agent",
      tag: "none",
    },
    delete_branch: "after-merge",
  };
  config.manifest.version.file = null;
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

  assert.ok(health.findings.some((finding) => finding.code === "INVALID_VCS_STAGE_CONFIGURATION" && /commit may not be none/.test(finding.message)));
  assert.ok(health.findings.some((finding) => finding.code === "INVALID_VCS_STAGE_CONFIGURATION" && /may not both be active/.test(finding.message)));
  assert.ok(health.findings.some((finding) => finding.code === "VERSION_FILE_REQUIRED"));
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

test("links a selected legacy release ID and reports an unresolved ID", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const [requestSource, backlogSource] = await Promise.all([
    fs.readFile(config.files.requests, "utf8"),
    fs.readFile(config.files.backlog, "utf8"),
  ]);
  const requestDocument = parseRequests(requestSource, config.ids);
  const backlogDocument = parseBacklog(backlogSource, config.ids);
  backlogDocument.items.push({
    ...backlogDocument.items[0],
    id: "BUG-058",
    title: "Legacy fixture item",
    source_block: "id: BUG-058",
  });
  const activeRelease = parseActiveRelease(`
# Active Release

Status: approved

## Selected work items

### BUG-058 — Legacy fixture item
Source: ASK-0001 | Type: bug | Priority: high | Status: ready

### UNKNOWN-999 — Missing fixture item
Status: ready
`, config.ids);
  const linked = linkModel(requestDocument.items, backlogDocument.items);
  const health = await buildHealth({ config, requestDocument, backlogDocument, activeRelease, ...linked });

  assert.equal(activeRelease.work_items[0].live_item.id, "BUG-058");
  assert.ok(health.findings.some((finding) => (
    finding.code === "MISSING_RELEASE_ITEM" && finding.entity_id === "UNKNOWN-999"
  )));
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
  assert.equal(data.viewer.version, require("../package.json").version);
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
