const CURRENT_MODEL_VERSION = 4;
const SUPPORTED_MODEL_VERSIONS = Object.freeze([3, 4]);
const SUPPORTED_BACKLOG_MODEL_VERSION = 1;

const REQUEST_STATUSES = [
  "inbox",
  "needs-refinement",
  "refined",
  "in-active-release",
  "partially-done",
  "done",
  "blocked",
  "deferred",
  "rejected",
  "duplicate",
];

const WORK_STATUSES = [
  "needs-refinement",
  "ready",
  "needs-audit",
  "shippable-candidate",
  "in-progress",
  "needs-test",
  "blocked",
  "done",
  "deferred",
];

const RELEASE_STATUSES = [
  "none",
  "proposed",
  "approved",
  "in-progress",
  "testing",
  "ready-for-release",
  "released",
  "abandoned",
  "cancelled",
];

const REQUEST_SECTIONS = [
  "Inbox / needs refinement",
  "Refined requests",
  "Done",
  "Deferred / rejected",
];

const REQUEST_FIELDS = new Map([
  ["request id", "request_id"],
  ["title", "title"],
  ["type", "type"],
  ["status", "status"],
  ["priority", "priority"],
  ["summary", "summary"],
  ["notes", "notes"],
  ["work items", "work_items_raw"],
  ["source", "source"],
  ["done in", "done_in_raw"],
  ["blocked on", "blocked_on"],
]);

module.exports = {
  CURRENT_MODEL_VERSION,
  RELEASE_STATUSES,
  REQUEST_FIELDS,
  REQUEST_SECTIONS,
  REQUEST_STATUSES,
  SUPPORTED_BACKLOG_MODEL_VERSION,
  SUPPORTED_MODEL_VERSIONS,
  WORK_STATUSES,
};
