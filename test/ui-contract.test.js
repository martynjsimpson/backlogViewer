const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test("uses the project-wide Dashboard as the default view", () => {
  const dashboardTab = html.indexOf('data-view="dashboard"');
  const requestsTab = html.indexOf('data-view="requests"');

  assert.ok(dashboardTab >= 0 && dashboardTab < requestsTab);
  assert.match(html, /class="primary-tab is-active" data-view="dashboard"/);
  assert.match(script, /view: "dashboard"/);
  assert.match(script, /params\.get\("view"\) \|\| "dashboard"/);
  assert.match(script, /countBy\(requests, "status"\)/);
  assert.match(script, /countBy\(backlog, "status"\)/);
  assert.doesNotMatch(script, /countBy\(filtered(?:Requests|Backlog), "status"\)/);
  assert.match(script, /detailFor: releaseDate/);
  assert.match(script, /release_dates: payload\.release_dates/);
});

test("shows the package-backed viewer version in the header", () => {
  assert.match(html, /Work Management Viewer - <span id="viewerVersion">v…<\/span>/);
  assert.match(script, /viewerVersion\.textContent = `v\$\{payload\.viewer\.version\}`/);
});

test("keeps filter-aware summaries on each record view", () => {
  for (const id of [
    "requestFilteredTotal",
    "requestFilteredLinked",
    "requestFilteredUnlinked",
    "workFilteredTotal",
    "workFilteredReady",
    "workFilteredBlocked",
    "linkFilteredValid",
    "linkFilteredMissing",
    "linkFilteredUnlinked",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(script, new RegExp(`elements\\.${id}\\.textContent`));
  }

  assert.match(html, /Filters affect records and the summary cards on this page\./);
});

test("offers a filter-aware YAML export from the Health view", () => {
  assert.match(html, /id="exportHealthButton"[^>]*disabled>Export shown \(\.yml\)<\/button>/);
  assert.match(html, /<script src="\/health-export\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
  assert.match(script, /const findings = filteredHealthFindings\(\)/);
  assert.match(script, /exportHealthButton\.addEventListener\("click", exportShownHealthFindings\)/);
});
