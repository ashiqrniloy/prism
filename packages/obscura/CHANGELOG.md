# Changelog

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.0.28] - 2026-08-08

### Added
- Initial package scaffold.

## [0.3.0] - 2026-08-28

### Added

- `createObscuraWebTools`: bounded CLI-backed `web_search`/`web_fetch` through one replaceable HTML search profile (URL-encoded queries, constant extraction JavaScript) plus explicit `obscura_fetch`/`obscura_scrape` batch tools — public-HTTP(S)-only URL validation, byte/count/timeout caps, abort/timeout child kills, redacted failure diagnostics, `allowEval`-gated custom expressions, and untrusted-content labeling; opt-in live smoke test (`test:live`).
- `connectObscuraCdp`: managed/external CDP connectivity — bounded abortable readiness for spawned `obscura serve`, loopback-only credential-free endpoint validation, host Playwright via `chromium.connectOverCDP` (optional exact `playwright-core@1.61.0` peer or injection), browser-first then process ownership-ordered close, and direct composition with `@arnilo/prism-browser` tools.
- Initial package: `spawnObscuraProcess` fail-closed lifecycle for a host-installed Obscura binary or Docker invocation — validated absolute command, bounded argv/env, minimal default environment, insecure-flag rejection with explicit opt-in, bounded readiness probes, process-group SIGTERM/SIGKILL close, abort propagation, capped stderr capture, and idempotent ownership-aware cleanup.