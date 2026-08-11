# Work Management Viewer

A local dashboard and conformance checker for projects using the manifest-driven
`Request → Work item → Active release → Done` model from the
[Work Management Claude Plugin](https://github.com/martynjsimpson/workManagementClaudePlugin).

The companion plugin creates and manages the work files in each project; this viewer reads and
visualizes those files from one central installation.

The viewer is read-only with respect to project planning files. It reads `project.yml`, derives
all paths, identifiers, taxonomies, and agents from the manifest, and refreshes its data directly
from disk. Health findings are diagnostic; the viewer never repairs or migrates work files.

## Requirements

- Node.js 20 or newer
- A work-management manifest using `model_version: 3`

## Run locally

From this repository:

```sh
npm install
npm start -- --project /path/to/project
```

Then open `http://127.0.0.1:5177`.

Use another port when needed:

```sh
npm start -- --project /path/to/project --port 5178
```

Once the package is published, the equivalent command is:

```sh
npx work-management-viewer --project /path/to/project
```

`--project` accepts either a project directory or the exact path to `project.yml`. Relative paths
are resolved from the caller's current working directory, not from the installed package.

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

## Views

- **Requests** — human-facing asks with status/type filtering, qualified search, and delivery links.
- **Work items** — parsed YAML work-item records, including blocked state and spike completion.
- **Links** — request context plus linked work-item titles, statuses, types, and capabilities, with
  distinct states for valid links, missing references, unlinked requests, and intentional
  `Work items: none`.
- **Active release** — goal, version, branch, release status, selected items joined to live work-item
  state, decisions, agents, blockers, and verification information. Release prose renders common
  Markdown emphasis, inline code, and lists; recognised Request and Work item IDs link to their
  records.
- **Health** — structure, vocabulary, paired fields, completion values, referential integrity,
  spike documents, ownership, VCS coherence, and pruning hygiene. Findings are classified as
  errors, warnings, or recommendations; each explains what it means, shows the observed value, and
  gives a concrete recommended action. Severity and multi-select Code filters help isolate a class
  of finding while you work through it.

Filter and navigation state is encoded in the URL, so a filtered view can be bookmarked and the
browser back button restores the previous state. Search accepts ordinary text and qualified terms
such as `status:blocked`, `type:spike`, `agent:frontend-developer`, and `capability:imports`.

## Metric history

Metric snapshots are stored outside both the installed package and the project. The location is
platform-specific and keyed by a hash of the canonical project root:

- macOS: `~/Library/Application Support/work-management-viewer/`
- Linux: `$XDG_STATE_HOME/work-management-viewer/` or `~/.local/state/work-management-viewer/`
- Windows: `%LOCALAPPDATA%/work-management-viewer/`

Set `WORK_MANAGEMENT_VIEWER_STATE_DIR` to override the location, which is useful for tests and
temporary environments.

## Development

```sh
npm test
node server.js --project test/fixtures/custom-project/project.yml --port 5178
```

The test suite uses `node:test` and covers manifest discovery and compatibility, custom prefixes,
Markdown continuation rules, real YAML block scalars, multi-value completion metadata, spike
markers, active-release parsing, bidirectional links, and health validation.

## Compatibility contract

`SUPPORTED_MODEL_VERSION` lives in `src/constants.js`. When the plugin introduces a breaking
manifest schema, the viewer must update that constant, its manifest shape checks, fixtures,
parsers, and Health rules together. Until then it fails closed rather than rendering plausible but
incorrect data.

## License

MIT. See [LICENSE](LICENSE).
