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
    const hasSourceRequest = item.source_requests.length > 0;
    const hasSourceRelease = Boolean(item.source_release);
    item.source_kind = hasSourceRequest && hasSourceRelease
      ? "conflicting"
      : hasSourceRequest
        ? item.has_request ? "request" : "missing_request"
        : hasSourceRelease ? "release" : "legacy";
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

const FINDING_GUIDANCE = {
  ANNOTATED_COMPLETION_VALUE: ({ message, entity }) => ({
    action_type: "fix",
    meaning: "The release version was recognised, but the parenthesised note is legacy text in a machine-readable completion field. Commands may discard or misinterpret that note.",
    recommended_action: `In ${entity.entity_id}, replace "${message}" with only the release version. Move the parenthesised explanation to ${entity.entity_type === "request" ? "Notes:" : "remaining:"} if it still matters.`,
  }),
  INVALID_COMPLETION_VALUE: ({ message, entity }) => ({
    action_type: "fix",
    meaning: "Completion fields accept only a release version or SPIKE: <work-item ID>. This free text cannot be linked to durable delivery evidence or safely processed by pruning.",
    recommended_action: `In ${entity.entity_id}, replace "${message}" with the actual release version, or SPIKE: <work-item ID> when a spike document is the deliverable. If neither exists, move the prose to ${entity.entity_type === "request" ? "Notes:" : "remaining:"} and review whether the item should be marked done.`,
  }),
  NON_SCALAR_COMPLETION_VALUE: ({ entity }) => ({
    action_type: "fix",
    meaning: "This YAML completion entry is an object rather than a string, usually because a SPIKE: marker was not quoted. The file parses, but the value cannot be interpreted as release evidence.",
    recommended_action: `In ${entity.entity_id}, quote the whole marker, for example "SPIKE: ${entity.entity_id}", so done_in contains a string rather than a YAML mapping.`,
  }),
  CONFLICTING_WORK_PROVENANCE: ({ entity }) => ({
    action_type: "fix",
    meaning: "A work item must trace either to a human request or to the release that discovered it, never both.",
    recommended_action: `In ${entity.entity_id}, keep the provenance that represents the item's actual origin and set the other of source_request / source_release to null.`,
  }),
  MISSING_WORK_PROVENANCE: ({ entity }) => ({
    action_type: "maintenance",
    meaning: "This work item predates the source_release field and has no recorded provenance. It remains valid legacy data, but its origin is not auditable.",
    recommended_action: `Backfill ${entity.entity_id} from its evidence or delivery history when the item is next touched. Do not block current work or sweep the backlog solely for this warning.`,
  }),
  INVALID_SOURCE_RELEASE: ({ entity }) => ({
    action_type: "fix",
    meaning: "source_release must contain a release version using the version scheme declared in project.yml.",
    recommended_action: `In ${entity.entity_id}, replace source_release with the release version that actually surfaced the work. If a person requested it, set source_release to null and use source_request instead.`,
  }),
  UNNUMBERED_SPIKE_RECOMMENDATIONS: ({ entity }) => ({
    action_type: "maintenance",
    meaning: "Spike recommendations now use a consecutive R1, R2, … sequence so close-out can account for every recommendation without losing one in prose.",
    recommended_action: `When ${entity.entity_id} is next triaged, number each recommendation consecutively from R1 and keep those identifiers stable for evidence references.`,
  }),
  MISSING_AGENT_PATH: ({ entity }) => ({
    action_type: "review",
    meaning: "An exact path in this agent's owns, excludes, or reads rules does not exist in the project. The rule may be stale, misspelled, or describe a directory that has not been created yet.",
    recommended_action: `Review ${entity.entity_id} in project.yml. Correct or remove the stale path, or create the intended directory, then regenerate the agent roster.`,
    command: "/work-init --repair",
  }),
  REQUEST_SECTION_STRUCTURE: () => ({
    action_type: "fix",
    meaning: "The current model uses exactly four request sections. Extra legacy sections make status-based automation unreliable because section placement carries meaning.",
    recommended_action: "In requests.md, keep the four canonical sections in the displayed order. Move partially-done and blocked requests into Refined requests; move deferred, rejected, and duplicate requests into Deferred / rejected; then remove the legacy headings.",
  }),
  REQUEST_ID_FORMAT: ({ entity }) => ({
    action_type: "review",
    meaning: "The request ID does not use the prefix or zero-padding declared by project.yml. Pattern matching and cross-references may miss it.",
    recommended_action: `If ${entity.entity_id} is still live, rename it and every reference to it together so it matches the manifest format. If it is old completed history, consider pruning it instead of rewriting historical IDs.`,
    command: "/work-prune",
  }),
  WORK_ID_FORMAT: ({ entity }) => ({
    action_type: "review",
    meaning: "The work-item ID does not use the prefix or zero-padding declared by project.yml. Pattern matching and cross-references may miss it.",
    recommended_action: `If ${entity.entity_id} is still live, rename it and every request, dependency, release, and spike-document reference together. If it is old completed history, consider pruning it instead.`,
    command: "/work-prune",
  }),
  UNKNOWN_REQUEST_FIELD: ({ title, entity }) => {
    const field = title.replace(/^(?:Move\s+)?(?:Unknown|Unsupported) request field:\s*/i, "");
    const normalised = field.toLowerCase();
    let action = `Move the value on ${entity.entity_id} into a supported field such as Notes: or Summary:, then remove the unsupported ${field}: line.`;
    if (normalised === "note") action = `Rename Note: to Notes: on ${entity.entity_id}.`;
    if (normalised === "remaining") action = `Move the Remaining: text into Notes: on ${entity.entity_id}, then remove the Remaining: line. Partially-done requests record remaining scope in Notes:.`;
    return {
      action_type: "fix",
      meaning: `Requests do not define a ${field}: field, so the plugin cannot treat this value as structured metadata and may not preserve it during automation.`,
      recommended_action: action,
    };
  },
  RELEASE_STATUS_DRIFT: ({ entity }) => ({
    action_type: "fix",
    meaning: "The active-release snapshot and backlog disagree about this work item's status, so the release view may report stale progress.",
    recommended_action: `Check ${entity.entity_id} in backlog.yml, then update the matching active-release.md row to the same status. If the backlog value is wrong, correct it first and keep both files aligned.`,
  }),
  VCS_MISMATCH: () => ({
    action_type: "review",
    meaning: "project.yml declares Git ownership rules, but the viewer could not find repository metadata at the resolved VCS root. Release commands cannot safely follow the declared VCS workflow.",
    recommended_action: "Confirm the viewer is pointed at the intended project inside the correct repository. If this project intentionally has no Git repository, change vcs.system in project.yml; otherwise initialise or restore the missing repository metadata.",
  }),
  MISSING_CHANGELOG: () => ({
    action_type: "fix",
    meaning: "The changelog path declared by project.yml does not exist, so releases and pruning have no durable narrative record to verify against.",
    recommended_action: "Create the configured changelog file, or correct paths.changelog in project.yml to the existing file before running release or prune commands.",
  }),
  VERSION_FILE_REQUIRED: () => ({
    action_type: "fix",
    meaning: "This release configuration does not create a version tag, so a file is required to hold the durable version of record.",
    recommended_action: "Set version.file in project.yml to the package, project, or VERSION file that stores the release number, then run /work-init --upgrade or validation again.",
  }),
  INVALID_VCS_STAGE_CONFIGURATION: () => ({
    action_type: "fix",
    meaning: "The per-stage release plan is internally inconsistent, so the plugin cannot execute or hand off the configured VCS workflow safely.",
    recommended_action: "Review vcs.stages in project.yml and correct the stages named below. Run /work-init --upgrade if this manifest was migrated from an older model.",
  }),
  PRUNING_HYGIENE: () => ({
    action_type: "maintenance",
    meaning: "Old completed records are still valid, but they are making the live work files larger and harder to scan. No immediate correctness fix is required.",
    recommended_action: "Run the prune command when convenient. It will present the eligible records and durable evidence for approval before removing anything.",
    command: "/work-prune",
  }),
};

