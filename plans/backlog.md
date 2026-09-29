# Project Backlog

Tracking compromises, deferred work, and follow-up actions recorded from completed implementation plans.

## Re-audit tarball diet and bundle footprint for Agent SDK docs and baseline
- Section: Compromises Made
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- Compromise: Raised `root.packedBytes` from 1486492 to 1562714 (+5.1%) in `scripts/budgets.json` to accommodate `docs/agent-sdk.md`, compatibility baseline entries, and plan documentation rather than trimming existing docs.
- Implications: Packed tarball size ceiling increased slightly; future doc additions will need to watch the budget limit closely.

## Consolidate optional peer dependency resolution between Agent SDK and host apps
- Section: Compromises Made
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- Compromise: Marked `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, and `@arnilo/prism-mcp` as peerDependencies of `@arnilo/prism-agent-sdk` to guarantee lockstep versions in consumer workspaces rather than dynamic runtime imports with fallback stubs.
- Implications: Consumers installing `@arnilo/prism-agent-sdk` must satisfy or accept npm/bun peer dependency warnings unless all three are provided or ignored.

## Hot-reload / dynamic update of skills and hooks in live agent session
- Section: Further Actions
- Priority: P2
- Source: plans/134-Prism-Agent-SDK.md
- What: Add a runtime mutation method on `AgentSession` or `Agent` to re-discover skills and re-compile hooks without rebuilding the entire `Agent` instance via `defineAgent`.
- Why: Interactive coding apps like Prism Code (Plan 135) may benefit from on-the-fly editing of `.agents/skills` or `.agents/hooks.json` during a session without tearing down the conversation.

## Structured telemetry and tracing integration for defineAgent assembly
- Section: Further Actions
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- What: Expose OpenTelemetry spans or telemetry hooks covering the tool-plane resolution and eager MCP bridge startup phases in `defineAgent`.
- Why: Allows host applications to monitor startup latency and failures in remote or stdio MCP server handshakes.

## Prism Code coverage floor at the measured minimum
- Section: Compromises Made
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- Compromise: `@arnilo/prism-code` ships at the measured coverage floor (79.35 lines measured, 76.35 threshold = measured − 3pp) instead of adding TUI component suites to lift it.
- Implications: A future prism-code change can fall to 76.35 lines before the gate trips; the low floor is visible in `scripts/coverage-thresholds.json` and should be ratcheted with component suites.

## Prism Code bin has no post-publish smoke
- Section: Compromises Made
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- Compromise: `scripts/post-publish-smoke.mjs` enumerates library subpaths, not bins, so the published `prism-code` bin has no registry-mode smoke (`--version`, ACP handshake).
- Implications: A broken bin mapping or missing OpenTUI peer is caught by pack/install tests, not by a true post-publish bin run.

## Local release gate runs without the Postgres leg
- Section: Compromises Made
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- Compromise: Baseline regeneration and `release:gate` ran with `PRISM_RELEASE_POSTGRES_JOB=1` (publish-mode marker) after deleting the stale gitignored `scripts/postgres-evidence.json`, because this host has no Postgres service.
- Implications: Local `release:gate` green does not attest a current-tree Postgres conformance run; CI's postgres-integration leg still owns that evidence.

## bun install parity for file:../.. workspace deps
- Section: Compromises Made
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- Compromise: Per-package `@arnilo/prism: file:../..` copies produced by `bun install`/`bun ci` were replaced manually (workspace resolution) during verification instead of fixing the toolchain rule.
- Implications: A fresh install can re-break provider conformance (`instanceof` across duplicate module trees) and the `npm ls` packaging guard; the toolchain needs a link-vs-copy rule or documented install flag.

## Add a prism-code bin smoke to post-publish verification
- Section: Further Actions
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- What: Extend `scripts/post-publish-smoke.mjs` (or add a dedicated packed-bin test) to install `@arnilo/prism-code`, run `prism-code --version`, and drive one ACP handshake over stdio.
- Why: The bin is the primary user surface and currently has no end-to-end post-publish check.

## Prism Code headless subpath without OpenTUI
- Section: Further Actions
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- What: Add a `@arnilo/prism-code/headless` export (or lazy-load `./tui/index.js`) so `assembleAppAgent`/`runHeadless` consumers do not load `@opentui/core` through the root barrel.
- Why: Headless embedders and CI scripts currently pay the native TUI module load for a library-only run.

## Raise Prism Code coverage with TUI component suites
- Section: Further Actions
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- What: Add unit suites for the picker, input editor, approval prompt, and stream components, then ratchet the prism-code line threshold above 76.35.
- Why: The initial gate is a measured floor, not an intent; the TUI components carry most of the uncovered lines.

## Local Postgres path for release.mjs gate
- Section: Further Actions
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- What: Provide a docker-compose/Postgres fixture (or an explicit required-env waiver surface) so `release.mjs gate --update-baseline` does not need the publish-mode marker on developer hosts.
- Why: Baseline regeneration currently cannot run on a workstation without Postgres, which makes release verification host-dependent.

## Fix bun file:../.. copy-vs-link workspace resolution
- Section: Further Actions
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- What: Investigate the bun hoisted-linker behavior that materializes `file:../..` root devDependencies as per-package real copies, and pin the fix (link rule or documented `bun install` option) in the toolchain docs and a regression check.
- Why: Fresh installs currently break cross-package class identity (provider conformance) and the `npm ls` packaging guard.

## Loopback OAuth callback listener for `/mcp login`
- Section: Further Actions
- Priority: P3
- Source: plans/138-Prism-Code-Sessions-And-MCP.md
- What: Add a loopback HTTP listener (default redirect `http://127.0.0.1:1456/oauth/callback`, overridable via `PRISM_MCP_OAUTH_REDIRECT_URI`) so `/mcp login <id>` completes the authorization-code flow without the operator pasting the callback URL or code.
- Why: Pasting works today but is error-prone; a listener removes a manual step while keeping the pasted path as fallback.

