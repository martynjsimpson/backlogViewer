# Work Management Viewer

[![CI](https://github.com/martynjsimpson/backlogViewer/actions/workflows/ci.yml/badge.svg)](https://github.com/martynjsimpson/backlogViewer/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/martynjsimpson/backlogViewer)](https://github.com/martynjsimpson/backlogViewer/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Work Management Viewer (`backlogViewer`) is a local dashboard and conformance checker for the
manifest-driven `Request → Work item → Active release → Done` model from the
[Work Management Claude Plugin](https://github.com/martynjsimpson/workManagementClaudePlugin).

The companion plugin creates and manages each project's work files. One central installation of
this viewer can inspect any compatible project without copying application code into that project.

![Work Management Viewer showing project metrics, filters, and status charts](docs/images/backlog-viewer-overview.jpg)

The viewer never modifies project planning files. It reads `project.yml`, derives its configuration
from the manifest, and follows changes directly from disk. Health findings are diagnostic; repairs
and migrations remain the plugin's responsibility.

## Requirements

- Node.js 20 or newer
- A work-management manifest using `model_version: 3`

## Quick start

```sh
git clone https://github.com/martynjsimpson/backlogViewer.git
cd backlogViewer
npm ci
npm start -- --project /path/to/project
```

Open `http://127.0.0.1:5177`.

Use a different port when needed:

```sh
npm start -- --project /path/to/project --port 5178
```

`--project` accepts a project directory or the exact path to `project.yml`. Relative paths resolve
from the caller's current working directory. If the package is published to npm, the equivalent
command will be:

```sh
npx work-management-viewer --project /path/to/project
```

## What it shows

- **Dashboard** — project-wide metrics and charts, kept independent of record filters.
- **Requests** — human-facing asks with filtered summary metrics, qualified search, and delivery links.
- **Work items** — YAML work records with filtered ready and blocked totals, plus dependencies, agents,
  and completion.
- **Links** — filtered link-health totals and request-to-work relationships, including missing and
  intentionally empty links.
- **Active release** — scope, status, decisions, agents, blockers, and verification information.
- **Health** — actionable errors, warnings, and recommendations for model conformance.
- **More Charts** — project-wide request, work-item, capability, priority, and delivered-release
  breakdowns.

Filter and navigation state is encoded in the URL, so filtered views can be bookmarked and browser
history behaves normally. Search accepts text and qualified terms such as `status:blocked`,
`type:spike`, `agent:frontend-developer`, and `capability:imports`.

Dashboard totals and charts always represent the whole project. Selecting a chart row opens the
relevant filtered record view, where the filter bar and its three summary metrics work together.

## Live updates

The viewer watches the selected project and updates automatically as agents change its files. A
small header indicator shows whether updates are live, being applied, paused, reconnecting, or
using periodic fallback checks. Click the indicator to pause or resume live updates; resuming also
checks immediately for any changes made while updates were paused.

Updates replace only the in-memory model, not the page. The current tab, URL-backed filters, search,
scroll position, keyboard focus, and open details modal are retained. Rapid file events are grouped
into one refresh, overlapping refreshes are coalesced, and unchanged models are not redrawn. If an
agent is midway through writing invalid YAML or Markdown, the last valid model remains visible and
the viewer recovers on the next valid change.

Filesystem watching is supplemented by a low-frequency check and reconnects automatically after a
server restart. Hidden browser tabs disconnect to avoid unnecessary work and check immediately when
they become visible again.

## Manifest discovery

Without `--project`, discovery starts at the current working directory and walks upward. At each
level it checks, in order:

1. `docs/work/project.yml`
2. `.claude/work/project.yml`
3. `project.yml` when `requests.md` and `backlog.yml` are beside it

Discovery stops at the Git repository root when one exists. No conventional work-file path is
used after discovery: `paths.work`, `paths.spikes`, `paths.changelog`, both ID prefixes, taxonomy,
and the agent roster all come from the manifest.

The viewer supports manifest schema version 3. Older, newer, missing, or shape-incompatible
manifests produce a clear startup error. They are never auto-migrated.

## Metric history

Metric snapshots are stored outside both the installed package and the project. The location is
platform-specific and each canonical project root hashes to a separate state file. One project's
history therefore cannot affect another's, even when their names match:

- macOS: `~/Library/Application Support/work-management-viewer/`
- Linux: `$XDG_STATE_HOME/work-management-viewer/` or `~/.local/state/work-management-viewer/`
- Windows: `%LOCALAPPDATA%/work-management-viewer/`

Set `WORK_MANAGEMENT_VIEWER_STATE_DIR` to override the location, which is useful for tests and
temporary environments.

Only project planning files are read-only: the viewer writes this small local history file so it
can show changes since the previous snapshot. It retains at most 180 changed snapshots per project.

## Security model

This is a single-user local development tool, not a hosted service:

- The HTTP server binds only to `127.0.0.1` and rejects non-local Host headers.
- Its HTTP surface accepts only `GET` and `HEAD`, and it applies a restrictive browser security
  policy. The live-update stream is same-origin and read-only. The only disk write is the
  metric-history file described above.
- Project content is inserted as text rather than interpreted as HTML, and Markdown support is a
  deliberately small safe subset.
- The application makes no outbound network requests at runtime and has no telemetry.

There is intentionally no authentication. Do not expose the server through a reverse proxy, port
forward, container-published interface, or public network. Only select projects you trust: the
manifest controls which local work files the viewer reads.

## Architecture

The application deliberately stays small: a Node.js HTTP server and parser layer feed a vanilla
HTML/CSS/JavaScript client. There is no build step, database, frontend framework, or runtime
dependency beyond the YAML parser.

## Development

```sh
npm ci
npm run check
node server.js --project test/fixtures/custom-project/project.yml --port 5178
```

`npm run check` validates the server and browser scripts, then runs the `node:test` suite. Tests
cover manifest discovery and compatibility, parsers, bidirectional links, Health guidance, live
change events, local HTTP protections, and per-project metric-history isolation.

## Compatibility contract

`SUPPORTED_MODEL_VERSION` lives in `src/constants.js`. When the plugin introduces a breaking
manifest schema, the viewer must update that constant, its manifest shape checks, fixtures,
parsers, and Health rules together. Until then it fails closed rather than rendering plausible but
incorrect data.

## License

MIT. See [LICENSE](LICENSE).
