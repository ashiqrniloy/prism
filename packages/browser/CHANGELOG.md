# Changelog
## [0.0.96] - 2026-07-21

### Changed

- Released with exact 0.0.96 graph.


## Unreleased

## [0.0.9] - 2026-07-21

- First published release of optional `@arnilo/prism-browser` with `createBrowserTools()` / `createBrowserManager()` over a host-supplied Playwright Browser.
- Exposed exactly four exclusive model tools: `browser_open`, `browser_snapshot`, `browser_act`, and `browser_close`.
- Added run-owned non-persistent contexts, AI-mode aria snapshots with snapshot-scoped refs, ordered per-run action queue, role/label/testId/text targets, dialog/page selection, and finite page/action/snapshot/timeout limits.
- Enforced browser egress/side-effect/upload/download/screenshot/popup policy: context routing with `serviceWorkers: "block"`, fail-closed contained-proxy attestation, private/loopback/scheme denial, observation vs mutation classification for `ExecutionPolicy`, realpath-contained uploads, quarantined downloads with host release approval, bounded screenshot `ImageContent`, and `createSharedSandboxBrowserOptions()` for shared disposable sandbox mounts.
- Added network-free adversarial evaluation fixtures and a protected Playwright live matrix (`PRISM_LIVE_PLAYWRIGHT=1`) over a local loopback hostile fixture covering stale refs, egress deny, upload containment, screenshots, and download quarantine/release.
- `playwright-core@1.61.0` remains an optional peer; package import launches nothing and downloads nothing.

## [0.0.8] - 2026-07-20

- Package scaffolding landed under the unpublished 0.0.8 tree; first public release is 0.0.9.

