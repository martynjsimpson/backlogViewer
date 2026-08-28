# Changelog

All notable changes to Work Management Viewer are documented here. The format follows Keep a
Changelog, and releases use semantic versioning.

## [Unreleased]

## [1.0.1] - 2026-08-28

### Changed

- Raise the supported Node.js baseline from the end-of-life Node.js 20 line to Node.js 22, and
  verify Node.js 22, 24, and 26 in continuous integration.
- Update the pinned `actions/setup-node` workflow dependency to v7.0.0 and the declared `yaml`
  dependency range to v2.9.0.

## [1.0.0] - 2026-08-28

### Added

- Support Work Management Claude Plugin v1.5.0 work-item provenance through the mutually exclusive
  `source_request` and `source_release` fields, including version validation, legacy backfill
  warnings, contradiction errors, and Active Release source-drift checks.
- Accept the new structured `Parked since:` and `Reviewed:` request fields without reporting them
  as unsupported.
- Warn when a completed spike document uses legacy unnumbered recommendations instead of the
  stable `R1`, `R2`, … identifiers required for close-out accounting.

### Changed

- Declare Work Management Viewer stable after a full compatibility, packaging, security,
  accessibility, and interaction audit.
- Distinguish request-derived, release-derived, unresolved, conflicting, and legacy work-item
  provenance in source coverage, cards, details, and search.
- Re-verify compatibility with Work Management Claude Plugin v1.5.0 and its unchanged
  `model_version: 5` manifest and backlog `model_version: 1` on 28 August 2026.
- Test both the documented Node.js 20 minimum and Node.js 24 in CI and before automated releases.

### Fixed

- Reject unknown CLI arguments so a misspelled option cannot silently start the viewer with a
  default project or port.
- Correct the active Work Items summary copy, keep structured evidence ahead of raw source in
  detail dialogs, expose the current navigation page to assistive technology, and contain keyboard
  focus inside an open dialog.

## [0.11.0] - 2026-08-23

### Fixed

- Render selected Active Release work items with intentional legacy IDs by resolving their exact
  identifiers against the backlog instead of requiring the manifest's current work-item prefix.
- Preserve unresolved selected IDs for `MISSING_RELEASE_ITEM` Health reporting, while limiting
  work-item heading detection to the Selected work items section.

## [0.10.1] - 2026-08-23

### Added

- Show the running Work Management Viewer package version in the application header, sourced from
  the server's package metadata so future version bumps appear automatically.

## [0.10.0] - 2026-08-23

### Added

- Export exactly the Health findings selected by the current severity and code filters as a
  self-describing YAML file, including complete remediation guidance and project/source metadata
  for AI-assisted fixes.

### Changed

- Re-verify compatibility with the current Work Management Claude Plugin v1.4.1 manifest,
  work-file templates, and model documentation on 23 August 2026.

## [0.9.0] - 2026-08-19

### Added

- Support Work Management Claude Plugin v1.4.1 and its `model_version: 5` manifest while retaining
  model versions 3 and 4, including validation of per-stage VCS ownership and branch cleanup.

### Changed

- Require `version.file` whenever a model v5 project disables its tag stage, so Health reflects
  the current plugin's durable-version rule.
- Record plugin v1.4.1 as the compatibility baseline for future release audits.

## [0.8.0] - 2026-08-18

### Added

- Support the plugin v1.3.0 `model_version: 4` manifest, including monorepo project boundaries and
  repository-root-anchored paths, while retaining full `model_version: 3` compatibility.

### Changed

- Scope file discovery, metric history, and live watching to the selected monorepo member while
  resolving Git metadata from the containing VCS root.
- Recognise Git worktrees whose `.git` metadata is a file rather than a directory.
- Document the last verified Claude plugin version and a mandatory compatibility audit for every
  viewer release.

## [0.7.0] - 2026-08-18

### Added

- Show each known release date beneath its version in the Requests by Release chart, using the
  project changelog declared by `project.yml` as the source of truth.

### Fixed

- Ignore request-shaped examples and other documentation inside fenced Markdown code blocks when
  parsing `requests.md`.
- Require `Done in` on a completed request only when a `done` work item derived from that request
  carries valid release evidence; decision-only and other release-less requests are now valid.
- Report unquoted YAML `SPIKE:` mappings as explicit non-scalar completion errors with corrective
  guidance.

## [0.6.1] - 2026-08-13

### Fixed

- Render Markdown tables in Active Release prose with safe inline formatting, navigable Request
  and Work Item IDs, column alignment, and horizontal overflow on narrow screens.

## [0.6.0] - 2026-08-13

### Added