function finding(severity, code, title, message, entity = {}) {
  const context = { severity, code, title, message, entity };
  const specific = FINDING_GUIDANCE[code]?.(context) || {};
  const fallback = severity === "error"
    ? {
      action_type: "required",
      meaning: "This value violates the current work-management model and may make commands or release state unreliable.",
      recommended_action: `Correct the value described below${entity.entity_id ? ` on ${entity.entity_id}` : ""} so it matches project.yml and the current plugin schema.`,
    }
    : severity === "recommendation"
      ? {
        action_type: "maintenance",
        meaning: "This is optional guidance that may improve the project or its work-management hygiene. It is not a correctness problem.",
        recommended_action: `Consider the suggestion described below${entity.entity_id ? ` for ${entity.entity_id}` : ""} when convenient.`,
      }
    : {
      action_type: "review",
      meaning: "This value differs from the current work-management model and may represent intentional legacy data or drift.",
      recommended_action: `Review the value described below${entity.entity_id ? ` on ${entity.entity_id}` : ""} and update it to the current schema if the difference is not intentional.`,
    };
  return { severity, code, title, ...fallback, ...specific, message, ...entity };
}

function validVersion(value, scheme) {
  if (scheme === "none") return false;
  if (scheme === "date") return /^\d{4}\.\d{2}\.\d{2}$/.test(value);
  if (scheme === "semver") return /^\d+\.\d+\.\d+$/.test(value);
  return /^v\d+\.\d+\.\d+$/.test(value);
}

