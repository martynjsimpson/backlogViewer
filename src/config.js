const fs = require("fs/promises");
const path = require("path");
const YAML = require("yaml");
const { SUPPORTED_MODEL_VERSION } = require("./constants");

class ConfigurationError extends Error {
  constructor(message, code = "CONFIGURATION_ERROR", details = []) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
    this.details = details;
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function discoveryCandidates(directory) {
  const conventional = [
    path.join(directory, "docs", "work", "project.yml"),
    path.join(directory, ".claude", "work", "project.yml"),
  ];
  const adjacent = path.join(directory, "project.yml");
  if (
    await exists(adjacent)
    && await exists(path.join(directory, "requests.md"))
    && await exists(path.join(directory, "backlog.yml"))
  ) {
    conventional.push(adjacent);
  }
  return conventional;
}

async function resolveStart(input = process.cwd()) {
  const resolved = path.resolve(process.cwd(), input);
  if (!(await exists(resolved))) {
    throw new ConfigurationError(`Project path does not exist: ${resolved}`, "PROJECT_NOT_FOUND");
  }
  if (await isDirectory(resolved)) return { directory: resolved, explicitManifest: null };
  if (path.basename(resolved) !== "project.yml") {
    throw new ConfigurationError(`Expected a project directory or project.yml: ${resolved}`, "INVALID_PROJECT_PATH");
  }
  return { directory: path.dirname(resolved), explicitManifest: resolved };
}

async function findRepositoryRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  while (true) {
    if (await isDirectory(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function discoverManifest(projectInput = process.cwd()) {
  const { directory: startDirectory, explicitManifest } = await resolveStart(projectInput);
  const repositoryRoot = await findRepositoryRoot(startDirectory);

  if (explicitManifest) {
    const normalized = explicitManifest.split(path.sep).join("/");
    const conventionalRoot = normalized.endsWith("/docs/work/project.yml") || normalized.endsWith("/.claude/work/project.yml")
      ? path.dirname(path.dirname(path.dirname(explicitManifest)))
      : startDirectory;
    // An explicitly selected manifest defines its own project boundary. This is
    // important when inspecting a project nested inside another Git checkout
    // (including this repository's self-contained test fixtures).
    return { manifestFile: explicitManifest, repositoryRoot: conventionalRoot };
  }

  let current = startDirectory;
  while (true) {
    for (const candidate of await discoveryCandidates(current)) {
      if (await exists(candidate)) {
        const adjacent = candidate === path.join(current, "project.yml");
        return { manifestFile: candidate, repositoryRoot: repositoryRoot || (adjacent ? startDirectory : current) };
      }
    }

    if (repositoryRoot && current === repositoryRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new ConfigurationError(
    "No work-management manifest found. Run /work-init to set this project up.",
    "MANIFEST_NOT_FOUND",
  );
}

function getValue(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function validateManifestShape(manifest) {
  const required = [
    "project.name",
    "project.description",
    "project.primary_reference",
    "paths.work",
    "paths.spikes",
    "ids.request_prefix",
    "ids.work_prefix",
    "ids.pad",
    "taxonomy.request_types",
    "taxonomy.work_types",
    "taxonomy.priorities",
    "vcs.system",
    "version.scheme",
    "version.owner",
    "release.changelog",
    "release.deploy_steps",
  ];
  const missing = required.filter((field) => {
    const value = getValue(manifest, field);
    return value == null || value === "";
  });

  if (!Object.prototype.hasOwnProperty.call(manifest.testing || {}, "policy_document")) {
    missing.push("testing.policy_document");
  }
  if (!Object.prototype.hasOwnProperty.call(manifest.release || {}, "pipeline")) {
    missing.push("release.pipeline");
  }
  for (const [index, agent] of (manifest.agents || []).entries()) {
    if (!Object.prototype.hasOwnProperty.call(agent, "excludes")) missing.push(`agents[${index}].excludes`);
  }

  const staleReleaseKeys = ["version_scheme", "version_owner", "version_file", "version_mirrors", "git_owner", "branching"]
    .filter((key) => Object.prototype.hasOwnProperty.call(manifest.release || {}, key));
  if (staleReleaseKeys.length) {
    missing.push(...staleReleaseKeys.map((key) => `release.${key} must move to the current version/vcs blocks`));
  }
  return missing;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadProjectConfiguration(projectInput = process.cwd()) {
  const discovered = await discoverManifest(projectInput);
  let manifest;
  try {
    manifest = YAML.parse(await fs.readFile(discovered.manifestFile, "utf8"));
  } catch (error) {
    throw new ConfigurationError(`Cannot parse ${discovered.manifestFile}: ${error.message}`, "INVALID_MANIFEST");
  }

  const declaredVersion = manifest?.model_version;
  if (declaredVersion !== SUPPORTED_MODEL_VERSION) {
    if (declaredVersion == null || declaredVersion < SUPPORTED_MODEL_VERSION) {
      throw new ConfigurationError(
        `This manifest uses schema version ${declaredVersion ?? "none"}; this viewer needs version ${SUPPORTED_MODEL_VERSION}. Run /work-init --upgrade to update it.`,
        "UNSUPPORTED_MODEL_VERSION",
      );
    }
    throw new ConfigurationError(
      `This manifest uses schema version ${declaredVersion}, which is newer than this viewer supports (${SUPPORTED_MODEL_VERSION}). Update the viewer before continuing.`,
      "UNSUPPORTED_MODEL_VERSION",
    );
  }

  const shapeErrors = validateManifestShape(manifest);
  if (shapeErrors.length) {
    throw new ConfigurationError(
      `Manifest declares model_version ${SUPPORTED_MODEL_VERSION} but does not match that schema.`,
      "INVALID_MANIFEST_SHAPE",
      shapeErrors,
    );
  }

  const root = discovered.repositoryRoot;
  const resolveProjectPath = (value) => value == null ? null : path.resolve(root, value);
  const workDir = resolveProjectPath(manifest.paths.work);
  const requestPrefix = String(manifest.ids.request_prefix).toUpperCase();
  const workPrefix = String(manifest.ids.work_prefix).toUpperCase();
  return {
    manifest,
    manifestFile: discovered.manifestFile,
    root,
    workDir,
    files: {
      manifest: discovered.manifestFile,
      requests: path.join(workDir, "requests.md"),
      backlog: path.join(workDir, "backlog.yml"),
      activeRelease: path.join(workDir, "active-release.md"),
      spikes: resolveProjectPath(manifest.paths.spikes),
      changelog: resolveProjectPath(manifest.paths.changelog),
    },
    ids: {
      requestPrefix,
      workPrefix,
      pad: Number(manifest.ids.pad),
      requestPattern: new RegExp(`^${escapeRegex(requestPrefix)}-\\d+$`, "i"),
      workPattern: new RegExp(`^${escapeRegex(workPrefix)}-\\d+[A-Z]?$`, "i"),
      requestGlobalPattern: new RegExp(`\\b${escapeRegex(requestPrefix)}-\\d+\\b`, "gi"),
      workGlobalPattern: new RegExp(`\\b${escapeRegex(workPrefix)}-\\d+[A-Z]?\\b`, "gi"),
    },
  };
}

module.exports = {
  ConfigurationError,
  discoverManifest,
  exists,
  findRepositoryRoot,
  loadProjectConfiguration,
  validateManifestShape,
};