- Added a default Dashboard tab for project-wide metrics and charts.
- Added three filter-aware summary metrics to each of the Requests, Work Items, and Links views.

### Changed

- Moved overview widgets and charts out of the record views and made their Dashboard values
  independent of retained record filters.
- Kept chart drill-downs connected to the relevant filtered Requests or Work Items view.
- Condensed the header by removing the redundant Refresh button and moving the model timestamp and
  live-update control into its right-hand position.

## [0.5.0] - 2026-08-12

### Added

- Added live project updates using a debounced filesystem watcher and same-origin Server-Sent
  Events, with automatic reconnection and periodic fallback checks.
- Added a compact header control showing live, updating, paused, reconnecting, fallback, and failure
  states; clicking it pauses or resumes automatic updates.
- Added coverage for debounced change notifications, ignored generated paths, the events endpoint,
  and unchanged metric-history snapshots.

### Changed

- Preserve the active view, filters, search, scroll position, keyboard focus, and open detail modal
  while applying live model changes without reloading the page.
- Keep the last valid model visible during transient parse failures, coalesce overlapping refreshes,
  skip unchanged redraws, and recover automatically after the next valid write.
- Reload the manifest for each model refresh so compatible configuration changes are reflected
  without restarting the viewer.
- Avoid rewriting metric-history files when the calculated values have not changed.

## [0.4.0] - 2026-08-12

### Added

- Added a current application screenshot to the README.
- Added a centered, status-coloured Active Release badge to the header with direct navigation to
  the release view.
- Added pull-request and main-branch CI plus Dependabot configuration for npm and GitHub Actions.

### Changed

- Clarified setup, architecture, metric-history isolation, and the local-only security model in the
  README.
- Made metric-history writes atomic and private to the current user, recover safely from corrupt
  derived state, and reject history recorded for a different project root.
- Added package metadata and a single `npm run check` command for local and CI verification.

### Security

- Reject non-local Host headers to protect the loopback service from DNS rebinding.
- Restrict HTTP methods to `GET` and `HEAD` and add Content Security Policy, clickjacking,
  MIME-sniffing, referrer, permissions, and cross-origin resource protections.
- Run release tests with read-only GitHub permissions, pin Actions to immutable revisions, disable
  dependency lifecycle scripts in CI, and grant write permission only to the release job.

## [0.3.0] - 2026-08-11

### Changed

- Made Health findings actionable: each result now explains what the finding means, labels whether
  it is a fix, review, or optional maintenance task, shows the observed value, and gives a concrete
  recommended action plus the relevant plugin command where one exists.
- Added `recommendation` as a third Health severity for optional guidance; pruning hygiene no longer
  inflates the warning count.
- Added a URL-backed, multi-select Code filter to Health so related findings can be reviewed and
  resolved as a focused group.
- Aligned Health findings with the Request and Work item card layout, including top-line metadata
  and badges, while retaining the severity colour band and removing the redundant `View details`
  label.
- Linked Request and Work item entity IDs in Health finding modals to their corresponding filtered
  record views.
- Moved the More Charts back-navigation control from the global header into the chart page heading.
- Standardised user-facing dashboard and chart terminology on `Work item` instead of `Backlog`.
- Redesigned Link cards to show request context and useful linked Work item details, with direct
  navigation and distinct linked, missing, unlinked, and intentionally-empty relationship states.
- Added safe lightweight formatting for Active Release prose, including lists, bold text, inline
  code, and navigable Request and Work item IDs.

## [0.2.0] - 2026-08-11

### Changed

- Linked the README to the companion Work Management Claude Plugin and clarified that one central
  viewer installation can inspect multiple projects.
- Made Health findings visibly interactive with a pointer cursor, hover and keyboard-focus states,
  and an explicit `View details` action.

### Fixed

- Restored colored bar fills in breakdown charts by giving percentage-width fills a block layout.
- Corrected the documented development command to target the fixture manifest explicitly.
- Repaired shell quoting in the release workflow's package-version output step.

## [0.1.0] - 2026-08-11

### Added

- Manifest discovery and a strict `model_version: 3` compatibility gate.
- Project-derived paths, identifier prefixes, taxonomies, and agent roster.
- YAML-backed backlog parsing with block-scalar support.
- Current `Work items:`, blocked fields, multi-value completion, and spike-marker support.
- Bidirectional request/work-item linking and explicit no-work handling.
- Full Active Release and model-conformance Health views.
- Qualified search, URL-backed filters/navigation, light mode, and project-scoped metric history.
- Standalone CLI/package metadata and fixture-based `node:test` coverage.

### Removed

- Hardcoded project paths, `REQ-` assumptions, and obsolete `derived_work_items`, `legacy_ids`, and
  `phase` handling.