function hasNumberedRecommendations(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Recommendations\s*$/.test(line));
  if (start < 0) return false;
  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line)) break;
    section.push(line);
  }
  const numbers = [...new Set([...section.join("\n").matchAll(/\bR(\d+)\b/gi)].map((match) => Number(match[1])))].sort((left, right) => left - right);
  return numbers.length > 0 && numbers.every((number, index) => number === index + 1);
}

function validateCompletion(findings, owner, kind, values, scheme, ids) {
  for (const completion of values || []) {
    if (completion.non_scalar) {
      findings.push(finding("error", "NON_SCALAR_COMPLETION_VALUE", "Quote this non-scalar completion value", completion.raw, owner));
      continue;
    }
    if (completion.kind === "spike") {
      if (!ids.workPattern.test(completion.value)) {
        findings.push(finding("error", "INVALID_SPIKE_MARKER", "Invalid spike completion marker", completion.raw, owner));
      }
      continue;
    }
    if (completion.kind !== "release" || !validVersion(completion.value, scheme)) {
      findings.push(finding("warning", "INVALID_COMPLETION_VALUE", "Replace this free-text completion value", completion.raw, owner));
    } else if (completion.annotation) {
      findings.push(finding("warning", "ANNOTATED_COMPLETION_VALUE", "Remove explanatory text from this completion value", completion.raw, owner));
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
    if (!(await exists(config.resolveProjectPath(entry.rule)))) {
      findings.push(finding(
        "warning",
        "MISSING_AGENT_PATH",
        "Review this missing agent path",
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
      "Merge legacy request sections into the current layout",
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

function validateVcsStages(findings, manifest) {
  if (manifest.model_version < 5) return;
  const stages = manifest.vcs.stages;
  const owner = { entity_type: "manifest", entity_id: "vcs.stages" };
  const report = (message) => findings.push(finding(
    "error",
    "INVALID_VCS_STAGE_CONFIGURATION",
    "Correct the VCS release stages",
    message,
    owner,
  ));
  const active = (stage) => stages[stage] !== "none";

  if (manifest.vcs.system === "none") {
    const configured = Object.entries(stages).filter(([, value]) => value !== "none").map(([stage]) => stage);
    if (configured.length) report(`vcs.system is none, but these stages are active: ${configured.join(", ")}.`);
    return;
  }
  if (stages.commit === "none") report("commit may not be none when vcs.system is git.");
  if (stages.commit === "human") {
    const laterAgentStages = ["push", "merge", "pull_request", "tag"].filter((stage) => stages[stage] === "agent");
    if (laterAgentStages.length) report(`commit is human, so later stages may only be human or none; found agent on ${laterAgentStages.join(", ")}.`);
  }
  if (active("merge") && active("pull_request")) report("merge and pull_request may not both be active.");
  if ((active("merge") || active("pull_request")) && !active("branch")) report("merge or pull_request requires an active branch stage.");
  if (active("pull_request") && !active("push")) report("pull_request requires an active push stage.");
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
  const deliveredWorkByRequest = new Map();
  for (const item of backlog.filter((entry) => entry.status === "done")) {
    const releases = (item.done_in || []).filter((completion) => (
      completion.kind === "release" && validVersion(completion.value, manifest.version.scheme)
    ));
    if (!releases.length) continue;
    for (const requestId of item.source_requests || []) {
      if (!deliveredWorkByRequest.has(requestId)) deliveredWorkByRequest.set(requestId, []);
      deliveredWorkByRequest.get(requestId).push({ item, releases });
    }
  }

  compareRequestSections(findings, requestDocument.metadata);
  if (backlogDocument.modelVersion !== SUPPORTED_BACKLOG_MODEL_VERSION) {
    findings.push(finding("error", "BACKLOG_MODEL_VERSION", "Unsupported backlog model version", `Expected ${SUPPORTED_BACKLOG_MODEL_VERSION}; found ${backlogDocument.modelVersion ?? "none"}.`, { entity_type: "file", entity_id: "backlog.yml" }));
  }

  for (const request of requests) {
    const owner = { entity_type: "request", entity_id: request.id };
    if (!hasExpectedPadding(request.id, config.ids.requestPrefix, config.ids.pad)) findings.push(finding("warning", "REQUEST_ID_FORMAT", "Review this request ID format", `Expected ${config.ids.requestPrefix}-${"0".repeat(config.ids.pad - 1)}1; found ${request.id}.`, owner));
    if (!REQUEST_STATUSES.includes(request.status)) findings.push(finding("error", "INVALID_REQUEST_STATUS", "Invalid request status", request.status || "missing", owner));
    if (!requestTypes.has(request.type)) findings.push(finding("error", "INVALID_REQUEST_TYPE", "Request type is outside the manifest taxonomy", request.type || "missing", owner));
    if (!priorities.has(request.priority)) findings.push(finding("error", "INVALID_PRIORITY", "Request priority is outside the manifest taxonomy", request.priority || "missing", owner));
    if (request.request_id && request.request_id.toUpperCase() !== request.id) findings.push(finding("error", "REQUEST_ID_MISMATCH", "Request heading and Request ID disagree", `${request.id} / ${request.request_id}`, owner));
    for (const unknown of request.unknown_fields || []) findings.push(finding("warning", "UNKNOWN_REQUEST_FIELD", `Move unsupported request field: ${unknown.name}`, `Line ${unknown.line}: ${unknown.value}`, owner));
    if (request.status === "blocked" && !request.blocked_on) findings.push(finding("error", "BLOCKED_WITHOUT_REASON", "Blocked request is missing Blocked on", "Add the named dependency.", owner));
    if (request.status === "deferred" && request.blocked_on) findings.push(finding("error", "DEFERRED_WITH_BLOCKER", "Deferred request carries Blocked on", request.blocked_on, owner));
    const deliveredWork = deliveredWorkByRequest.get(request.id) || [];
    if (
      !(request.done_in || []).length
      && (request.status === "partially-done" || (request.status === "done" && deliveredWork.length))
    ) {
      const evidence = deliveredWork.flatMap(({ item, releases }) => releases
        .map((completion) => `${item.id}: ${completion.value}`));
      findings.push(finding("error", "COMPLETION_MISSING", "Completed request is missing Done in", evidence.join(", ") || request.status, owner));
    }
    if (request.status === "partially-done" && !request.notes) findings.push(finding("error", "PARTIAL_WITHOUT_NOTES", "Partially done request is missing remaining-scope notes", "Add Notes describing what remains.", owner));
    validateCompletion(findings, owner, "request", request.done_in, manifest.version.scheme, config.ids);
    for (const id of request.unresolved_work_items || []) findings.push(finding("error", "MISSING_WORK_ITEM", "Work items reference does not resolve", id, owner));
  }

  for (const item of backlog) {
    const owner = { entity_type: "work", entity_id: item.id };
    if (!hasExpectedPadding(item.id, config.ids.workPrefix, config.ids.pad)) findings.push(finding("warning", "WORK_ID_FORMAT", "Review this work-item ID format", `Expected ${config.ids.workPrefix}-${"0".repeat(config.ids.pad - 1)}1; found ${item.id}.`, owner));
    if (!WORK_STATUSES.includes(item.status)) findings.push(finding("error", "INVALID_WORK_STATUS", "Invalid work-item status", item.status || "missing", owner));
    if (!workTypes.has(item.type)) findings.push(finding("error", "INVALID_WORK_TYPE", "Work-item type is outside the manifest taxonomy", item.type || "missing", owner));
    if (!priorities.has(item.priority)) findings.push(finding("error", "INVALID_PRIORITY", "Work-item priority is outside the manifest taxonomy", item.priority || "missing", owner));
    const hasSourceRequest = Boolean(item.source_request);
    const hasSourceRelease = Boolean(item.source_release);
    if (hasSourceRequest && hasSourceRelease) findings.push(finding("error", "CONFLICTING_WORK_PROVENANCE", "Work item has two provenance sources", `${item.source_request} / ${item.source_release}`, owner));
    if (!hasSourceRequest && !hasSourceRelease) findings.push(finding("warning", "MISSING_WORK_PROVENANCE", "Backfill this legacy work-item provenance", "Neither source_request nor source_release is set.", owner));
    if (hasSourceRequest && !requestsById.has(item.source_request)) findings.push(finding("error", "MISSING_SOURCE_REQUEST", "Work item source request does not resolve", item.source_request, owner));
    if (hasSourceRelease && !validVersion(item.source_release, manifest.version.scheme)) findings.push(finding("error", "INVALID_SOURCE_RELEASE", "Work item source release is invalid", item.source_release, owner));
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
        else if (!hasNumberedRecommendations(spike)) findings.push(finding("warning", "UNNUMBERED_SPIKE_RECOMMENDATIONS", "Number these spike recommendations", spikeFile, owner));
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
    if (selected.status && selected.status !== live.status) findings.push(finding("warning", "RELEASE_STATUS_DRIFT", "Synchronise active-release and backlog status", `${selected.id}: release says ${selected.status}; backlog says ${live.status}.`, { entity_type: "work", entity_id: selected.id }));
    const liveSource = live.source_request || live.source_release;
    if (selected.source && liveSource && selected.source !== liveSource) findings.push(finding("error", "RELEASE_SOURCE_DRIFT", "Active-release source differs from backlog", `${selected.id}: ${selected.source} / ${liveSource}`, { entity_type: "work", entity_id: selected.id }));
  }

  validateVcsStages(findings, manifest);
  if (manifest.vcs.system === "git" && !(await exists(path.join(config.vcsRoot, ".git")))) findings.push(finding("warning", "VCS_MISMATCH", "Review the Git repository mismatch", config.vcsRoot, { entity_type: "manifest", entity_id: "vcs.system" }));
  const hasNoVersionTag = manifest.vcs.system === "none"
    || (manifest.model_version >= 5 && manifest.vcs.stages.tag === "none");
  if (hasNoVersionTag && !manifest.version.file) findings.push(finding("error", "VERSION_FILE_REQUIRED", "Configure a file to hold the release version", "There is no tag stage to hold the version.", { entity_type: "manifest", entity_id: "version.file" }));
  if (config.files.changelog && !(await exists(config.files.changelog))) findings.push(finding("warning", "MISSING_CHANGELOG", "Create or correct the configured changelog", config.files.changelog, { entity_type: "manifest", entity_id: "paths.changelog" }));
  await validatePathsAndOwnership(findings, config);

  const releases = [...new Set(releaseNumbers([...requests.map((request) => request.done_in), ...backlog.map((item) => item.done_in)]))].sort(compareVersions);
  const recent = new Set(releases.slice(0, 3));
  const oldDone = [...requests, ...backlog].filter((item) => item.status === "done" && (item.done_in || []).some((entry) => entry.kind === "release" && !recent.has(entry.value)));
  if (oldDone.length > 25) findings.push(finding("recommendation", "PRUNING_HYGIENE", "Review old completed records for pruning", `${oldDone.length} done records are older than the three most recent releases.`, { entity_type: "project", entity_id: manifest.project.name }));

  const severityRank = { error: 0, warning: 1, recommendation: 2 };
  findings.sort((left, right) => (
    left.severity === right.severity
      ? left.code.localeCompare(right.code)
      : (severityRank[left.severity] ?? 99) - (severityRank[right.severity] ?? 99)
  ));
  return {
    findings,
    summary: {
      errors: findings.filter((entry) => entry.severity === "error").length,
      warnings: findings.filter((entry) => entry.severity === "warning").length,
      recommendations: findings.filter((entry) => entry.severity === "recommendation").length,
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
  createFinding: finding,
  createSummaries,
  linkModel,
};
