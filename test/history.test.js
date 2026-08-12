const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { stateFileForProject, updateWidgetHistory } = require("../src/history");

test("keeps metric history isolated by canonical project root", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-history-"));
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  context.after(async () => {
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });

  const projectA = path.join(stateRoot, "project-a");
  const projectB = path.join(stateRoot, "project-b");
  assert.notEqual(stateFileForProject(projectA), stateFileForProject(projectB));

  await updateWidgetHistory(projectA, { openRequests: 2 });
  const historyB = await updateWidgetHistory(projectB, { openRequests: 9 });
  const historyA = await updateWidgetHistory(projectA, { openRequests: 3 });

  assert.equal(historyB.previous, null);
  assert.deepEqual(historyA.previous, { openRequests: 2 });
  assert.deepEqual(historyA.current, { openRequests: 3 });
  assert.equal(historyA.snapshots.length, 2);
});

test("does not reuse a state file recorded for another project", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-history-root-"));
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  context.after(async () => {
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });

  const project = path.join(stateRoot, "project");
  const stateFile = stateFileForProject(project);
  await fs.writeFile(stateFile, JSON.stringify({
    projectRoot: path.join(stateRoot, "different-project"),
    snapshots: [{ at: "2026-01-01T00:00:00.000Z", values: { openRequests: 99 } }],
  }));

  const history = await updateWidgetHistory(project, { openRequests: 1 });
  assert.equal(history.previous, null);
  assert.equal(history.snapshots.length, 1);
  assert.deepEqual(history.current, { openRequests: 1 });
});

test("recovers from a corrupt derived history file", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-history-corrupt-"));
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  context.after(async () => {
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });

  const project = path.join(stateRoot, "project");
  await fs.writeFile(stateFileForProject(project), "not valid JSON");

  const history = await updateWidgetHistory(project, { openRequests: 4 });
  assert.equal(history.previous, null);
  assert.equal(history.snapshots.length, 1);
  assert.deepEqual(history.current, { openRequests: 4 });
});

test("does not rewrite metric history when values are unchanged", async (context) => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wmv-history-stable-"));
  process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR = stateRoot;
  context.after(async () => {
    delete process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR;
    await fs.rm(stateRoot, { recursive: true, force: true });
  });

  const project = path.join(stateRoot, "project");
  const stateFile = stateFileForProject(project);
  await updateWidgetHistory(project, { openRequests: 4 });
  const before = await fs.stat(stateFile);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await updateWidgetHistory(project, { openRequests: 4 });
  const after = await fs.stat(stateFile);

  assert.equal(after.mtimeMs, before.mtimeMs);
});