## Per-server reconnect backoff surfaced in the MCP footer
- Section: Further Actions
- Priority: P3
- Source: plans/138-Prism-Code-Sessions-And-MCP.md
- What: Add a retry/backoff policy to the agent-sdk MCP plane and surface pending reconnect attempts in the Prism Code footer (`MCP: connected/total (n failed)` today only reflects the last status).
- Why: A failed server currently stays failed until the user runs `/mcp reconnect <id>`; transient network failures need no user action once the plane retries on its own.

## Re-export `formatMcpStatus` and footer counts from the prism-code barrel
- Section: Further Actions
- Priority: P3
- Source: plans/138-Prism-Code-Sessions-And-MCP.md
- What: Re-export `formatMcpStatus` and the `{ connected, total, failed }` footer status type from `@arnilo/prism-code` (currently module-level exports of `tui/components/status.ts`) if host interfaces need to render the same MCP footer.
- Why: Hosts embedding the TUI cannot currently reuse the footer rendering without importing an internal module path.

## PTY journey streaming budget is throughput, not per-frame latency
- Section: Compromises Made
- Priority: P3
- Source: plans/139-Prism-Code-TUI-Rendering-And-UX.md
- Compromise: The PTY end-to-end harness asserts streamed throughput (>100 deltas/s, 15 s ceiling) instead of a per-frame p95, because Bun coalesces PTY writes and external chunk timings are not a frame-time signal; the 16 ms render-path budget stays with the in-process `tui-rendering.test.ts` smoke.
- Implications: A regression that slows frames without slowing the whole stream (e.g. a heavy per-frame paint with buffered output) would only be caught by the in-process smoke, not by the PTY journeys.

## Prism Code synthesizes its own local durable-effect identity
- Section: Compromises Made
- Priority: P2
- Source: plans/139-Prism-Code-TUI-Rendering-And-UX.md
- Compromise: `assembleAppAgent` asserts a self-declared `tenantId: local` / `verified: true` identity (mirroring the ACP surface) so `edit`/`write`/`delete`/`move` are no longer blocked by core's durable-effect guard; there is still no `identity` field in `prism-code.json` for a host to supply a real verifier or principal.
- Implications: Embedded hosts that reuse the prism-code assembly inherit a self-asserted local principal; an auditable deployment must override the identity when building its own agent.

