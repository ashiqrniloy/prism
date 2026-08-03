# Changelog

## [0.0.23] - 2026-08-03

### Changed
- Released with exact 0.0.23 graph.


## [0.0.22] - 2026-07-31

### Changed
- Released with exact 0.0.22 graph.

## [0.0.21] - 2026-07-31

### Changed
- Released with exact 0.0.21 graph.



## [0.0.20] - 2026-07-31

### Changed
- Released with exact 0.0.20 graph.


## [0.0.19] - 2026-07-30

### Changed
- Released with exact 0.0.19 graph.

## [0.0.18] - 2026-07-30

### Changed
- Released with exact 0.0.18 graph.

## [0.0.17] - 2026-07-29

### Changed
- Released with exact 0.0.17 graph.

## [0.0.16] - 2026-07-26

### Changed
- Released with exact 0.0.16 graph.

## [0.0.15] - 2026-07-26

### Changed

- Released with exact 0.0.15 graph.

## [0.0.14] - 2026-07-26

### Added

- Verified-state checkpoint ledger (`createBrowserCheckpointLedger`) with reload/verify-before-side-effect and frozen per-run caps (Plan 077 Task 6).

## [0.0.13] - 2026-07-24

### Changed

- Released with exact 0.0.13 graph.

## [0.0.12] - 2026-07-22

### Changed

- Released with exact 0.0.12 graph.

## [0.0.11] - 2026-07-22

### Changed

- Released with exact 0.0.11 graph.

## [0.0.10] - 2026-07-21

### Changed

- Released with exact 0.0.10 graph.

## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.

## [0.0.9] - 2026-07-21

- First published release of optional `@arnilo/prism-browser` with `createBrowserTools()` / `createBrowserManager()` over a host-supplied Playwright Browser.
- Exposed exactly four exclusive model tools: `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close`.
- Added run-owned non-persistent contexts, AI-mode aria snapshots with snapshot-scoped refs, ordered per-run action queue, role/label/testId/text targets, dialog/page selection, and finite page/action/snapshot/timeout limits.
- Enforced browser egress/side-effect/upload/download/screenshot/popup policy: context routing with `serviceWorkers: "block"`, fail-closed contained-proxy attestation, private/loopback/scheme denial, observation vs mutation classification for `ExecutionPolicy`, realpath-contained uploads, quarantined downloads with host release approval, bounded screenshot `ImageContent`, and `createSharedSandboxBrowserOptions()` for shared disposable sandbox mounts.
- Added network-free adversarial evaluation fixtures and a protected Playwright live matrix (`PRISM_LIVE_PLAYWRIGHT=1`) over a local loopback hostile fixture covering stale refs, egress deny, upload containment, screenshots, and download quarantine/release.
- `playwright-core@1.61.0` remains an optional peer; package import launches nothing and downloads nothing.

## [0.0.8] - 2026-07-20

- Package scaffolding landed under the unpublished 0.0.8 tree; first public release is 0.0.9.

