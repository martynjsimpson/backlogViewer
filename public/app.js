const state = {
  data: null,
  page: "viewer",
  view: "dashboard",
  query: "",
  statuses: new Set(),
  types: new Set(),
  capabilities: new Set(),
  requestIds: new Set(),
  backlogItemIds: new Set(),
  deliveredRelease: "",
  unlinkedOnly: false,
  healthSeverities: new Set(["error", "warning", "recommendation"]),
  healthCodes: new Set(),
  hasAppliedDefaultStatuses: false,
  openDetail: null,
  livePaused: false,
};

const byId = (id) => document.getElementById(id);
const elements = {
  projectTitle: byId("projectTitle"),
  projectDescription: byId("projectDescription"),
  loadedAt: byId("loadedAt"),
  loadedModelText: byId("loadedModelText"),
  loadedAtTime: byId("loadedAtTime"),
  headerReleaseBadge: byId("headerReleaseBadge"),
  headerReleaseStatus: byId("headerReleaseStatus"),
  liveStatusButton: byId("liveStatusButton"),
  liveStatusText: byId("liveStatusText"),
  backToViewerLink: byId("backToViewerLink"),
  dashboardView: byId("dashboardView"),
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
  requestFilteredTotal: byId("requestFilteredTotal"),
  requestFilteredLinked: byId("requestFilteredLinked"),
  requestFilteredUnlinked: byId("requestFilteredUnlinked"),
  workFilteredTotal: byId("workFilteredTotal"),
  workFilteredReady: byId("workFilteredReady"),
  workFilteredBlocked: byId("workFilteredBlocked"),
  linkFilteredValid: byId("linkFilteredValid"),
  linkFilteredMissing: byId("linkFilteredMissing"),
  linkFilteredUnlinked: byId("linkFilteredUnlinked"),
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
  healthCodeFilter: byId("healthCodeFilter"),
  healthCodeFilterButton: byId("healthCodeFilterButton"),
  healthCodeFilterLabel: byId("healthCodeFilterLabel"),
  healthCodeFilterMenu: byId("healthCodeFilterMenu"),
  resetHealthFiltersButton: byId("resetHealthFiltersButton"),
  healthFindingCount: byId("healthFindingCount"),
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
let currentDataSignature = "";
let dataLoadPromise = null;
let loadQueued = false;
let queuedLoadSource = "live";
let eventSource = null;
let retryTimer = null;
let retryDelay = 1000;
let liveStatusTimer = null;
let fallbackTimer = null;

function normalise(value) {
  return String(value ?? "").toLowerCase();
}

function label(value) {
  return value == null || value === "" ? "unspecified" : String(value);
}

function humanKey(value) {
  return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countLabel(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function releaseEntity(id) {
  const normalisedId = String(id).toUpperCase();
  const request = state.data.requests.find((item) => item.id === normalisedId);
  if (request) return { kind: "request", item: request };
  const workItem = state.data.backlog.find((item) => item.id === normalisedId);
  return workItem ? { kind: "work", item: workItem } : null;
}

function appendReleaseInline(container, value, allowBold = true, linkIds = true) {
  const text = String(value ?? "");
  const ids = state.data.project.manifest.ids || {};
  const requestPattern = `${escapeRegExp(ids.request_prefix)}-\\d+`;
  const workPattern = `${escapeRegExp(ids.work_prefix)}-\\d+[A-Z]?`;
  const tokenParts = ["`[^`\\n]+`"];
  if (allowBold) tokenParts.push("\\*\\*[^\\n]+?\\*\\*");
  if (linkIds) tokenParts.push(`\\b(?:${requestPattern}|${workPattern})\\b`);
  const tokens = new RegExp(tokenParts.join("|"), "gi");
  let cursor = 0;
  let match;
  while ((match = tokens.exec(text))) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else if (allowBold && token.startsWith("**") && token.endsWith("**")) {
      const strong = document.createElement("strong");
      appendReleaseInline(strong, token.slice(2, -2), false, linkIds);
      container.append(strong);
    } else {
      const entity = releaseEntity(token);
      if (!entity) container.append(document.createTextNode(token));
      else {
        const button = document.createElement("button");
        button.className = "inline-link release-id-link";
        button.type = "button";
        button.textContent = entity.item.id;
        button.setAttribute("aria-label", `Open ${entity.kind === "request" ? "Request" : "Work item"} ${entity.item.id}`);
        button.addEventListener("click", () => applyFilters(entity.kind === "request"
          ? { view: "requests", requestIds: [entity.item.id] }
          : { view: "backlog", backlogItemIds: [entity.item.id] }));
        container.append(button);
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}

function renderReleaseMarkdown(value) {
  const fragment = document.createDocumentFragment();
  const lines = String(value ?? "").split(/\r?\n/);
  let paragraphLines = [];
  let currentList = null;
  let currentListTag = "";
  let currentItem = null;

  function flushParagraph() {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement("p");
    appendReleaseInline(paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
    paragraphLines = [];
  }

  function closeList() {
    currentList = null;
    currentListTag = "";
    currentItem = null;
  }

  function appendTable(parsed) {
    const wrapper = document.createElement("div");
    wrapper.className = "release-table-wrap";
    const table = document.createElement("table");
    table.className = "release-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    parsed.headers.forEach((value, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.className = `align-${parsed.alignments[index]}`;
      appendReleaseInline(cell, value);
      headRow.append(cell);
    });
    head.append(headRow);
    table.append(head);
    if (parsed.rows.length) {
      const body = document.createElement("tbody");
      for (const row of parsed.rows) {
        const tableRow = document.createElement("tr");
        row.forEach((value, index) => {
          const cell = document.createElement("td");
          cell.className = `align-${parsed.alignments[index]}`;
          appendReleaseInline(cell, value);
          tableRow.append(cell);
        });
        body.append(tableRow);
      }
      table.append(body);
    }
    wrapper.append(table);
    fragment.append(wrapper);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed || /^---+$/.test(trimmed)) {
      flushParagraph();
      closeList();
      continue;
    }
    const parsedTable = globalThis.ReleaseMarkdown.parseTable(lines, index);
    if (parsedTable) {
      flushParagraph();
      closeList();
      appendTable(parsedTable);
      index = parsedTable.nextIndex - 1;
      continue;
    }
    const listMatch = rawLine.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const listTag = listMatch[2] ? "ol" : "ul";
      if (!currentList || currentListTag !== listTag) {
        currentList = document.createElement(listTag);
        currentListTag = listTag;
        fragment.append(currentList);
      }
      currentItem = document.createElement("li");
      appendReleaseInline(currentItem, listMatch[3]);
      currentList.append(currentItem);
      continue;
    }
    if (currentList && currentItem && /^\s+/.test(rawLine)) {
      currentItem.append(document.createTextNode(" "));
      appendReleaseInline(currentItem, trimmed);
      continue;
    }
    closeList();
    paragraphLines.push(trimmed);
  }
  flushParagraph();
  return fragment;
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
  if (item.severity && item.code) {
    const healthPreferred = ["title", "severity", "action_type", "meaning", "recommended_action", "command", "message", "code", "entity_type", "entity_id"];
    return [...new Set([...healthPreferred, ...Object.keys(item).sort()])]
      .filter((key) => Object.prototype.hasOwnProperty.call(item, key))
      .filter((key) => item[key] !== "" && item[key] != null);
  }
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
  if (kind === "health" && key === "entity_id" && value && ["request", "work"].includes(item.entity_type)) {
    const requestEntity = item.entity_type === "request";
    const button = document.createElement("button");
    button.className = "inline-link";
    button.type = "button";
    button.textContent = value;
    button.addEventListener("click", () => {
      closeDetailsModal();
      applyFilters(requestEntity
        ? { view: "requests", requestIds: [value] }
        : { view: "backlog", backlogItemIds: [value] });
    });
    return button;
  }
  if (kind === "health" && key === "command") {
    const code = document.createElement("code");
    code.className = "command-value";
    code.textContent = value;
    return code;
  }
  return document.createTextNode(formatDetailValue(value));
}

function detailIdentity(item, kind) {
  return kind === "health"
    ? [item.code, item.entity_type, item.entity_id].join("\u001f")
    : item.id;
}

function findEntityCard(kind, key) {
  return [...document.querySelectorAll("[data-entity-kind][data-entity-key]")]
    .find((element) => element.dataset.entityKind === kind && element.dataset.entityKey === key);
}

function renderDetailsModal(item, kind, focus = false) {
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
    term.textContent = kind === "health" && key === "message"
      ? "Observed"
      : kind === "health" && key === "action_type"
        ? "Response"
        : humanKey(key === "backlog_items" ? "work_items" : key);
    const description = document.createElement("dd");
    description.append(renderDetailValue(item[key], key, item, kind));
    row.append(term, description);
    definition.append(row);
  }
  elements.modalBody.append(definition);
  elements.detailsModal.classList.remove("is-hidden");
  document.body.classList.add("modal-open");
  if (focus) elements.modalCloseButton.focus();
}

function openDetailsModal(item, kind, trigger = document.activeElement) {
  lastFocusedElement = trigger;
  state.openDetail = { kind, identity: detailIdentity(item, kind) };
  renderDetailsModal(item, kind, true);
}

function reconcileOpenDetailsModal() {
  if (!state.openDetail || elements.detailsModal.classList.contains("is-hidden")) return;
  const collections = {
    request: state.data.requests,
    work: state.data.backlog,
    health: state.data.health.findings,
  };
  const item = collections[state.openDetail.kind]
    ?.find((entry) => detailIdentity(entry, state.openDetail.kind) === state.openDetail.identity);
  if (item) {
    renderDetailsModal(item, state.openDetail.kind);
    return;
  }
  elements.modalTags.replaceChildren();
  elements.modalBody.replaceChildren();
  const message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = "This record is no longer present in the latest project model.";
  elements.modalBody.append(message);
}

function closeDetailsModal() {
  if (elements.detailsModal.classList.contains("is-hidden")) return;
  elements.detailsModal.classList.add("is-hidden");
  document.body.classList.remove("modal-open");
  state.openDetail = null;
  if (lastFocusedElement?.isConnected) lastFocusedElement.focus();
}

function makeClickableCard(card, item, kind) {
  card.classList.add("clickable-card");
  card.dataset.entityKind = kind;
  card.dataset.entityKey = detailIdentity(item, kind);
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
  const summaryText = truncate(releaseItem?.description || item.summary);
  if (releaseItem) {
    summary.classList.add("release-item-summary");
    appendReleaseInline(summary, summaryText, true, false);
  } else summary.textContent = summaryText;
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

function makeLinkStateTag(text, stateName) {
  const tag = makeTag(text);
  tag.classList.add("link-state", `link-state-${stateName}`);
  return tag;
}

function renderLinkedWorkItem(item) {
  const button = document.createElement("button");
  button.className = "link-item-row";
  button.type = "button";
  button.setAttribute("aria-label", `Open Work item ${item.id}`);
  const id = document.createElement("span");
  id.className = "item-id";
  id.textContent = item.id;
  const copy = document.createElement("span");
  copy.className = "link-item-copy";
  const title = document.createElement("strong");
  title.textContent = item.title || "Untitled work item";
  const context = document.createElement("span");
  context.className = "meta";
  context.textContent = [item.type, item.capability].filter(Boolean).join(" · ");
  copy.append(title, context);
  button.append(id, copy, makeTag(item.status, "status"));
  button.addEventListener("click", () => applyFilters({ view: "backlog", backlogItemIds: [item.id] }));
  return button;
}

function renderLinkNotice(id, message, stateName) {
  const row = document.createElement("div");
  row.className = `link-item-row link-notice link-notice-${stateName}`;
  if (!id) row.classList.add("link-notice-no-id");
  if (id) {
    const idNode = document.createElement("span");
    idNode.className = "item-id";
    idNode.textContent = id;
    row.append(idNode);
  }
  const copy = document.createElement("span");
  copy.className = "link-notice-copy";
  copy.textContent = message;
  row.append(copy, makeLinkStateTag(stateName === "missing" ? "missing" : stateName === "intentional" ? "intentional" : "needs link", stateName));
  return row;
}

function renderLinkCard(request) {
  const card = document.createElement("article");
  card.className = "item-card link-card";
  const top = document.createElement("div");
  top.className = "item-topline";
  const requestLink = document.createElement("button");
  requestLink.className = "inline-link item-id";
  requestLink.type = "button";
  requestLink.textContent = request.id;
  requestLink.setAttribute("aria-label", `Open request details for ${request.id}`);
  requestLink.addEventListener("click", () => openDetailsModal(request, "request", requestLink));
  const title = document.createElement("h3");
  title.className = "item-title";
  title.textContent = request.title || "Untitled request";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = request.section || "";
  top.append(requestLink, title, meta);
  const summary = document.createElement("p");
  summary.className = "item-summary";
  summary.textContent = truncate(request.summary, 180);
  const tags = document.createElement("div");
  tags.className = "tag-row";
  tags.append(makeTag(request.status, "status"), makeTag(request.type, "type"), makeTag(request.priority, "priority"));
  const linkedItems = (request.resolved_backlog_items || [])
    .map((id) => state.data.backlog.find((item) => item.id === id))
    .filter(Boolean);
  const missingIds = request.unresolved_work_items || [];
  if (linkedItems.length) tags.append(makeLinkStateTag(countLabel(linkedItems.length, "linked work item"), "linked"));
  if (request.work_items_explicitly_none) tags.append(makeLinkStateTag("no work required", "intentional"));
  if (missingIds.length) tags.append(makeLinkStateTag(countLabel(missingIds.length, "missing reference"), "missing"));
  if (!linkedItems.length && !missingIds.length && !request.work_items_explicitly_none) tags.append(makeLinkStateTag("unlinked", "unlinked"));

  const relationships = document.createElement("div");
  relationships.className = "link-relationships";
  const relationshipHeading = document.createElement("h4");
  relationshipHeading.textContent = "Work items";
  relationships.append(relationshipHeading);
  for (const item of linkedItems) relationships.append(renderLinkedWorkItem(item));
  for (const id of missingIds) relationships.append(renderLinkNotice(id, "Referenced by this request, but no matching work item exists.", "missing"));
  if (!linkedItems.length && !missingIds.length) {
    relationships.append(request.work_items_explicitly_none
      ? renderLinkNotice("", "This request is explicitly marked as requiring no delivery work.", "intentional")
      : renderLinkNotice("", "No work item is linked. Review this request during refinement.", "unlinked"));
  }
  card.append(top, summary, tags, relationships);
  return card;
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

function requestNeedsWorkItem(request, includeMissing = true) {
  if (["duplicate", "rejected"].includes(request.status) || request.work_items_explicitly_none) return false;
  if (request.resolved_backlog_items?.length) return false;
  return includeMissing || !(request.unresolved_work_items?.length);
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

function releaseDate(value) {
  const stored = state.data.release_dates?.[String(value).replace(/^v/i, "")];
  const match = stored?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
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
    const labelNode = document.createElement("span");
    labelNode.className = "bar-label";
    labelNode.append(nameNode);
    const detail = options.detailFor?.(name);
    if (detail) {
      const detailNode = document.createElement("span");
      detailNode.className = "bar-detail";
      detailNode.textContent = detail;
      labelNode.append(detailNode);
    }
    const track = document.createElement("span");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = ["bar-fill", options.kind && `${options.kind}-${normalise(name).replace(/[^a-z0-9]+/g, "-")}`].filter(Boolean).join(" ");
    fill.style.width = `${Math.max((count / max) * 100, 1)}%`;
    track.append(fill);
    const countNode = document.createElement("strong");
    countNode.textContent = count;
    row.append(labelNode, track, countNode);
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
    input.dataset.filterMenu = menu.id;
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
  const status = release.status || "none";
  const statusClass = `status-${normalise(status).replace(/[^a-z0-9]+/g, "-")}`;
  elements.releaseStatusBadge.className = `tag ${statusClass}`;
  elements.releaseStatusBadge.textContent = status;
  elements.headerReleaseBadge.className = `tag header-release-badge ${statusClass}`;
  elements.headerReleaseBadge.disabled = false;
  elements.headerReleaseBadge.setAttribute("aria-label", `Active release status: ${humanKey(status)}. Open Active Release.`);
  elements.headerReleaseBadge.title = [release.version, `${release.work_items.length} selected work item${release.work_items.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  elements.headerReleaseStatus.textContent = humanKey(status);
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
    const text = document.createElement("div");
    text.className = "release-goal-copy";
    text.append(renderReleaseMarkdown(release.release_goal));
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
    content.append(renderReleaseMarkdown(value));
    section.append(heading, content);
    elements.releaseSections.append(section);
  }
}

function renderHealth() {
  const health = state.data.health;
  const codes = uniqueValues(health.findings, "code");
  const errors = makeTag(countLabel(health.summary.errors, "error"));
  errors.classList.add("severity-error");
  const warnings = makeTag(countLabel(health.summary.warnings, "warning"));
  warnings.classList.add("severity-warning");
  const recommendations = makeTag(countLabel(health.summary.recommendations ?? 0, "recommendation"));
  recommendations.classList.add("severity-recommendation");
  elements.healthSummary.replaceChildren(errors, warnings, recommendations);
  setMultiOptions(elements.healthCodeFilterMenu, state.healthCodes, codes);
  elements.healthCodeFilterLabel.textContent = selectedLabel(state.healthCodes, "All codes");
  elements.healthFilters.replaceChildren();
  for (const severity of ["error", "warning", "recommendation"]) {
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
  const findings = health.findings.filter((entry) =>
    state.healthSeverities.has(entry.severity)
    && (!state.healthCodes.size || state.healthCodes.has(entry.code))
  );
  elements.healthFindingCount.textContent = `${findings.length} shown of ${health.findings.length}`;
  if (!findings.length) elements.healthList.append(emptyNode(health.summary.total ? "No findings match the current Health filters." : "No conformance findings."));
  for (const item of findings) {
    const card = document.createElement("article");
    card.className = `item-card health-card severity-${item.severity}`;
    const top = document.createElement("div");
    top.className = "item-topline";
    const code = document.createElement("span");
    code.className = "item-id";
    code.textContent = item.code;
    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = item.title;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = item.entity_id || "project";
    top.append(code, title, meta);
    const meaning = document.createElement("p");
    meaning.className = "item-summary health-meaning";
    meaning.textContent = item.meaning;
    const message = document.createElement("p");
    message.className = "item-summary health-observed";
    message.textContent = `Observed: ${truncate(item.message, 220)}`;
    const nextStep = document.createElement("p");
    nextStep.className = "health-next-step";
    const nextStepLabel = document.createElement("strong");
    nextStepLabel.textContent = `${humanKey(item.action_type || "action")}: `;
    nextStep.append(nextStepLabel, document.createTextNode(truncate(item.recommended_action, 320)));
    if (item.command) {
      const command = document.createElement("code");
      command.className = "health-command";
      command.textContent = item.command;
      nextStep.append(" ", command);
    }
    const tags = document.createElement("div");
    tags.className = "tag-row";
    tags.append(
      makeTag(item.severity, "severity"),
      makeTag(item.action_type || "action"),
      makeTag(item.entity_type || "project"),
    );
    card.append(top, meaning, message, nextStep, tags);
    elements.healthList.append(makeClickableCard(card, item, "health"));
  }
}

function setPage(page) {
  state.page = page;
  const charts = page === "charts";
  elements.moreChartsPage.classList.toggle("is-hidden", !charts);
  elements.backToViewerLink.classList.toggle("is-hidden", !charts);
  for (const element of [elements.dashboardView, elements.toolbar, elements.activeFilters, elements.requestsView, elements.backlogView, elements.linksView, elements.releaseView, elements.healthView]) element.classList.toggle("force-hidden", charts);
}

function setView(view, push = true) {
  if (state.page === "charts") setPage("viewer");
  state.view = ["dashboard", "requests", "backlog", "links", "release", "health"].includes(view) ? view : "dashboard";
  state.page = "viewer";
  for (const button of document.querySelectorAll(".primary-tab")) button.classList.toggle("is-active", button.dataset.view === state.view);
  elements.dashboardView.classList.toggle("is-hidden", state.view !== "dashboard");
  elements.requestsView.classList.toggle("is-hidden", state.view !== "requests");
  elements.backlogView.classList.toggle("is-hidden", state.view !== "backlog");
  elements.linksView.classList.toggle("is-hidden", state.view !== "links");
  elements.releaseView.classList.toggle("is-hidden", state.view !== "release");
  elements.healthView.classList.toggle("is-hidden", state.view !== "health");
  const working = ["requests", "backlog", "links"].includes(state.view);
  elements.toolbar.classList.toggle("is-hidden", !working);
  elements.activeFilters.classList.toggle("is-hidden", !working);
  if (push) syncUrl("push");
}

function syncUrl(mode = "replace") {
  const params = new URLSearchParams();
  if (state.view !== "dashboard") params.set("view", state.view);
  if (state.query) params.set("q", state.query);
  if (state.statuses.size) params.set("status", [...state.statuses].join(","));
  if (state.types.size) params.set("type", [...state.types].join(","));
  if (state.capabilities.size) params.set("capability", [...state.capabilities].join(","));
  if (state.requestIds.size) params.set("request", [...state.requestIds].join(","));
  if (state.backlogItemIds.size) params.set("work", [...state.backlogItemIds].join(","));
  if (state.deliveredRelease) params.set("release", state.deliveredRelease);
  if (state.unlinkedOnly) params.set("unlinked", "1");
  if (state.healthCodes.size) params.set("health-code", [...state.healthCodes].join(","));
  const url = `${location.pathname}${params.size ? `?${params}` : ""}`;
  history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
}

function loadUrlState() {
  const params = new URLSearchParams(location.search);
  const list = (name) => new Set((params.get(name) || "").split(",").filter(Boolean));
  state.view = params.get("view") || "dashboard";
  state.query = params.get("q") || "";
  state.statuses = list("status");
  state.types = list("type");
  state.capabilities = list("capability");
  state.requestIds = list("request");
  state.backlogItemIds = list("work");
  state.deliveredRelease = params.get("release") || "";
  state.unlinkedOnly = params.get("unlinked") === "1";
  state.healthCodes = list("health-code");
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
  elements.linkCount.textContent = `${filteredRequests.length} shown of ${requests.length}`;
  elements.requestFilteredTotal.textContent = filteredRequests.length;
  elements.requestFilteredLinked.textContent = filteredRequests.filter((request) => request.resolved_backlog_items?.length).length;
  elements.requestFilteredUnlinked.textContent = filteredRequests.filter((request) => requestNeedsWorkItem(request)).length;
  elements.workFilteredTotal.textContent = filteredBacklog.length;
  elements.workFilteredReady.textContent = filteredBacklog.filter((item) => item.status === "ready").length;
  elements.workFilteredBlocked.textContent = filteredBacklog.filter((item) => item.status === "blocked").length;
  elements.linkFilteredValid.textContent = filteredRequests.reduce((count, request) => count + (request.resolved_backlog_items?.length || 0), 0);
  elements.linkFilteredMissing.textContent = filteredRequests.reduce((count, request) => count + (request.unresolved_work_items?.length || 0), 0);
  elements.linkFilteredUnlinked.textContent = filteredRequests.filter((request) => requestNeedsWorkItem(request, false)).length;

  renderChart(elements.requestStatusChart, countBy(requests, "status"), { kind: "status", onClick: (status) => applyFilters({ view: "requests", statuses: [status] }) });
  renderChart(elements.backlogStatusChart, countBy(backlog, "status"), { kind: "status", onClick: (status) => applyFilters({ view: "backlog", statuses: [status] }) });
  const releases = {};
  for (const request of requests.filter((item) => ["done", "partially-done"].includes(item.status))) for (const value of completionBuckets(request)) releases[value] = (releases[value] || 0) + 1;
  renderChart(elements.requestReleaseChart, releases, { kind: "release", limit: Infinity, sortEntries: releaseSort, detailFor: releaseDate, onClick: (release) => applyFilters({ view: "requests", deliveredRelease: release }) });
  renderChart(elements.capabilityChart, countBy(backlog, "capability"), { kind: "capability", onClick: (capability) => applyFilters({ view: "backlog", capabilities: [capability] }) });
  renderChart(elements.requestTypeChart, countBy(requests, "type"), { kind: "type" });
  renderChart(elements.requestPriorityChart, countBy(requests, "priority"), { kind: "priority" });
  renderChart(elements.requestSectionChart, countBy(requests, "section"));
  renderChart(elements.requestLinkCoverageChart, requests.reduce((counts, request) => {
    const key = request.resolved_backlog_items.length ? "Linked to work item" : request.work_items_explicitly_none ? "No work required" : "No work item";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}));
  renderStackedChart(elements.releaseTypeChart, groupedByCompletion(requests, "type"), { kind: "type" });
  renderStackedChart(elements.releasePriorityChart, groupedByCompletion(requests, "priority"), { kind: "priority" });
  renderStackedChart(elements.releaseCompletenessChart, groupedByCompletion(requests, "delivery_status"), { kind: "status" });
  renderChart(elements.backlogTypeChart, countBy(backlog, "type"), { kind: "type" });
  renderChart(elements.backlogPriorityChart, countBy(backlog, "priority"), { kind: "priority" });
  renderChart(elements.agentChart, countArrayValues(backlog, "suggested_agents"));
  renderChart(elements.backlogSourceCoverageChart, backlog.reduce((counts, item) => {
    const key = item.has_request ? "Has matching request" : "No matching request";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}));
  renderRelease();
  renderHealth();
  if (state.page === "viewer") setView(state.view, false);
}

function dataSignature(payload) {
  return JSON.stringify({
    project: payload.project,
    requests: payload.requests,
    backlog: payload.backlog,
    release_dates: payload.release_dates,
    active_release: payload.active_release,
    health: payload.health,
    widgets: payload.widgets,
    summaries: payload.summaries,
  });
}

function setLiveStatus(status, text, options = {}) {
  clearTimeout(liveStatusTimer);
  elements.liveStatusButton.className = `live-status state-${status}`;
  elements.liveStatusText.textContent = text;
  elements.liveStatusButton.title = options.title || "Click to pause live updates";
  elements.liveStatusButton.setAttribute("aria-pressed", String(!state.livePaused));
  if (options.returnToLive) {
    liveStatusTimer = setTimeout(() => {
      if (!state.livePaused && eventSource?.readyState === EventSource.OPEN) setLiveStatus("live", "Live");
    }, options.returnToLive);
  }
}

function formatUpdateTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function setLoadedAt(primary, secondary = "") {
  elements.loadedModelText.textContent = primary;
  elements.loadedAtTime.textContent = secondary;
  elements.loadedAt.setAttribute("aria-label", [primary, secondary].filter(Boolean).join(" "));
}

function updateModel(payload, source) {
  const signature = dataSignature(payload);
  const changed = signature !== currentDataSignature;
  currentDataSignature = signature;
  state.data = payload;
  elements.projectTitle.textContent = payload.project.name;
  elements.projectDescription.textContent = payload.project.description;
  document.title = `${payload.project.name} · Work Management Viewer`;
  const loaded = new Date(payload.generated_at);
  setLoadedAt(`Loaded model v${payload.project.manifest.model_version}`, `at ${loaded.toLocaleString()}`);
  elements.loadedAt.classList.remove("load-error");
  elements.loadedAt.title = Object.values(payload.files).filter(Boolean).join("\n");
  if (changed) {
    const scroll = { left: window.scrollX, top: window.scrollY };
    const modalScroll = elements.detailsModal.querySelector(".modal-panel")?.scrollTop || 0;
    const focusId = document.activeElement?.id;
    const focusKey = document.activeElement?.dataset?.entityKey;
    const focusKind = document.activeElement?.dataset?.entityKind;
    const focusFilterMenu = document.activeElement?.dataset?.filterMenu;
    const focusFilterValue = focusFilterMenu ? document.activeElement.value : null;
    const triggerKey = lastFocusedElement?.dataset?.entityKey;
    const triggerKind = lastFocusedElement?.dataset?.entityKind;
    render();
    if (triggerKey && triggerKind) {
      lastFocusedElement = findEntityCard(triggerKind, triggerKey) || lastFocusedElement;
    }
    reconcileOpenDetailsModal();
    const modalPanel = elements.detailsModal.querySelector(".modal-panel");
    if (modalPanel) modalPanel.scrollTop = modalScroll;
    window.scrollTo(scroll);
    if (focusId && !state.openDetail) document.getElementById(focusId)?.focus();
    else if (focusFilterMenu && focusFilterValue && !state.openDetail) {
      document.querySelector(`#${CSS.escape(focusFilterMenu)} input[value="${CSS.escape(focusFilterValue)}"]`)?.focus();
    } else if (focusKey && focusKind && !state.openDetail) {
      findEntityCard(focusKind, focusKey)?.focus();
    }
  }
  if (["live", "fallback"].includes(source) && changed) {
    setLiveStatus("updated", `Updated ${formatUpdateTime(loaded)}`, { returnToLive: 2500 });
  } else if (source === "live") setLiveStatus("live", "Live");
  return changed;
}

async function loadData(source = "fallback") {
  if (dataLoadPromise) {
    loadQueued = true;
    queuedLoadSource = source === "live" ? "live" : queuedLoadSource;
    return dataLoadPromise;
  }
  if (source === "initial") setLoadedAt("Reading manifest and work files…");
  if (source === "live") setLiveStatus("updating", "Updating…");
  dataLoadPromise = (async () => {
    const response = await fetch(`/api/data?now=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error([payload.error, ...(payload.details || [])].join(" · "));
    return updateModel(payload, source);
  })();
  try {
    return await dataLoadPromise;
  } catch (error) {
    if (source === "initial") throw error;
    setLiveStatus("unavailable", "Update failed", { title: `${error.message}. The last valid model is still displayed.` });
    console.error(error);
    return false;
  } finally {
    dataLoadPromise = null;
    if (loadQueued) {
      const nextSource = queuedLoadSource;
      loadQueued = false;
      queuedLoadSource = "live";
      void loadData(nextSource);
    }
  }
}

function scheduleFallbackCheck() {
  clearTimeout(fallbackTimer);
  if (state.livePaused || document.hidden) return;
  fallbackTimer = setTimeout(() => {
    void loadData("fallback");
    scheduleFallbackCheck();
  }, 60000);
}

function disconnectLiveUpdates() {
  clearTimeout(retryTimer);
  clearTimeout(fallbackTimer);
  eventSource?.close();
  eventSource = null;
}

function connectLiveUpdates() {
  if (state.livePaused || document.hidden || eventSource) return;
  setLiveStatus("connecting", "Connecting…");
  const source = new EventSource("/api/events");
  eventSource = source;
  source.addEventListener("ready", (event) => {
    if (source !== eventSource) return;
    retryDelay = 1000;
    const ready = JSON.parse(event.data);
    if (!elements.liveStatusButton.classList.contains("state-updating")
      && !elements.liveStatusButton.classList.contains("state-updated")) {
      setLiveStatus(ready.watching ? "live" : "unavailable", ready.watching ? "Live" : "Checking every minute", {
        title: ready.watching ? "Live updates are connected. Click to pause." : "Filesystem watching is unavailable; periodic checks remain active.",
      });
    }
    void loadData("fallback");
    scheduleFallbackCheck();
  });
  source.addEventListener("change", () => {
    if (!state.livePaused && !document.hidden) void loadData("live");
  });
  source.addEventListener("unavailable", () => {
    setLiveStatus("unavailable", "Checking every minute", { title: "Filesystem watching stopped; periodic checks remain active." });
    scheduleFallbackCheck();
  });
  source.onerror = () => {
    if (source !== eventSource || state.livePaused) return;
    source.close();
    eventSource = null;
    setLiveStatus("retrying", "Reconnecting…");
    retryTimer = setTimeout(connectLiveUpdates, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
    scheduleFallbackCheck();
  };
}

function toggleFilter(filter, button) {
  const open = filter.classList.toggle("is-open");
  button.setAttribute("aria-expanded", String(open));
}

function closeFilters(except = null) {
  for (const [filter, button] of [
    [elements.statusFilter, elements.statusFilterButton],
    [elements.typeFilter, elements.typeFilterButton],
    [elements.healthCodeFilter, elements.healthCodeFilterButton],
  ]) {
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
  setLoadedAt(error.message);
  elements.loadedAt.classList.add("load-error");
  setLiveStatus("unavailable", "Unable to load", { title: error.message });
  console.error(error);
}

loadUrlState();
elements.liveStatusButton.addEventListener("click", () => {
  state.livePaused = !state.livePaused;
  if (state.livePaused) {
    disconnectLiveUpdates();
    setLiveStatus("paused", "Paused", { title: "Live updates are paused. Click to resume." });
  } else {
    setLiveStatus("connecting", "Connecting…");
    connectLiveUpdates();
    void loadData("live");
  }
});
elements.searchInput.addEventListener("input", (event) => { state.query = event.target.value; renderAndSync(); });
elements.statusFilterButton.addEventListener("click", () => { closeFilters(elements.statusFilter); toggleFilter(elements.statusFilter, elements.statusFilterButton); });
elements.typeFilterButton.addEventListener("click", () => { closeFilters(elements.typeFilter); toggleFilter(elements.typeFilter, elements.typeFilterButton); });
elements.healthCodeFilterButton.addEventListener("click", () => { closeFilters(elements.healthCodeFilter); toggleFilter(elements.healthCodeFilter, elements.healthCodeFilterButton); });
elements.statusFilterMenu.addEventListener("change", (event) => handleMultiFilter(event, state.statuses));
elements.typeFilterMenu.addEventListener("change", (event) => handleMultiFilter(event, state.types));
elements.healthCodeFilterMenu.addEventListener("change", (event) => handleMultiFilter(event, state.healthCodes));
elements.resetFiltersButton.addEventListener("click", () => {
  state.hasAppliedDefaultStatuses = true;
  applyFilters({ view: state.view, statuses: [...defaultStatuses()] });
});
elements.resetHealthFiltersButton.addEventListener("click", () => {
  state.healthSeverities = new Set(["error", "warning", "recommendation"]);
  state.healthCodes.clear();
  closeFilters();
  renderAndSync();
});
elements.moreChartsLink.addEventListener("click", () => {
  closeFilters();
  setPage("charts");
  render();
  window.scrollTo({ top: 0, left: 0 });
});
elements.backToViewerLink.addEventListener("click", () => {
  setPage("viewer");
  setView(state.view, false);
  render();
  window.scrollTo({ top: 0, left: 0 });
});
byId("unlinkedRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", unlinkedOnly: true }));
byId("inboxRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", statuses: ["inbox"] }));
byId("activeReleaseRequestsButton").addEventListener("click", () => setView("release"));
elements.headerReleaseBadge.addEventListener("click", () => { setView("release"); render(); });
byId("openRequestsButton").addEventListener("click", () => applyFilters({ view: "requests", statuses: ["needs-refinement", "refined", "partially-done", "blocked"] }));
byId("healthErrorsButton").addEventListener("click", () => { state.healthSeverities = new Set(["error"]); setView("health"); render(); });
byId("healthWarningsButton").addEventListener("click", () => { state.healthSeverities = new Set(["warning"]); setView("health"); render(); });
elements.modalCloseButton.addEventListener("click", closeDetailsModal);
elements.detailsModal.addEventListener("click", (event) => { if (event.target === elements.detailsModal) closeDetailsModal(); });
for (const button of document.querySelectorAll(".primary-tab")) button.addEventListener("click", () => { setView(button.dataset.view); render(); });
document.addEventListener("click", (event) => {
  if (![elements.statusFilter, elements.typeFilter, elements.healthCodeFilter].some((filter) => filter.contains(event.target))) closeFilters();
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetailsModal(); });
window.addEventListener("popstate", () => { loadUrlState(); if (state.data) render(); });
document.addEventListener("visibilitychange", () => {
  if (state.livePaused) return;
  if (document.hidden) disconnectLiveUpdates();
  else {
    connectLiveUpdates();
    void loadData("live");
  }
});

setPage("viewer");
setView(state.view, false);
loadData("initial").then(connectLiveUpdates).catch(showError);
