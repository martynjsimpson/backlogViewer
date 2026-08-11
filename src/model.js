const fs = require("fs/promises");
const path = require("path");
const {
  RELEASE_STATUSES,
  REQUEST_SECTIONS,
  REQUEST_STATUSES,
  SUPPORTED_BACKLOG_MODEL_VERSION,
  WORK_STATUSES,
} = require("./constants");
const { exists } = require("./config");

function countBy(items, property) {
  return items.reduce((counts, item) => {
    const value = item[property] || "unspecified";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function completionLabels(values) {
  return (values || []).map((entry) => entry.raw || entry.value || String(entry));
}

function linkModel(requests, backlog) {
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const backlogById = new Map(backlog.map((item) => [item.id, item]));
  const inferredByRequest = new Map();

  for (const item of backlog) {
    const sourceIds = Array.isArray(item.source_request) ? item.source_request : [item.source_request];
    item.source_requests = sourceIds.filter(Boolean).map((source) => String(source).toUpperCase());
    item.has_request = item.source_requests.some((source) => requestsById.has(source));
    for (const source of item.source_requests) {
      if (!inferredByRequest.has(source)) inferredByRequest.set(source, []);
      inferredByRequest.get(source).push(item.id);
    }
    item.done_in_labels = completionLabels(item.done_in);
  }

  for (const request of requests) {
    const declared = request.work_items || [];
    const inferred = inferredByRequest.get(request.id) || [];
    request.backlog_items = [...new Set([...declared, ...inferred])].sort();
    request.resolved_backlog_items = request.backlog_items.filter((id) => backlogById.has(id));
    request.unresolved_work_items = declared.filter((id) => !backlogById.has(id));
    request.done_in_labels = completionLabels(request.done_in);
  }

  return { requests, backlog, requestsById, backlogById };
}

function calculateWidgets(requests, backlog, activeRelease, health) {
  const openStatuses = new Set(["needs-refinement", "refined", "partially-done", "blocked"]);
  const excludedFromUnlinked = new Set(["duplicate", "rejected"]);
  return {
    inboxRequests: requests.filter((request) => request.status === "inbox").length,
    activeReleaseRequests: activeRelease.request_ids.length,
    openRequests: requests.filter((request) => openStatuses.has(request.status)).length,
    unlinkedRequests: requests.filter((request) => (
      !excludedFromUnlinked.has(request.status)
      && !request.resolved_backlog_items.length
      && !request.work_items_explicitly_none
    )).length,
    backlogItems: backlog.filter((item) => item.status !== "done").length,
    backlogComplete: backlog.filter((item) => item.status === "done").length,
    healthErrors: health.summary.errors,
    healthWarnings: health.summary.warnings,
  };
}

function finding(severity, code, title, message, entity = {}) {
  return { severity, code, title, message, ...entity };
}

function validVersion(value, scheme) {
  if (scheme === "none") return false;
  if (scheme === "date") return /^\d{4}\.\d{2}\.\d{2}$/.test(value);
  if (scheme === "semver") return /^\d+\.\d+\.\d+$/.test(value);
  return /^v\d+\.\d+\.\d+$/.test(value);
}

function validateCompletion(findings, owner, kind, values, scheme, ids) {
  for (const completion of values || []) {
    if (completion.kind === "spike") {
      if (!ids.workPattern.test(completion.value)) {
        findings.push(finding("error", "INVALID_SPIKE_MARKER", "Invalid spike completion marker", completion.raw, owner));
      }
      continue;
    }
    if (completion.kind !== "release" || !validVersion(completion.value, scheme)) {
      findings.push(finding("warning", "INVALID_COMPLETION_VALUE", "Completion value is not a release or spike marker", completion.raw, owner));
    } else if (completion.annotation) {
      findings.push(finding("warning", "ANNOTATED_COMPLETION_VALUE", "Completion metadata contains legacy annotation text", completion.raw, owner));
    }
  }
}

function hasExpectedPadding(id, prefix, pad) {
  const match = String(id).match(new RegExp(`^${prefix}-(\\d+)[A-Z]?$`, "i"));
  return Boolean(match && match[1].length === Number(pad));
}

function pathHasGlob(value) {
  return /[*?\[]/.test(String(value));
}

function globToRegex(pattern) {
  let source = String(pattern).replace(/\\/g, "/").replace(/[.+^${}()|]/g, "\\$&");
  source = source.replace(/\*\*/g, "§§DOUBLE§§").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  source = source.replace(/§§DOUBLE§§/g, ".*");
  return new RegExp(`^${source}(?:/.*)?$`);
}

function pathRuleMatches(rule, relativePath) {
  const normalizedRule = String(rule).replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (!pathHasGlob(normalizedRule)) return normalizedPath === normalizedRule || normalizedPath.startsWith(`${normalizedRule}/`);
  return globToRegex(normalizedRule).test(normalizedPath);
}

async function listProjectFiles(root, limit = 10000) {
  const files = [];
  async function walk(directory, prefix = "") {
    if (files.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ([".git", "node_modules", "workManagementClaudePlugin"].includes(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
      else files.push(relative);
      if (files.length >= limit) return;
    }
  }
  await walk(root);
  return files;
}

async function validatePathsAndOwnership(findings, config) {
  const agents = config.manifest.agents || [];
  const allRules = agents.flatMap((agent) => [
    ...(agent.owns || []).map((rule) => ({ agent: agent.name, kind: "owns", rule })),
    ...(agent.excludes || []).map((rule) => ({ agent: agent.name, kind: "excludes", rule })),
    ...(agent.reads || []).map((rule) => ({ agent: agent.name, kind: "reads", rule })),
  ]);

  for (const entry of allRules.filter((entry) => !pathHasGlob(entry.rule))) {
    if (!(await exists(path.resolve(config.root, entry.rule)))) {
      findings.push(finding(
        "warning",
        "MISSING_AGENT_PATH",
        "Agent path does not exist",
        `${entry.agent} ${entry.kind} ${entry.rule}`,
        { entity_type: "agent", entity_id: entry.agent },
      ));
    }
  }

  const files = await listProjectFiles(config.root);
  for (const file of files) {
    const owners = agents.filter((agent) => (
      (agent.owns || []).some((rule) => pathRuleMatches(rule, file))
      && !(agent.excludes || []).some((rule) => pathRuleMatches(rule, file))
    )).map((agent) => agent.name);
    if (owners.length > 1) {
      findings.push(finding("error", "OWNERSHIP_OVERLAP", "Agent ownership overlaps", `${file}: ${owners.join(", ")}`, { entity_type: "path", entity_id: file }));
    }
  }
}

function compareRequestSections(findings, metadata) {
  const actual = metadata.sections.map((section) => section.title);
  if (actual.length !== REQUEST_SECTIONS.length || REQUEST_SECTIONS.some((section, index) => actual[index] !== section)) {
    findings.push(finding(
      "warning",
      "REQUEST_SECTION_STRUCTURE",
      "requests.md does not use the four canonical sections in order",
      `Expected: ${REQUEST_SECTIONS.join(" → ")}. Found: ${actual.join(" → ") || "none"}.`,
      { entity_type: "file", entity_id: "requests.md" },
    ));
  }
}

function releaseNumbers(values) {
  return values.flatMap((valuesForItem) => valuesForItem || [])
    .filter((entry) => entry.kind === "release")
    .map((entry) => entry.value)
    .filter(Boolean);
}

function semverTuple(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = semverTuple(left);
  const b = semverTuple(right);
  if (!a || !b) return String(right).localeCompare(String(left));
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
  return 0;
}

async function buildHealth({ config, requestDocument, backlogDocument, activeRelease, requests, backlog, requestsById, backlogById }) {
  const findings = [];
  const manifest = config.manifest;
  const requestTypes = new Set(manifest.taxonomy.request_types || []);
  const workTypes = new Set(manifest.taxonomy.work_types || []);
  const priorities = new Set(manifest.taxonomy.priorities || []);
  const agentNames = new Set((manifest.agents || []).map((agent) => agent.name));
  const inactiveAgentNames = new Set((manifest.inactive_agents || []).map((agent) => agent.name));

  compareRequestSections(findings, requestDocument.metadata);
  if (backlogDocument.modelVersion !== SUPPORTED_BACKLOG_MODEL_VERSION) {
    findings.push(finding("error", "BACKLOG_MODEL_VERSION", "Unsupported backlog model version", `Expected ${SUPPORTED_BACKLOG_MODEL_VERSION}; found ${backlogDocument.modelVersion ?? "none"}.`, { entity_type: "file", entity_id: "backlog.yml" }));
  }

  for (const request of requests) {
    const owner = { entity_type: "request", entity_id: request.id };
    if (!hasExpectedPadding(request.id, config.ids.requestPrefix, config.ids.pad)) findings.push(finding("warning", "REQUEST_ID_FORMAT", "Request ID does not match the manifest padding", `Expected ${config.ids.requestPrefix}-${"0".repeat(config.ids.pad - 1)}1; found ${request.id}.`, owner));
    if (!REQUEST_STATUSES.includes(request.status)) findings.push(finding("error", "INVALID_REQUEST_STATUS", "Invalid request status", request.status || "missing", owner));
    if (!requestTypes.has(request.type)) findings.push(finding("error", "INVALID_REQUEST_TYPE", "Request type is outside the manifest taxonomy", request.type || "missing", owner));
    if (!priorities.has(request.priority)) findings.push(finding("error", "INVALID_PRIORITY", "Request priority is outside the manifest taxonomy", request.priority || "missing", owner));
    if (request.request_id && request.request_id.toUpperCase() !== request.id) findings.push(finding("error", "REQUEST_ID_MISMATCH", "Request heading and Request ID disagree", `${request.id} / ${request.request_id}`, owner));
    for (const unknown of request.unknown_fields || []) findings.push(finding("warning", "UNKNOWN_REQUEST_FIELD", `Unknown request field: ${unknown.name}`, `Line ${unknown.line}: ${unknown.value}`, owner));
    if (request.status === "blocked" && !request.blocked_on) findings.push(finding("error", "BLOCKED_WITHOUT_REASON", "Blocked request is missing Blocked on", "Add the named dependency.", owner));
    if (request.status === "deferred" && request.blocked_on) findings.push(finding("error", "DEFERRED_WITH_BLOCKER", "Deferred request carries Blocked on", request.blocked_on, owner));
    if (["done", "partially-done"].includes(request.status) && !(request.done_in || []).length) findings.push(finding("error", "COMPLETION_MISSING", "Completed request is missing Done in", request.status, owner));
    if (request.status === "partially-done" && !request.notes) findings.push(finding("error", "PARTIAL_WITHOUT_NOTES", "Partially done request is missing remaining-scope notes", "Add Notes describing what remains.", owner));
    validateCompletion(findings, owner, "request", request.done_in, manifest.version.scheme, config.ids);
    for (const id of request.unresolved_work_items || []) findings.push(finding("error", "MISSING_WORK_ITEM", "Work items reference does not resolve", id, owner));
  }

  for (const item of backlog) {
    const owner = { entity_type: "work", entity_id: item.id };
    if (!hasExpectedPadding(item.id, config.ids.workPrefix, config.ids.pad)) findings.push(finding("warning", "WORK_ID_FORMAT", "Work-item ID does not match the manifest padding", `Expected ${config.ids.workPrefix}-${"0".repeat(config.ids.pad - 1)}1; found ${item.id}.`, owner));
    if (!WORK_STATUSES.includes(item.status)) findings.push(finding("error", "INVALID_WORK_STATUS", "Invalid work-item status", item.status || "missing", owner));
    if (!workTypes.has(item.type)) findings.push(finding("error", "INVALID_WORK_TYPE", "Work-item type is outside the manifest taxonomy", item.type || "missing", owner));
    if (!priorities.has(item.priority)) findings.push(finding("error", "INVALID_PRIORITY", "Work-item priority is outside the manifest taxonomy", item.priority || "missing", owner));
    if (item.source_request && !requestsById.has(item.source_request)) findings.push(finding("error", "MISSING_SOURCE_REQUEST", "Work item source request does not resolve", item.source_request, owner));
    if (item.status === "blocked" && !item.blocked_on) findings.push(finding("error", "BLOCKED_WITHOUT_REASON", "Blocked work item is missing blocked_on", "Add the named dependency.", owner));
    if (item.status === "deferred" && item.blocked_on) findings.push(finding("error", "DEFERRED_WITH_BLOCKER", "Deferred work item carries blocked_on", item.blocked_on, owner));
    if (item.status === "done" && !(item.done_in || []).length) findings.push(finding("error", "COMPLETION_MISSING", "Done work item is missing done_in", "Add its release or spike marker.", owner));
    validateCompletion(findings, owner, "work", item.done_in, manifest.version.scheme, config.ids);
    for (const dependency of item.dependencies || []) if (!backlogById.has(dependency)) findings.push(finding("error", "MISSING_DEPENDENCY", "Work-item dependency does not resolve", dependency, owner));
    for (const agent of item.suggested_agents || []) {
      if (!agentNames.has(agent) || inactiveAgentNames.has(agent)) findings.push(finding("error", "INVALID_SUGGESTED_AGENT", "Suggested agent is unavailable", agent, owner));
    }
    for (const completion of item.done_in || []) {
      if (completion.kind !== "spike") continue;
      const spikeFile = path.join(config.files.spikes, `${completion.value}.md`);
      if (!(await exists(spikeFile))) {
        findings.push(finding("error", "MISSING_SPIKE_DOCUMENT", "Spike completion document is missing", spikeFile, owner));
      } else {
        const spike = await fs.readFile(spikeFile, "utf8");
        if (!/^## Findings\s*$/m.test(spike) || !/^## Recommendations\s*$/m.test(spike)) findings.push(finding("error", "INCOMPLETE_SPIKE_DOCUMENT", "Spike document lacks required sections", spikeFile, owner));
      }
    }
  }

  if (!RELEASE_STATUSES.includes(activeRelease.status)) findings.push(finding("error", "INVALID_RELEASE_STATUS", "Invalid active-release status", activeRelease.status || "missing", { entity_type: "release", entity_id: activeRelease.status || "unknown" }));
  for (const selected of activeRelease.work_items) {
    const live = backlogById.get(selected.id);
    if (!live) {
      findings.push(finding("error", "MISSING_RELEASE_ITEM", "Active-release item does not exist in backlog", selected.id, { entity_type: "release", entity_id: selected.id }));
      continue;
    }
    selected.live_status = live.status;
    selected.live_item = live;
    if (selected.status && selected.status !== live.status) findings.push(finding("warning", "RELEASE_STATUS_DRIFT", "Active-release item status differs from backlog", `${selected.id}: release says ${selected.status}; backlog says ${live.status}.`, { entity_type: "work", entity_id: selected.id }));
    if (selected.source && live.source_request && selected.source !== live.source_request) findings.push(finding("error", "RELEASE_SOURCE_DRIFT", "Active-release source differs from backlog", `${selected.id}: ${selected.source} / ${live.source_request}`, { entity_type: "work", entity_id: selected.id }));
  }

  if (manifest.vcs.system === "git" && !(await exists(path.join(config.root, ".git")))) findings.push(finding("warning", "VCS_MISMATCH", "Manifest declares Git but no repository metadata is present", config.root, { entity_type: "manifest", entity_id: "vcs.system" }));
  if (manifest.vcs.system === "none" && !manifest.version.file) findings.push(finding("error", "VERSION_FILE_REQUIRED", "A non-Git project requires version.file", "There is no tag to hold the version.", { entity_type: "manifest", entity_id: "version.file" }));
  if (config.files.changelog && !(await exists(config.files.changelog))) findings.push(finding("warning", "MISSING_CHANGELOG", "Configured changelog does not exist", config.files.changelog, { entity_type: "manifest", entity_id: "paths.changelog" }));
  await validatePathsAndOwnership(findings, config);

  const releases = [...new Set(releaseNumbers([...requests.map((request) => request.done_in), ...backlog.map((item) => item.done_in)]))].sort(compareVersions);
  const recent = new Set(releases.slice(0, 3));
  const oldDone = [...requests, ...backlog].filter((item) => item.status === "done" && (item.done_in || []).some((entry) => entry.kind === "release" && !recent.has(entry.value)));
  if (oldDone.length > 25) findings.push(finding("warning", "PRUNING_HYGIENE", "Completed history appears ready for pruning", `${oldDone.length} done records are older than the three most recent releases. Consider /work-prune.`, { entity_type: "project", entity_id: manifest.project.name }));

  findings.sort((left, right) => (left.severity === right.severity ? left.code.localeCompare(right.code) : left.severity === "error" ? -1 : 1));
  return {
    findings,
    summary: {
      errors: findings.filter((entry) => entry.severity === "error").length,
      warnings: findings.filter((entry) => entry.severity === "warning").length,
      total: findings.length,
    },
  };
}

function createSummaries(requests, backlog) {
  return {
    requests: {
      total: requests.length,
      by_status: countBy(requests, "status"),
      by_type: countBy(requests, "type"),
      by_priority: countBy(requests, "priority"),
    },
    backlog: {
      total: backlog.length,
      by_status: countBy(backlog, "status"),
      by_type: countBy(backlog, "type"),
      by_priority: countBy(backlog, "priority"),
      by_capability: countBy(backlog, "capability"),
    },
  };
}

module.exports = {
  buildHealth,
  calculateWidgets,
  compareVersions,
  createSummaries,
  linkModel,
};
