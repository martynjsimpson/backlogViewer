const assert = require("node:assert/strict");
const test = require("node:test");
const YAML = require("yaml");
const {
  createHealthExport,
  exportFilename,
  filterHealthFindings,
  stringifyHealthExport,
} = require("../public/health-export");

const findings = [
  {
    severity: "error",
    code: "INVALID_REQUEST_STATUS",
    title: "Invalid request status",
    message: "Line one\nLine two: still invalid",
    meaning: "The status is not recognised.",
    action_type: "required",
    recommended_action: "Use a supported status.",
    entity_type: "request",
    entity_id: "ASK-0001",
  },
  {
    severity: "warning",
    code: "REQUEST_ID_FORMAT",
    title: "Review this request ID format",
    message: "ASK-1",
    meaning: "The ID does not use the configured padding.",
    action_type: "review",
    recommended_action: "Review the historical record before renaming it.",
    entity_type: "request",
    entity_id: "ASK-1",
    command: "/work-prune",
  },
  {
    severity: "recommendation",
    code: "PRUNING_HYGIENE",
    title: "Review old completed records for pruning",
    message: "42 old records",
    meaning: "This is optional maintenance.",
    action_type: "maintenance",
    recommended_action: "Run pruning when convenient.",
    entity_type: "project",
    entity_id: "Example Project",
  },
];

const data = {
  generated_at: "2026-08-23T12:00:00.000Z",
  project: { name: "Example Project", root: "/tmp/example project" },
  files: {
    manifest: "/tmp/example project/project.yml",
    requests: "/tmp/example project/requests.md",
    backlog: "/tmp/example project/backlog.yml",
    active_release: "/tmp/example project/active-release.md",
    spikes: "/tmp/example project/spikes",
    changelog: null,
  },
  health: { findings },
};

test("filters Health findings by the active severity and code selections", () => {
  assert.deepEqual(
    filterHealthFindings(findings, new Set(["error", "warning"]), new Set()),
    findings.slice(0, 2),
  );
  assert.deepEqual(
    filterHealthFindings(findings, ["error", "warning"], ["REQUEST_ID_FORMAT"]),
    [findings[1]],
  );
  assert.deepEqual(filterHealthFindings(findings, [], []), []);
});

test("creates a self-describing export containing only the supplied shown findings", () => {
  const shown = [findings[1]];
  const exported = createHealthExport(data, shown, {
    severities: new Set(["warning", "error"]),
    codes: new Set(["REQUEST_ID_FORMAT"]),
  }, "2026-08-23T13:45:00.000Z");

  assert.equal(exported.export_version, 1);
  assert.equal(exported.kind, "backlog-viewer-health-findings");
  assert.deepEqual(exported.filters, {
    severities: ["error", "warning"],
    code_mode: "selected",
    codes: ["REQUEST_ID_FORMAT"],
  });
  assert.equal(exported.shown_count, 1);
  assert.equal(exported.total_finding_count, 3);
  assert.deepEqual(exported.findings, shown);
});

test("serializes an export as valid YAML without losing multiline or punctuation-heavy values", () => {
  const shown = [findings[0]];
  const source = stringifyHealthExport(data, shown, {
    severities: ["error"],
    codes: [],
  }, "2026-08-23T13:45:00.000Z");
  const parsed = YAML.parse(source);

  assert.equal(parsed.filters.code_mode, "all");
  assert.deepEqual(parsed.filters.codes, []);
  assert.equal(parsed.findings[0].message, findings[0].message);
  assert.equal(parsed.source_files.changelog, null);
  assert.match(source, /kind: "backlog-viewer-health-findings"/);
});

test("builds a portable timestamped YAML filename", () => {
  assert.equal(
    exportFilename("Example Project!", "2026-08-23T13:45:12.345Z"),
    "health-findings-example-project-20260823-134512Z.yml",
  );
});
