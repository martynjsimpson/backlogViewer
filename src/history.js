const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

function stateDirectory() {
  if (process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR) return path.resolve(process.env.WORK_MANAGEMENT_VIEWER_STATE_DIR);
  if (process.env.XDG_STATE_HOME) return path.join(process.env.XDG_STATE_HOME, "work-management-viewer");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "work-management-viewer");
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, "work-management-viewer");
  return path.join(os.homedir(), ".local", "state", "work-management-viewer");
}

function stateFileForProject(projectRoot) {
  const key = crypto.createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 16);
  return path.join(stateDirectory(), `${key}.json`);
}

function valuesEqual(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

async function updateWidgetHistory(projectRoot, widgets) {
  const stateFile = stateFileForProject(projectRoot);
  let existing = { snapshots: [] };
  try {
    existing = JSON.parse(await fs.readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const snapshots = Array.isArray(existing.snapshots) ? existing.snapshots : [];
  const previous = snapshots.at(-1) || null;
  if (!previous || !valuesEqual(previous.values || {}, widgets)) {
    snapshots.push({ at: new Date().toISOString(), values: widgets });
  }
  const next = { projectRoot: path.resolve(projectRoot), snapshots: snapshots.slice(-180) };
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    state_file: stateFile,
    snapshots: next.snapshots,
    current: widgets,
    previous: next.snapshots.length > 1 ? next.snapshots.at(-2).values : null,
    updated_at: next.snapshots.at(-1)?.at || null,
  };
}

module.exports = { stateFileForProject, updateWidgetHistory };
