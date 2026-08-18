const fs = require("fs/promises");
const path = require("path");
const YAML = require("yaml");
const { CURRENT_MODEL_VERSION, SUPPORTED_MODEL_VERSIONS } = require("./constants");

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
    // `.git` is a file in linked worktrees and some submodule checkouts.
    if (await exists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function inferredProjectRoot(manifestFile) {
  const normalized = manifestFile.split(path.sep).join("/");
  return normalized.endsWith("/docs/work/project.yml") || normalized.endsWith("/.claude/work/project.yml")
    ? path.dirname(path.dirname(path.dirname(manifestFile)))
    : path.dirname(manifestFile);
}

async function discoverManifest(projectInput = process.cwd()) {
  const { directory: startDirectory, explicitManifest } = await resolveStart(projectInput);
  const repositoryRoot = await findRepositoryRoot(startDirectory);

  if (explicitManifest) {
    // Keep the manifest-derived location as a fallback for projects without a
    // discoverable VCS root. The manifest's scope block remains authoritative.
    return {
      manifestFile: explicitManifest,
      projectRoot: inferredProjectRoot(explicitManifest),
      repositoryRoot,
    };
  }

  let current = startDirectory;
  while (true) {
    for (const candidate of await discoveryCandidates(current)) {
      if (await exists(candidate)) {
        return { manifestFile: candidate, projectRoot: current, repositoryRoot };
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

function hasValue(object, dottedPath) {
  const parts = dottedPath.split(".");
  const key = parts.pop();
  const parent = parts.reduce((value, part) => value?.[part], object);
  return parent != null && Object.prototype.hasOwnProperty.call(parent, key);
}

function validateManifestShape(manifest, modelVersion = manifest?.model_version) {
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
  if (modelVersion >= 4) {
    for (const field of ["scope.root", "scope.writes_outside", "scope.agents_dir", "version.tag_template"]) {
      if (!hasValue(manifest, field)) missing.push(field);
    }
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
  if (!SUPPORTED_MODEL_VERSIONS.includes(declaredVersion)) {
    if (declaredVersion == null || declaredVersion < SUPPORTED_MODEL_VERSIONS[0]) {
      throw new ConfigurationError(
        `This manifest uses schema version ${declaredVersion ?? "none"}; this viewer supports versions ${SUPPORTED_MODEL_VERSIONS.join(" and ")}. Run /work-init --upgrade to update it.`,
        "UNSUPPORTED_MODEL_VERSION",
      );
    }
    throw new ConfigurationError(
      `This manifest uses schema version ${declaredVersion}, which this viewer does not support (current: ${CURRENT_MODEL_VERSION}). Update the viewer before continuing.`,
      "UNSUPPORTED_MODEL_VERSION",
    );
  }

  const shapeErrors = validateManifestShape(manifest, declaredVersion);
  if (shapeErrors.length) {
    throw new ConfigurationError(
      `Manifest declares model_version ${declaredVersion} but does not match that schema.`,
      "INVALID_MANIFEST_SHAPE",
      shapeErrors,
    );
  }

  const declaredScopeRoot = declaredVersion >= 4 ? manifest.scope.root : null;
  // A project that explicitly opts out of VCS has no repository boundary to
  // inherit, even when its files happen to sit inside another checkout (as
  // self-contained fixtures and copied work directories often do).
  let root = manifest.vcs.system === "git" && discovered.repositoryRoot
    ? discovered.repositoryRoot
    : discovered.projectRoot;
  if (declaredScopeRoot != null) {
    if (!discovered.repositoryRoot) {
      throw new ConfigurationError(
        "Manifest declares scope.root, but no Git repository root could be found.",
        "INVALID_SCOPE_ROOT",
      );
    }
    if (typeof declaredScopeRoot !== "string" || !declaredScopeRoot || path.isAbsolute(declaredScopeRoot)) {
      throw new ConfigurationError(
        "scope.root must be a non-empty path relative to the Git repository root, or null.",
        "INVALID_SCOPE_ROOT",
      );
    }
    root = path.resolve(discovered.repositoryRoot, declaredScopeRoot);
    if (root !== discovered.repositoryRoot && !root.startsWith(`${discovered.repositoryRoot}${path.sep}`)) {
      throw new ConfigurationError(
        "scope.root must stay inside the Git repository root.",
        "INVALID_SCOPE_ROOT",
      );
    }
  }
  const vcsRoot = discovered.repositoryRoot || root;
  const resolveProjectPath = (value) => {
    if (value == null) return null;
    const declaredPath = String(value);
    return declaredVersion >= 4 && declaredPath.startsWith("/")
      ? path.resolve(vcsRoot, declaredPath.replace(/^\/+/, ""))
      : path.resolve(root, declaredPath);
  };
  const workDir = resolveProjectPath(manifest.paths.work);
  const requestPrefix = String(manifest.ids.request_prefix).toUpperCase();
  const workPrefix = String(manifest.ids.work_prefix).toUpperCase();
  return {
    manifest,
    manifestFile: discovered.manifestFile,
    root,
    vcsRoot,
    resolveProjectPath,
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
