# Changelog

## [0.4.1] - 2026-09-29

### Fixed

- Slash-command pickers no longer paint option text on top of itself. The picker keeps one line per row instead of shrinking into the transcript column.
- `/provider` rows show the provider name and credential status only. Model names stay in the model picker.
- `/model` rows show the display name and a short badge, not the id, context window, and status crammed onto one line.

## [0.4.0] - 2026-09-29

> **Published 2026-09-29.** `bun add -g @arnilo/prism-code`, or the standalone binary via
> `curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh`
> (`prism-code-v0.4.0` release, six targets, `SHA256SUMS` verified). Every earlier
> `@arnilo/prism-code` version is **deprecated on npm**: it was the coding-agent profile library,
> which now lives in `@arnilo/prism-coding-tools` and `@arnilo/prism-agent-sdk`. The app requires
> the `@arnilo/prism` 0.12.1 line for `capToolResultSummary`.

### Changed

- **Breaking: `@arnilo/prism-code` is now the Prism Code terminal app.** `0.3.0` and earlier published the coding-agent profile library under this name; that surface moved to `@arnilo/prism-coding-tools` and `@arnilo/prism-agent-sdk`. Stay on `@arnilo/prism-code@0.3` only if you still need the old library.
- Independent version line: `0.4.0` follows the last published `0.3.0` (the app never shipped under the lockstep `0.12.0` number).
- `@arnilo/prism`, `@arnilo/prism-providers`, and `@arnilo/prism-hooks` are regular dependencies, so `bun add -g @arnilo/prism-code` installs a self-sufficient runtime graph. `@arnilo/prism-agent-sdk` is pinned at `^0.1.0`.
- `doctor`'s `runtime` check loads `@opentui/core` and its native library (`resolveRenderLib()`) instead of resolving package paths, so it holds in the standalone binary and catches a present-but-broken native package.
- On musl Linux hosts (Alpine), Prism Code selects OpenTUI's musl native library itself (`OPENTUI_LIBC=musl` when `process.report` shows no glibc); an explicit `OPENTUI_LIBC` wins.
- `prism-code --version` and `--help` answer before the app graph loads (cold `--version` ~370 ms → ~12 ms); every other invocation is unchanged.
- `prism-code --version` reports the install channel for support diagnostics: `0.4.0 (bun)` for the package install, `0.4.0 (binary)` for the standalone executable.

### Added

- Initial release of the terminal app: terminal coding agent built on `@arnilo/prism-agent-sdk`.
- Standalone binaries (`bun build --compile`) for Linux x64/arm64 (glibc and musl) and macOS x64/arm64 that need no Bun, with `SHA256SUMS` and build provenance. See `docs/release-and-install.md`.
- Native curl installer (`install.sh`): detects OS/arch/libc, resolves the version from `--version`/`PRISM_CODE_VERSION` or the npm registry, verifies the release archive against `SHA256SUMS` over HTTPS, and installs atomically to `${PRISM_HOME:-$HOME/.prism}/bin`. Supports `--modify-path`, in-place upgrades, and `--uninstall`.
- Bun install channel: `bun add -g @arnilo/prism-code` / `bunx @arnilo/prism-code`, verified from the packed tarballs before publish and from npm after it by `scripts/prism-code-install-smoke.mjs`.
- `prism-code.json` fail-closed configuration schema with unknown-key rejection, path containment, and relative-path resolution against the config directory.
- Interactive TUI: streaming message stream with bounded scrollback, tool cards, fail-closed approval prompts, searchable provider/model pickers, Shift+Tab reasoning-effort cycling, and a two-line status footer (repo/branch, model/effort, MCP/OM/token details).
- Provider onboarding for the shipped adapter inventory: API-key prompts stored in the private credential store, OAuth login for authorized providers, ambient/local runtimes, and host-setup enterprise providers.
- Durable repo-scoped sessions: default SQLite store at `<cwd>/.prism/sessions.db`, `/new` and `/resume`, `--session` CLI resume, and workspace-canonicalized `searchSessions` scoping.
- Coding LLM `/compact` over the active branch using `createCodingCompactionStrategy`.
- Observational memory integration: `/om` per-session toggle (default off), `/om-model` independent worker model, `/om:status`, `/om:view`, and a recall tool that is only registered while enabled.
- Bundled coding tool inventory: 9 core tools default on; 7 git tools, `ask_user_decision`, and `coding_check` opt-in via `tools.planes` or `tools.optIn`.
- Allow-listed dynamic module loading for custom user tools (`tools.add`, `tools.replace`, `tools.allowedModules`).
- Headless `print` and `json` modes with deterministic exit codes and bounded per-line event envelopes.
- ACP stdio server (`prism-code acp` / `--mode acp`) with the shared config model, destination-checked MCP allow-list, modes, and config options.
- Optional web plane: `obscura` (host binary; native browser tools opt-in), `brave` (search plus optional Firecrawl fetch), or `off`, with explicit setup notes when a backend is unavailable.
- Optional wiki plane from `@arnilo/prism-memory/wiki`: wiki tools, skills, guidance injector, and the four slash commands (`/wiki-init`, `/wiki-refresh`, `/wiki-lint`, `/wiki-ingest`) with SSRF-checked URL ingest through the selected web fetch tool; skill auto-deploy requires an explicit opt-in.

## [0.3.0] and earlier

- Coding-agent profile library, published as `@arnilo/prism-code` before the app took over the name. See the root `CHANGELOG.md` history for those releases.
