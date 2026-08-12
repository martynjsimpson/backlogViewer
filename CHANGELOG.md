# Changelog

All notable changes to Work Management Viewer are documented here. The format follows Keep a
Changelog, and releases use semantic versioning.

## [Unreleased]

### Changed

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
