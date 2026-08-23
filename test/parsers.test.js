const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { loadProjectConfiguration } = require("../src/config");
const { parseActiveRelease, parseBacklog, parseCompletionValues, parseReleaseDates, parseRequests, parseWorkItemReferences } = require("../src/parsers");

const fixtureRoot = path.join(__dirname, "fixtures", "custom-project");

test("parses custom prefixes, work links, and multiple completion values", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const source = await fs.readFile(path.join(fixtureRoot, "work", "requests.md"), "utf8");
  const document = parseRequests(source, config.ids);
  assert.equal(document.items.length, 2);
  const done = document.items.find((request) => request.id === "ASK-0001");
  assert.deepEqual(done.work_items, ["TASK-0001", "TASK-0002"]);
  assert.deepEqual(done.done_in.map((entry) => [entry.kind, entry.value]), [["release", "v1.2.3"], ["spike", "TASK-0002"]]);
  assert.equal(document.items.find((request) => request.id === "ASK-0002").summary, "This summary includes a sentence with Word: value and must stay intact.");
});

test("ignores request-shaped examples inside Markdown fences", () => {
  const ids = { requestPattern: /^ASK-\d+$/i, workPrefix: "TASK" };
  const document = parseRequests(`
# Requests

## Inbox / needs refinement

\`\`\`text
### ASK-0001
Request ID: ASK-0001
Title: Example only
Type: <type>
Status: <status>
Priority: <priority>
\`\`\`

## Done

### ASK-0001
Request ID: ASK-0001
Title: The real request
Type: feature
Status: done
Priority: low
Summary: Real data.
`, ids);

  assert.equal(document.items.length, 1);
  assert.equal(document.items[0].title, "The real request");
  assert.equal(document.items[0].type, "feature");
  assert.deepEqual(document.metadata.sections.map((section) => section.title), ["Inbox / needs refinement", "Done"]);
});

test("uses YAML semantics for folded and literal block scalars", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const source = await fs.readFile(path.join(fixtureRoot, "work", "backlog.yml"), "utf8");
  const document = parseBacklog(source, config.ids);
  assert.equal(document.items[0].summary, "Fold this text without leaking the YAML scalar indicator.");
  assert.equal(document.items[1].summary, "Preserve this first line.\nPreserve this second line.\n");
});

test("parses hyphen release headings and pipe-delimited item fields", async () => {
  const config = await loadProjectConfiguration(path.join(fixtureRoot, "project.yml"));
  const source = await fs.readFile(path.join(fixtureRoot, "work", "active-release.md"), "utf8");
  const release = parseActiveRelease(source, config.ids);
  assert.equal(release.status, "proposed");
  assert.equal(release.branch, "fixture-branch");
  assert.equal(release.release_goal, "Exercise the parser across multiple lines without losing text.");
  assert.deepEqual(release.request_ids, ["ASK-0001"]);
  assert.equal(release.work_items[0].status, "ready");
});

test("parses mixed legacy and current release IDs only from selected work items", () => {
  const ids = { requestPattern: /^ASK-\d+$/i, workPrefix: "TASK" };
  const release = parseActiveRelease(`
# Active Release

Status: approved

## Selected work items

### BUG-058 — Preserve a legacy ID
Source: ASK-0001 | Type: bug | Priority: high | Status: ready

### TASK-0003 - Use the current ID format
Source: ASK-0002 | Type: feature | Priority: medium | Status: ready

### UNKNOWN-999 — Retain an unresolved ID for health reporting
Status: ready

## Decisions

### TASK-0004 — This is a subsection, not a selected item
`, ids);

  assert.deepEqual(release.work_items.map((item) => item.id), ["BUG-058", "TASK-0003", "UNKNOWN-999"]);
  assert.deepEqual(release.request_ids, ["ASK-0001", "ASK-0002"]);
  assert.match(release.section_text.decisions, /TASK-0004/);
});

test("classifies annotated releases and invalid legacy prose", () => {
  const ids = { workPrefix: "TASK" };
  const values = parseCompletionValues("v1.2.3 (partial), spike completed yesterday", ids);
  assert.equal(values[0].kind, "release");
  assert.equal(values[0].annotation, "partial");
  assert.equal(values[1].kind, "invalid");
});

test("classifies an unquoted spike mapping as a non-scalar completion", () => {
  const [completion] = parseCompletionValues({ SPIKE: "TASK-0002" }, { workPrefix: "TASK" });
  assert.equal(completion.kind, "invalid");
  assert.equal(completion.non_scalar, true);
  assert.match(completion.raw, /SPIKE: TASK-0002/);
});

test("parses release dates from common changelog heading styles", () => {
  const dates = parseReleaseDates(`
## v2.0.0 — 2026-08-18
## [1.9.0] - 2026-08-11
## v1.8.0 (2026-08-04)
## v1.7.0
`);
  assert.deepEqual(dates, {
    "2.0.0": "2026-08-18",
    "1.9.0": "2026-08-11",
    "1.8.0": "2026-08-04",
  });
});

test("does not treat IDs inside work-item annotations as additional links", () => {
  const ids = { workPrefix: "TASK" };
  const parsed = parseWorkItemReferences("TASK-0001 (depends on TASK-0009), TASK-0002 (docs only)", ids);
  assert.deepEqual(parsed.references, ["TASK-0001", "TASK-0002"]);
  assert.equal(parseWorkItemReferences("none — decision only", ids).explicitlyNone, true);
});