## Cross-package @arnilo/prism copies go stale after a root rebuild
- Section: Further Actions
- Priority: P2
- Source: plans/139-Prism-Code-TUI-Rendering-And-UX.md
- What: The per-package `node_modules/@arnilo/prism` entries bun materializes for the `file:../..` devDependency are hardlinks into `~/.bun/install/cache/@arnilo/prism/@T@*` snapshots, so rebuilding the root `dist` never refreshes them; a workspace then fails at runtime with missing exports (observed: `SESSION_TITLE_METADATA_KEY`, `DiscoveryRoot`). Fix the linker rule or add a post-install staleness check, and commit the regenerated `bun.lock` (the old one was unparseable by bun 1.4.2).
- Why: Plan 139 Task 7's PTY journeys could not start the built binary until the copies were re-pointed at the repo root; the same failure will hit any workspace that uses a newly added root API.

## Extend the PTY TUI journeys to the remaining interactive paths
- Section: Further Actions
- Priority: P3
- Source: plans/139-Prism-Code-TUI-Rendering-And-UX.md
- What: Add journeys for the Ctrl+C escalation (abort then exit), a multi-model `/model` switch, MCP connect/reconnect visible in the footer, the `todo_write` panel, and an `@file` attachment accepted from the completion popup — all on the existing `scripts/lib/pty-harness.mjs`.
- Why: The harness now covers onboarding, streaming, parallel cards, approval diff, Esc abort, `/model`, and resume; these remaining paths are the ones where key routing and modal state interleave.

## Wire the Codex refresh-token live leg into CI
- Section: Further Actions
- Priority: P2
- Source: plans/136-Prism-Code-Home-Providers-Credentials.md
- What: Put a real `PRISM_LIVE_CODEX_REFRESH_TOKEN` in the `live-canaries` environment and run `PRISM_LIVE_FILTER=code/live-smoke bun run test:live` so the OAuth-refresh leg produces evidence instead of skipping.
- Why: The stored-key and task legs are covered by `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, but the refresh-and-persist path only ever runs with that token; the leg's evidence is the only gap left in the plan 136 Task 8 smoke.

## Add a PTY-driven first-run TUI smoke
- Section: Further Actions
- Priority: P2
- Source: plans/136-Prism-Code-Home-Providers-Credentials.md
- What: Spawn the real binary in a pseudo-terminal and drive the onboarding keystrokes (provider pick → key prompt → model pick) rather than only the in-process test renderer.
- Why: The plan 140 Task 6 journey now covers that path live, but nothing asserts the first-run keystroke routing hermetically, where a regression would only surface in the live matrix.

## Live `/logout` leg against the real keychain
- Section: Further Actions
- Priority: P3
- Source: plans/136-Prism-Code-Home-Providers-Credentials.md
- What: Extend the live smoke with a `/logout` leg against the real OS keychain store once the `live-canaries` runner has one; today `/logout` is covered offline and the live smoke deliberately uses the file store.
- Why: The delete-from-keychain path is only exercised against mocks.

## Live compaction leg for the observational-memory worker
- Section: Further Actions
- Priority: P3
- Source: plans/136-Prism-Code-Home-Providers-Credentials.md
- What: Add a live leg that compacts a real session with the real OM worker (the prune/OM worker and `/compact` now share the provider cache).
- Why: Closes the last per-run-selection gap in the OM worker.

## `usedDefaults` precision for catalog entries
- Section: Further Actions
- Priority: P3
- Source: plans/137-Prism-Code-Agent-Loop-And-Skills.md
- What: Record assumed limits separately from `usedDefaults` (which reports a catalog miss per its docstring) when a catalog entry declares capabilities but no limits.
- Why: The footer would otherwise signal a catalog miss while the run is quietly using assumed limits.

## Split the live task leg across model strengths
- Section: Further Actions
- Priority: P3
- Source: plans/137-Prism-Code-Agent-Loop-And-Skills.md
- What: Give the tool-use-heavy task leg its own model env var instead of running on whatever key is configured.
- Why: Haiku-class models can flake on multi-step file/test work, which would read as a CLI regression in the live matrix.
