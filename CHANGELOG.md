# Changelog

All notable changes to Work Management Viewer are documented here. The format follows Keep a
Changelog, and releases use semantic versioning.

## [Unreleased]

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
