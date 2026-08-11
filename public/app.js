const state = {
  data: null,
  page: "viewer",
  view: "requests",
  query: "",
  statuses: new Set(),
  types: new Set(),
  capabilities: new Set(),
  requestIds: new Set(),
  backlogItemIds: new Set(),
  deliveredRelease: "",
  unlinkedOnly: false,
  healthSeverities: new Set(["error", "warning"]),
  hasAppliedDefaultStatuses: false,
};

const byId = (id) => document.getElementById(id);
const elements = {
  projectTitle: byId("projectTitle"),
  projectDescription: byId("projectDescription"),
  loadedAt: byId("loadedAt"),
  refreshButton: byId("refreshButton"),
  backToViewerLink: byId("backToViewerLink"),
  summaryGrid: byId("summaryGrid"),
  homeCharts: byId("homeCharts"),
  moreChartsLinkRow: byId("moreChartsLinkRow"),
  moreChartsLink: byId("moreChartsLink"),
  moreChartsPage: byId("moreChartsPage"),
  toolbar: byId("toolbar"),
  activeFilters: byId("activeFilters"),
  searchInput: byId("searchInput"),
  statusFilter: byId("statusFilter"),
  statusFilterButton: byId("statusFilterButton"),
  statusFilterLabel: byId("statusFilterLabel"),
  statusFilterMenu: byId("statusFilterMenu"),
  typeFilter: byId("typeFilter"),
  typeFilterButton: byId("typeFilterButton"),
  typeFilterLabel: byId("typeFilterLabel"),
  typeFilterMenu: byId("typeFilterMenu"),
  resetFiltersButton: byId("resetFiltersButton"),
  requestsView: byId("requestsView"),
  backlogView: byId("backlogView"),
  linksView: byId("linksView"),
  releaseView: byId("releaseView"),
  healthView: byId("healthView"),
  requestList: byId("requestList"),
  backlogList: byId("backlogList"),
  linkList: byId("linkList"),
  requestCount: byId("requestCount"),
  backlogCount: byId("backlogCount"),
  linkCount: byId("linkCount"),
  requestStatusChart: byId("requestStatusChart"),
  backlogStatusChart: byId("backlogStatusChart"),
  requestReleaseChart: byId("requestReleaseChart"),
  capabilityChart: byId("capabilityChart"),
  requestTypeChart: byId("requestTypeChart"),
  requestPriorityChart: byId("requestPriorityChart"),
  requestSectionChart: byId("requestSectionChart"),
  requestLinkCoverageChart: byId("requestLinkCoverageChart"),
  releaseTypeChart: byId("releaseTypeChart"),
  releasePriorityChart: byId("releasePriorityChart"),
  releaseCompletenessChart: byId("releaseCompletenessChart"),
  backlogTypeChart: byId("backlogTypeChart"),
  backlogPriorityChart: byId("backlogPriorityChart"),
  agentChart: byId("agentChart"),
  backlogSourceCoverageChart: byId("backlogSourceCoverageChart"),
  releaseOverview: byId("releaseOverview"),
  releaseItems: byId("releaseItems"),
  releaseSections: byId("releaseSections"),
  releaseStatusBadge: byId("releaseStatusBadge"),
  healthSummary: byId("healthSummary"),
  healthFilters: byId("healthFilters"),
  healthList: byId("healthList"),
  healthNavCount: byId("healthNavCount"),
  detailsModal: byId("detailsModal"),
  modalEyebrow: byId("modalEyebrow"),
  modalTitle: byId("modalTitle"),
  modalTags: byId("modalTags"),
  modalBody: byId("modalBody"),
  modalCloseButton: byId("modalCloseButton"),
  emptyTemplate: byId("emptyTemplate"),
};

const widgetElements = {
  inboxRequests: [byId("inboxRequests"), byId("inboxRequestsTrend")],
  activeReleaseRequests: [byId("activeReleaseRequests"), byId("activeReleaseRequestsTrend")],
  openRequests: [byId("openRequests"), byId("openRequestsTrend")],
  unlinkedRequests: [byId("unlinkedRequests"), byId("unlinkedRequestsTrend")],
  backlogItems: [byId("backlogTotal"), byId("backlogItemsTrend")],
  backlogComplete: [byId("backlogComplete"), byId("backlogCompleteTrend")],
};

let lastFocusedElement = null;

function normalise(value) {
  return String(value ?? "").toLowerCase();
}

function label(value) {
  return value == null || value === "" ? "unspecified" : String(value);
}

function humanKey(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value, max = 280) {
  const text = label(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function uniqueValues(items, property) {
  return [...new Set(items.map((item) => item[property]).filter(Boolean))].sort();
}

function countBy(items, property) {
  return items.reduce((counts, item) => {
    const key = item[property] || "unspecified";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countArrayValues(items, property) {
  return items.reduce((counts, item) => {
    const values = Array.isArray(item[property]) ? item[property] : [];
    if (!values.length) counts.unspecified = (counts.unspecified || 0) + 1;
    for (const value of values) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function makeTag(value, kind = "") {
  const tag = document.createElement("span");
  const suffix = normalise(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  tag.className = ["tag", kind && `${kind}-${suffix}`].filter(Boolean).join(" ");
  tag.textContent = label(value);
  return tag;
}

function emptyNode(message = "Nothing matches the current filters.") {
  const node = elements.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.textContent = message;
  return node;
}

function completionLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry?.raw || entry?.value || "unspecified";
}

function formatDetailValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.kind && (value.raw || value.value)) return completionLabel(value);
    return JSON.stringify(value, null, 2);
  }
  return label(value);
}

function orderedEntries(item) {
  const preferred = ["id", "request_id", "source_request", "title", "type", "capability", "status", "priority", "confidence", "section", "summary", "notes", "blocked_on", "acceptance", "remaining", "dependencies", "suggested_agents", "backlog_items", "work_items", "done_in", "source", "source_block"];
  const hidden = new Set(["live_item", "done_in_labels", "work_items_raw", "done_in_raw", "unknown_fields", "resolved_backlog_items", "unresolved_work_items", "source_requests", "has_request", "work_items_explicitly_none"]);
  return [...new Set([...preferred, ...Object.keys(item).sort()])]
    .filter((key) => !hidden.has(key) && Object.prototype.hasOwnProperty.call(item, key))
    .filter((key) => item[key] !== "" && item[key] != null);
}

function renderDetailValue(value, key, item, kind) {
  if (key === "source_block") {
    const pre = document.createElement("pre");
    pre.className = "source-block";
    pre.textContent = label(value);
    return pre;
  }
  if (Array.isArray(value)) {
    if (!value.length) return document.createTextNode("None");
    const list = document.createElement("ul");
    list.className = "detail-list";
    for (const entry of value) {
      const row = document.createElement("li");
      const text = formatDetailValue(entry);
      if (kind === "request" && ["backlog_items", "work_items"].includes(key) && typeof entry === "string") {
        const button = document.createElement("button");
        button.className = "inline-link";
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", () => {
          closeDetailsModal();
          applyFilters({ view: "backlog", backlogItemIds: [entry] });
        });
        row.append(button);
      } else row.textContent = text;
      list.append(row);
    }
    return list;
  }
  if (kind === "work" && key === "source_request" && value) {
    const button = document.createElement("button");
    button.className = "inline-link";
    button.type = "button";
    button.textContent = value;
    button.addEventListener("click", () => {
      closeDetailsModal();
      applyFilters({ view: "requests", requestIds: [value] });
    });
    return button;
  }
  return document.createTextNode(formatDetailValue(value));
}

function openDetailsModal(item, kind, trigger = document.activeElement) {
  lastFocusedElement = trigger;
  elements.modalEyebrow.textContent = kind === "request" ? "Request" : kind === "work" ? "Work item" : "Health finding";
  elements.modalTitle.textContent = item.title || item.id || item.code || "Details";
  elements.modalTags.replaceChildren();
  for (const value of [item.status, item.type, item.priority, item.severity].filter(Boolean)) elements.modalTags.append(makeTag(value, value === item.severity ? "severity" : value === item.status ? "status" : ""));
  elements.modalBody.replaceChildren();
  const definition = document.createElement("dl");
  for (const key of orderedEntries(item)) {
    const row = document.createElement("div");
    row.className = "detail-row";
    const term = document.createElement("dt");
    term.textContent = humanKey(key);
    const description = document.createElement("dd");
    description.append(renderDetailValue(item[key], key, item, kind));
    row.append(term, description);
    definition.append(row);
  }
  elements.modalBody.append(definition);
  elements.detailsModal.classList.remove("is-hidden");
  document.body.classList.add("modal-open");
  elements.modalCloseButton.focus();
}

function closeDetailsModal() {
  if (elements.detailsModal.classList.contains("is-hidden")) return;
  elements.detailsModal.classList.add("is-hidden");
  document.body.classList.remove("modal-open");
  lastFocusedElement?.focus?.();
}

function makeClickableCard(card, item, kind) {
  card.classList.add("clickable-card");
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open ${kind} details for ${item.id || item.code}`);
  card.addEventListener("click", () => openDetailsModal(item, kind, card));
  card.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openDetailsModal(item, kind, card);
    }
  });
  return card;
}

function renderRequestCard(request) {
  const card = document.createElement("article");
  card.className = "item-card";
  const top = document.createElement("div");
  top.className = "item-topline";
  const id = document.createElement("span");
  id.className = "item-id";
  id.textContent = request.id;
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = request.title || "Untitled request";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = request.section || "";
  top.append(id, title, meta);
  const summary = document.createElement("p");
  summary.className = "item-summary";
  summary.textContent = truncate(request.summary);
  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(makeTag(request.status, "status"), makeTag(request.type, "type"), makeTag(request.priority, "priority"));
  for (const completion of request.done_in || []) tags.append(makeTag(completionLabel(completion), completion.kind === "invalid" ? "severity" : "completion"));
  for (const itemId of request.backlog_items || []) tags.append(makeTag(itemId));
  if (request.work_items_explicitly_none) tags.append(makeTag("no work required"));
  if (request.blocked_on) tags.append(makeTag(`blocked on ${request.blocked_on}`, "status"));
  card.append(top, summary, tags);
  return makeClickableCard(card, request, "request");
}

function renderBacklogCard(item, releaseItem = null) {
  const card = document.createElement("article");
  card.className = "item-card";
  const top = document.createElement("div");
  top.className = "item-topline";
  const id = document.createElement("span");
  id.className = "item-id";
  id.textContent = item.id;
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = item.title || "Untitled work item";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = item.source_request || "no request";
  top.append(id, title, meta);
  const summary = document.createElement("p");
  summary.className = "item-summary";
  summary.textContent = truncate(releaseItem?.description || item.summary);
  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(makeTag(item.status, "status"), makeTag(item.type, "type"), makeTag(item.priority, "priority"), makeTag(item.capability || "no capability", "capability"));
  if (item.confidence) tags.append(makeTag(`confidence ${item.confidence}`));
  if (item.dependencies?.length) tags.append(makeTag(`${item.dependencies.length} dependencies`));
  if (item.blocked_on) tags.append(makeTag(`blocked on ${item.blocked_on}`, "status"));
  if (releaseItem?.status && releaseItem.status !== item.status) tags.append(makeTag(`release file: ${releaseItem.status}`, "severity"));
  card.append(top, summary, tags);
  return makeClickableCard(card, item, "work");
}

function renderLinkCard(request) {
  const card = document.createElement("article");
  card.className = "item-card";
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = `${request.id} · ${request.title || "Untitled request"}`;
  const tags = document.createElement("div");
  tags.className = "tag-row";
  const linked = request.backlog_items || [];
  if (linked.length) for (const id of linked) tags.append(makeTag(id));
  else if (request.work_items_explicitly_none) tags.append(makeTag("no work required"));
  else tags.append(makeTag("no backlog item", "severity"));
  card.append(title, tags);
  return makeClickableCard(card, request, "request");
}

function renderList(container, items, renderer) {
  container.replaceChildren();
  if (!items.length) container.append(emptyNode());
  for (const item of items) container.append(renderer(item));
}

function parseSearch(query) {
  const qualified = [];
  const remaining = String(query || "").replace(/(\w+):(?:"([^"]+)"|(\S+))/g, (_, field, quoted, plain) => {
    qualified.push({ field: field.toLowerCase(), value: normalise(quoted || plain) });
    return " ";
  });
  return { qualified, text: normalise(remaining.trim()) };
}

function searchableValues(item, field) {
  const aliases = {
    agent: "suggested_agents",
    request: item.request_id ? "id" : "source_request",
    work: "id",
    blocked: "blocked_on",
    done: "done_in_labels",
  };
  const value = item[aliases[field] || field];
  return Array.isArray(value) ? value.map(normalise) : [normalise(value)];
}

function matchesSearch(item) {
  const parsed = parseSearch(state.query);
  for (const term of parsed.qualified) if (!searchableValues(item, term.field).some((value) => value.includes(term.value))) return false;
  if (!parsed.text) return true;
  const haystack = [item.id, item.title, item.summary, item.status, item.type, item.priority, item.capability, item.source_request, item.notes, item.blocked_on, ...(item.suggested_agents || [])].map(normalise).join(" ");
  return haystack.includes(parsed.text);
}

function matchesCommonFilters(item) {
  return (!state.statuses.size || state.statuses.has(item.status))
    && (!state.types.size || state.types.has(item.type))
    && matchesSearch(item);
}

function matchesBacklogFilters(item) {
  if (state.unlinkedOnly) return false;
  if (state.requestIds.size && !state.requestIds.has(item.source_request)) return false;
  if (state.backlogItemIds.size && !state.backlogItemIds.has(item.id)) return false;
  return matchesCommonFilters(item) && (!state.capabilities.size || state.capabilities.has(item.capability));
}

function completionBuckets(request) {
  const values = request.done_in || [];
  if (!values.length) return ["No completion value"];
  return values.map((entry) => entry.kind === "spike" ? `SPIKE: ${entry.value}` : entry.kind === "release" ? entry.value : "Invalid completion");
}

function matchesRequestFilters(request, capabilityMap) {
  if (state.deliveredRelease && !completionBuckets(request).includes(state.deliveredRelease)) return false;
  if (state.requestIds.size && !state.requestIds.has(request.id)) return false;
  if (state.unlinkedOnly && (request.resolved_backlog_items?.length || request.work_items_explicitly_none || ["duplicate", "rejected"].includes(request.status))) return false;
  if (state.backlogItemIds.size && ![...state.backlogItemIds].some((id) => request.backlog_items?.includes(id))) return false;
  if (!matchesCommonFilters(request)) return false;
  if (!state.capabilities.size) return true;
  const capabilities = capabilityMap.get(request.id) || new Set();
  return [...state.capabilities].some((value) => capabilities.has(value));
}

function buildCapabilityMap(requests, backlog) {
  const map = new Map(requests.map((request) => [request.id, new Set()]));
  for (const item of backlog) if (item.source_request && item.capability && map.has(item.source_request)) map.get(item.source_request).add(item.capability);
  return map;
}

function sortedEntries(counts) {
  return Object.entries(counts || {}).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function releaseSort(entries) {
  function tuple(value) {
    const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  }
  return entries.sort((left, right) => {
    const a = tuple(left[0]);
    const b = tuple(right[0]);
    if (a && !b) return -1;
    if (!a && b) return 1;
    if (!a && !b) return left[0].localeCompare(right[0]);
    for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
    return 0;
  });
}

function renderChart(container, counts, options = {}) {
  const limit = options.limit ?? 20;
  const entries = (options.sortEntries ? options.sortEntries(Object.entries(counts || {})) : sortedEntries(counts)).slice(0, limit);
  container.replaceChildren();
  if (!entries.length) {
    container.append(emptyNode("No matching data"));
    return;
  }
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  for (const [name, count] of entries) {
    const row = document.createElement(options.onClick ? "button" : "div");
    row.className = "bar-row";
    if (options.onClick) {
      row.type = "button";
      row.addEventListener("click", () => options.onClick(name));
    }
    const nameNode = document.createElement("span");
    nameNode.className = "tag-label";
    nameNode.textContent = name;
    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = ["bar-fill", options.kind && `${options.kind}-${normalise(name).replace(/[^a-z0-9]+/g, "-")}`].filter(Boolean).join(" ");
    fill.style.width = `${Math.max((count / max) * 100, 1)}%`;
    track.append(fill);
    const countNode = document.createElement("strong");
    countNode.textContent = count;
    row.append(nameNode, track, countNode);
    container.append(row);
  }
}

function groupedByCompletion(requests, property) {
  const groups = {};
  for (const request of requests.filter((item) => ["done", "partially-done"].includes(item.status))) {
    for (const completion of completionBuckets(request)) {
      const value = property === "delivery_status" ? request.status : request[property] || "unspecified";
      groups[completion] ||= {};
      groups[completion][value] = (groups[completion][value] || 0) + 1;
    }
  }
  return groups;
}

function renderStackedChart(container, groups, options = {}) {
  const entries = releaseSort(Object.entries(groups || {}));
  const categories = [...new Set(entries.flatMap(([, counts]) => Object.keys(counts)))];
  container.replaceChildren();
  if (!entries.length) return container.append(emptyNode("No delivery history"));
  for (const [release, counts] of entries) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const row = document.createElement("div");
    row.className = "stacked-row";
    const releaseNode = document.createElement("span");
    releaseNode.className = "tag-label";
    releaseNode.textContent = release;
    const bar = document.createElement("div");
    bar.className = "stacked-bar";
    for (const category of categories) {
      if (!counts[category]) continue;
      const segment = document.createElement("span");
      segment.className = ["stacked-segment", options.kind && `${options.kind}-${normalise(category).replace(/[^a-z0-9]+/g, "-")}`].filter(Boolean).join(" ");
      segment.style.width = `${(counts[category] / total) * 100}%`;
      segment.title = `${category}: ${counts[category]}`;
      bar.append(segment);
    }
    const count = document.createElement("strong");
    count.textContent = total;
    const legend = document.createElement("div");
    legend.className = "stacked-legend";
    for (const category of categories.filter((value) => counts[value])) {
      const chip = document.createElement("span");
      chip.className = "stacked-chip";
      chip.textContent = `${category} ${counts[category]}`;
      legend.append(chip);
    }
    row.append(releaseNode, bar, count, legend);
    container.append(row);
  }
}

function defaultStatuses() {
  const statuses = uniqueValues([...state.data.requests, ...state.data.backlog], "status");
  return new Set(statuses.filter((status) => !["done", "duplicate"].includes(status)));
}

function allStatuses() {
  return new Set(uniqueValues([...state.data.requests, ...state.data.backlog], "status"));
}

function setMultiOptions(menu, selected, values) {
  menu.replaceChildren();
  for (const value of values) {
    const option = document.createElement("label");
    option.className = "multi-filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = selected.has(value);
    option.append(input, document.createTextNode(value));
    menu.append(option);
  }
}

function selectedLabel(values, fallback) {
  const entries = [...values].sort();
  if (!entries.length) return fallback;
  return entries.length <= 2 ? entries.join(", ") : `${entries.length} selected`;
}

function renderWidget(key, element, trend) {
  const latest = state.data.widgets[key] ?? 0;
  const previous = state.data.widget_history?.previous?.[key];
  element.textContent = latest;
  if (!trend) return;
  if (typeof previous !== "number" || previous === latest) {
    trend.className = "trend trend-flat";
    trend.textContent = "→";
    trend.title = previous == null ? "No previous snapshot" : `Previous: ${previous}`;
    trend.setAttribute("aria-label", "No change");
  } else {
    const up = latest > previous;
    trend.className = `trend ${up ? "trend-up" : "trend-down"}`;
    trend.textContent = up ? "↑" : "↓";
    trend.title = `Previous: ${previous} · ${state.data.widget_history.updated_at || ""}`;
    trend.setAttribute("aria-label", up ? "Increased" : "Decreased");
  }
}

function renderActiveFilters() {
  elements.activeFilters.replaceChildren();
  const filters = [
    ...[...state.capabilities].map((value) => ["Capability", value, () => state.capabilities.delete(value)]),
    ...[...state.requestIds].map((value) => ["Request", value, () => state.requestIds.delete(value)]),
    ...[...state.backlogItemIds].map((value) => ["Work item", value, () => state.backlogItemIds.delete(value)]),
  ];
  if (state.deliveredRelease) filters.push(["Completed", state.deliveredRelease, () => { state.deliveredRelease = ""; }]);
  if (state.unlinkedOnly) filters.push(["Links", "unlinked only", () => { state.unlinkedOnly = false; }]);
  for (const [kind, value, remove] of filters) {
    const button = document.createElement("button");
    button.className = "filter-chip";
    button.type = "button";
    button.textContent = `${kind}: ${value} ×`;
    button.addEventListener("click", () => { remove(); renderAndSync(); });
    elements.activeFilters.append(button);
  }
  elements.activeFilters.classList.toggle("is-empty", !filters.length);
}

function renderRelease() {
  const release = state.data.active_release;
  elements.releaseStatusBadge.className = `tag status-${normalise(release.status).replace(/[^a-z0-9]+/g, "-")}`;
  elements.releaseStatusBadge.textContent = release.status || "none";
  elements.releaseOverview.replaceChildren();
  for (const [title, value] of [["Version", release.version || "TBD"], ["Branch", release.branch || "Not assigned"], ["Selected items", release.work_items.length]]) {
    const card = document.createElement("article");
    card.className = "release-fact";
    const key = document.createElement("span");
    key.textContent = title;
    const detail = document.createElement("strong");
    detail.textContent = value;
    card.append(key, detail);
    elements.releaseOverview.append(card);
  }
  if (release.release_goal) {
    const goal = document.createElement("article");
    goal.className = "release-goal";
    const heading = document.createElement("h3");
    heading.textContent = "Release goal";
    const text = document.createElement("p");
    text.textContent = release.release_goal;
    goal.append(heading, text);
    elements.releaseOverview.append(goal);
  }
  elements.releaseItems.replaceChildren();
  if (!release.work_items.length) elements.releaseItems.append(emptyNode("No work items selected."));
  for (const selected of release.work_items) {
    const live = selected.live_item || state.data.backlog.find((item) => item.id === selected.id);
    if (live) elements.releaseItems.append(renderBacklogCard(live, selected));
  }
  elements.releaseSections.replaceChildren();
  const ignored = new Set(["overview", "selected_work_items"]);
  for (const [key, value] of Object.entries(release.section_text || {})) {
    if (ignored.has(key) || !value || /^none\.?$/i.test(value.trim())) continue;
    const section = document.createElement("article");
    section.className = "release-section panel";
    const heading = document.createElement("h3");
    heading.textContent = humanKey(key);
    const content = document.createElement("div");
    content.className = "release-copy";
    content.textContent = value;
    section.append(heading, content);
    elements.releaseSections.append(section);
  }
}

function renderHealth() {
  const health = state.data.health;
  const errors = makeTag(`${health.summary.errors} errors`);
  errors.classList.add("severity-error");
  const warnings = makeTag(`${health.summary.warnings} warnings`);
  warnings.classList.add("severity-warning");
  elements.healthSummary.replaceChildren(errors, warnings);
  elements.healthFilters.replaceChildren();
  for (const severity of ["error", "warning"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `health-filter ${state.healthSeverities.has(severity) ? "is-active" : ""}`;
    button.textContent = `${humanKey(severity)}s`;
    button.addEventListener("click", () => {
      if (state.healthSeverities.has(severity)) state.healthSeverities.delete(severity);
      else state.healthSeverities.add(severity);
      renderHealth();
    });
    elements.healthFilters.append(button);
  }
  elements.healthList.replaceChildren();
  const findings = health.findings.filter((entry) => state.healthSeverities.has(entry.severity));
  if (!findings.length) elements.healthList.append(emptyNode(health.summary.total ? "No findings match this severity filter." : "No conformance findings."));
  for (const item of findings) {
    const card = document.createElement("article");
    card.className = `health-card severity-${item.severity}`;
    const marker = document.createElement("span");
    marker.className = "health-marker";
    marker.textContent = item.severity;
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title;
    const message = document.createElement("p");
    message.textContent = item.message;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = [item.code, item.entity_id].filter(Boolean).join(" · ");
    copy.append(title, message, meta);
    card.append(marker, copy);
    elements.healthList.append(makeClickableCard(card, item, "health"));
  }
}

function setPage(page) {
  state.page = page;
  const charts = page === "charts";
  elements.moreChartsPage.classList.toggle("is-hidden", !charts);
  elements.backToViewerLink.classList.toggle("is-hidden", !charts);
  for (const element of [elements.summaryGrid, elements.homeCharts, elements.moreChartsLinkRow, elements.toolbar, elements.activeFilters, elements.requestsView, elements.backlogView, elements.linksView, elements.releaseView, elements.healthView]) element.classList.toggle("force-hidden", charts);
}

function setView(view, push = true) {
  if (state.page === "charts") setPage("viewer");
  state.view = ["requests", "backlog", "links", "release", "health"].includes(view) ? view : "requests";
  state.page = "viewer";
  for (const button of document.querySelectorAll(".primary-tab")) button.classList.toggle("is-active", button.dataset.view === state.view);
  elements.requestsView.classList.toggle("is-hidden", state.view !== "requests");
  elements.backlogView.classList.toggle("is-hidden", state.view !== "backlog");
  elements.linksView.classList.toggle("is-hidden", state.view !== "links");
  elements.releaseView.classList.toggle("is-hidden", state.view !== "release");
  elements.healthView.classList.toggle("is-hidden", state.view !== "health");
  const special = ["release", "health"].includes(state.view);
  elements.summaryGrid.classList.toggle("is-hidden", special);
  elements.homeCharts.classList.toggle("is-hidden", special);
  elements.moreChartsLinkRow.classList.toggle("is-hidden", special);
  elements.toolbar.classList.toggle("is-hidden", special);
  elements.activeFilters.classList.toggle("is-hidden", special);
  if (push) syncUrl("push");
}

function syncUrl(mode = "replace") {
  const params = new URLSearchParams();
  if (state.view !== "requests") params.set("view", state.view);
  if (state.query) params.set("q", state.query);
  if (state.statuses.size) params.set("status", [...state.statuses].join(","));
  if (state.types.size) params.set("type", [...state.types].join(","));
  if (state.capabilities.size) params.set("capability", [...state.capabilities].join(","));
  if (state.requestIds.size) params.set("request", [...state.requestIds].join(","));
  if (state.backlogItemIds.size) params.set("work", [...state.backlogItemIds].join(","));
  if (state.deliveredRelease) params.set("release", state.deliveredRelease);
  if (state.unlinkedOnly) params.set("unlinked", "1");
  const url = `${location.pathname}${params.size ? `?${params}` : ""}`;
  history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  const list = (name) => new Set((params.get(name) || "").split(",").filter(Boolean));
  state.view = params.get("view") || "requests";
  state.query = params.get("q") || "";
  state.statuses = list("status");
  state.types = list("type");
  state.capabilities = list("capability");
  state.requestIds = list("request");
  state.backlogItemIds = list("work");
  state.deliveredRelease = params.get("release") || "";
  state.unlinkedOnly = params.get("unlinked") === "1";
  state.hasAppliedDefaultStatuses = params.has("status");
  elements.searchInput.value = state.query;
}

function applyFilters(options = {}) {
  state.query = options.query ?? "";
  state.statuses = new Set(options.statuses ?? allStatuses());
  state.types = new Set(options.types ?? []);
  state.capabilities = new Set(options.capabilities ?? []);
  state.requestIds = new Set(options.requestIds ?? []);
  state.backlogItemIds = new Set(options.backlogItemIds ?? []);
  state.deliveredRelease = options.deliveredRelease ?? "";
  state.unlinkedOnly = options.unlinkedOnly ?? false;
  elements.searchInput.value = state.query;
  setPage("viewer");
  setView(options.view || state.view, false);
  closeFilters();
  renderAndSync("push");
}

function renderAndSync(mode = "replace") {
  render();
  syncUrl(mode);
}

function render() {
  if (!state.data) return;
  const { requests, backlog } = state.data;
  const capabilityMap = buildCapabilityMap(requests, backlog);
  if (!state.hasAppliedDefaultStatuses) {
    state.statuses = defaultStatuses();
    state.hasAppliedDefaultStatuses = true;
  }
  for (const [key, [element, trend]] of Object.entries(widgetElements)) renderWidget(key, element, trend);
  byId("healthErrors").textContent = state.data.health.summary.errors;
  byId("healthWarnings").textContent = state.data.health.summary.warnings;
  elements.healthNavCount.textContent = state.data.health.summary.total;
  elements.healthNavCount.classList.toggle("has-errors", state.data.health.summary.errors > 0);

  setMultiOptions(elements.statusFilterMenu, state.statuses, uniqueValues([...requests, ...backlog], "status"));
  setMultiOptions(elements.typeFilterMenu, state.types, uniqueValues([...requests, ...backlog], "type"));
  elements.statusFilterLabel.textContent = selectedLabel(state.statuses, "All statuses");
  elements.typeFilterLabel.textContent = selectedLabel(state.types, "All types");
  renderActiveFilters();

  const filteredRequests = requests.filter((item) => matchesRequestFilters(item, capabilityMap));
  const filteredBacklog = backlog.filter(matchesBacklogFilters);
  renderList(elements.requestList, filteredRequests, renderRequestCard);
  renderList(elements.backlogList, filteredBacklog, renderBacklogCard);
  renderList(elements.linkList, filteredRequests, renderLinkCard);
  elements.requestCount.textContent = `${filteredRequests.length} shown of ${requests.length}`;
  elements.backlogCount.textContent = `${filteredBacklog.length} shown of ${backlog.length}`;
  elements.linkCount.textContent = `${filteredRequests.length} shown`;

  renderChart(elements.requestStatusChart, countBy(filteredRequests, "status"), { kind: "status", onClick: (status) => applyFilters({ view: "requests", statuses: [status] }) });
  renderChart(elements.backlogStatusChart, countBy(filteredBacklog, "status"), { kind: "status", onClick: (status) => applyFilters({ view: "backlog", statuses: [status] }) });
  const releases = {};
  for (const request of requests.filter((item) => ["done", "partially-done"].includes(item.status))) for (const value of completionBuckets(request)) releases[value] = (releases[value] || 0) + 1;
  renderChart(elements.requestReleaseChart, releases, { kind: "release", limit: Infinity, sortEntries: releaseSort, onClick: (release) => applyFilters({ view: "requests", deliveredRelease: release }) });
  renderChart(elements.capabilityChart, countBy(filteredBacklog, "capability"), { kind: "capability", onClick: (capability) => applyFilters({ view: "backlog", capabilities: [capability] }) });
  renderChart(elements.requestTypeChart, countBy(filteredRequests, "type"), { kind: "type" });
  renderChart(elements.requestPriorityChart, countBy(filteredRequests, "priority"), { kind: "priority" });
  renderChart(elements.requestSectionChart, countBy(filteredRequests, "section"));
  renderChart(elements.requestLinkCoverageChart, filteredRequests.reduce((counts, request) => {
    const key = request.resolved_backlog_items.length ? "Linked to backlog" : request.work_items_explicitly_none ? "No work required" : "No backlog item";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}));
  renderStackedChart(elements.releaseTypeChart, groupedByCompletion(requests, "type"), { kind: "type" });
  renderStackedChart(elements.releasePriorityChart, groupedByCompletion(requests, "priority"), { kind: "priority" });
  renderStackedChart(elements.releaseCompletenessChart, groupedByCompletion(requests, "delivery_status"), { kind: "status" });
  renderChart(elements.backlogTypeChart, countBy(filteredBacklog, "type"), { kind: "type" });
  renderChart(elements.backlogPriorityChart, countBy(filteredBacklog, "priority"), { kind: "priority" });
  renderChart(elements.agentChart, countArrayValues(filteredBacklog, "suggested_agents"));
  renderChart(elements.backlogSourceCoverageChart, filteredBacklog.reduce((counts, item) => {
    const key = item.has_request ? "Has matching request" : "No matching request";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}));
  renderRelease();
  renderHealth();
  if (state.page === "viewer") setView(state.view, false);
}

async function loadData() {
  elements.loadedAt.textContent = "Reading manifest and work files…";
  const response = await fetch(`/api/data?now=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error([payload.error, ...(payload.details || [])].join(" · "));
  state.data = payload;
  elements.projectTitle.textContent = payload.project.name;
  elements.projectDescription.textContent = payload.project.description;
  document.title = `${payload.project.name} · Work Management Viewer`;
  const loaded = new Date(payload.generated_at);
  elements.loadedAt.textContent = `Loaded model v${payload.project.manifest.model_version} at ${loaded.toLocaleString()}`;
  elements.loadedAt.title = Object.values(payload.files).filter(Boolean).join("\n");
  render();
}

function toggleFilter(filter, button) {
  const open = filter.classList.toggle("is-open");
  button.setAttribute("aria-expanded", String(open));
}

function closeFilters(except = null) {
  for (const [filter, button] of [[elements.statusFilter, elements.statusFilterButton], [elements.typeFilter, elements.typeFilterButton]]) {
    if (filter === except) continue;
    filter.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
  }
}

function handleMultiFilter(event, selected) {
  if (event.target.type !== "checkbox") return;
  if (event.target.checked) selected.add(event.target.value);
  else selected.delete(event.target.value);
  renderAndSync();
}

function showError(error) {
  elements.loadedAt.textContent = error.message;
  elements.loadedAt.classList.add("load-error");
  console.error(error);
}

loadUrlState();
elements.refreshButton.addEventListener("click", () => loadData().catch(showError));
elements.searchInput.addEventListener("input", (event) => { state.query = event.target.value; renderAndSync(); });
elements.statusFilterButton.addEventListener("click", () => { closeFilters(elements.statusFilter); toggleFilter(elements.statusFilter, elements.statusFilterButton); });
elements.typeFilterButton.addEventListener("click", () => { closeFilters(elements.typeFilter); toggleFilter(elements.typeFilter, elements.typeFilterButton); });
elements.statusFilterMenu.addEventListener("change", (event) => handleMultiFilter(event, state.statuses));
elements.typeFilterMenu.addEventListener("change", (event) => handleMultiFilter(event, state.types));
elements.resetFiltersButton.addEventListener("click", () => {
  state.hasAppliedDefaultStatuses = true;
  applyFilters({ view: state.view, statuses: [...defaultStatuses()] });
});
elements.moreChartsLink.addEventListener("click", () => { closeFilters(); setPage("charts"); render(); });
elements.backToViewerLink.addEventListener("click", () => { setPage("viewer"); setView(state.view, false); render(); });
byId("unlinkedRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", unlinkedOnly: true }));
byId("inboxRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", statuses: ["inbox"] }));
byId("activeReleaseRequestsButton").addEventListener("click", () => setView("release"));
byId("openRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", statuses: ["needs-refinement", "refined", "partially-done", "blocked"] }));
byId("healthErrorsButton").addEventListener("click", () => { state.healthSeverities = new Set(["error"]); setView("health"); render(); });
byId("healthWarningsButton").addEventListener("click", () => { state.healthSeverities = new Set(["warning"]); setView("health"); render(); });
elements.modalCloseButton.addEventListener("click", closeDetailsModal);
elements.detailsModal.addEventListener("click", (event) => { if (event.target === elements.detailsModal) closeDetailsModal(); });
for (const button of document.querySelectorAll(".primary-tab")) button.addEventListener("click", () => { setView(button.dataset.view); render(); });
document.addEventListener("click", (event) => { if (!elements.statusFilter.contains(event.target) && !elements.typeFilter.contains(event.target)) closeFilters(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetailsModal(); });
window.addEventListener("popstate", () => { loadUrlState(); if (state.data) render(); });

setPage("viewer");
setView(state.view, false);
loadData().catch(showError);
