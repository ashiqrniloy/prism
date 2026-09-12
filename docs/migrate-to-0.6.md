# Migrate Prism 0.5 to 0.6

> **Status: 0.6.0** (Node `>=22`, the folded 0.5.7 content, self-describing coverage failures, release-truth gates). 0.6.0 is the first published release after 0.5.6 — the 0.5.7 cut was never published, so everything below is the single 0.5.6 → 0.6.0 delta.

## What changes

Prism 0.6 is a **lockstep cut**: all 10 publishable manifests move `0.5.6` → `0.6.0` and internal first-party ranges move `^0.5.6` → `^0.6.0`. Package names and import subpaths from 0.5 stay valid, no persisted shape changed, and no public signature was removed. The host-visible delta is:

1. the runtime floor: **Node `>=22`** (§1, breaking for a Node 20 host);
2. third-party version floors and one **removed peer** (§2, §3) — the install-visible part of the never-published 0.5.7;
3. additive tuning knobs for context assembly, session snapshots, memory-session search, SSRF policy, and browser run lifetime (§4);
4. behavior fixes that need no host action (§5) and release/CI gates that change no runtime contract (§6).

## 1. Runtime floor: Node `>=22` (breaking for Node 20 hosts)

Every publishable package declares `"engines": { "node": ">=22" }`, and a Node 20 host gets an `EBADENGINE` warning from npm (a hard failure under `engine-strict`) plus an unsupported runtime. Node 20 reached upstream end-of-life on 2026-04-30, so the 0.6 line moves to Node 22 (maintenance LTS to 2027-04-30) while Node 24 stays the CI default (active LTS to 2028-04-30).

What a 0.5.x host must check before upgrading:

- **Host and container images.** Move the host process to Node 22.6+ — the docs/test harness strips TypeScript natively from 22.6 — or to Node 24. `docs/release-and-install.md` carries the support matrix.
- **CI legs.** The release workflow's compatibility leg is renamed `node20-compat` → `node22-compat` and runs `node-version: "22"`; branch-protection required-check lists that name the old job id must be updated.
- **Development types.** `@types/node` (dev) moves `^20.19.0` → `^22.20.0` in the root and `@arnilo/prism-coding-tools`, tracking the declared floor. Hosts building Prism from source should not pin their own `@types/node` below 22 while the floor is `>=22`.
- **No code migration.** No import path, store schema, event shape, or public signature changed for this; the floor is the whole delta (`scripts/phase12-freeze-manifest.json` deviation `dev-006`).

## 2. Third-party floors (folded 0.5.7 content)

Ranges moved in the cut that never shipped; hosts that pin these themselves must move with them.

- `pg` **`^8.22.0` → `^8.23.0`** — driver dependency of `@arnilo/prism-core/sessions/postgres` and `@arnilo/prism-memory`, and core's optional peer. A host on 8.22 sees a peer warning until it upgrades.
- `playwright-core` optional exact peer **`1.61.0` → `1.63.0`** in `@arnilo/prism-web-tools` (`/browser`, `/obscura`). The exact pin is deliberate — browser control is version-sensitive, and the host still owns the browser binary/image.
- `@ai-sdk/provider` exact peer **`4.0.10` → `4.0.13`** in `@arnilo/prism-providers/ai-sdk`. The supported-version matrix gained a `4.0.13` row; `4.0.3`, `4.0.4`, and `4.0.10` stay listed. Unlisted versions still fail closed with `AiSdkProviderError { code: "unsupported_version" }`.
- `@nanonets/graft` optional peer **`^0.16.0` → `^0.16.0 || ^0.18.0`** in `@arnilo/prism-memory/graft` (upstream published no 0.17; both listed floors pass the offline peer-contract smoke).
- `@agentclientprotocol/sdk` exact pin **`1.3.0` → `1.4.0`** in `@arnilo/prism-ag-ui/acp` and `@arnilo/prism-acp-agent`. The wire protocol stays v1 (`PROTOCOL_VERSION === 1`); 1.4.0 stabilizes elicitation (the SDK's `unstable_*` helpers become `createElicitation`/`completeElicitation`, wire method names unchanged — Prism never called the unstable helpers) and adds `compaction` session-update kinds, which Prism does not advertise or map.
- `@office-open/*` **`0.13.1` → `0.14.5`** in `@arnilo/prism-office`. Upstream made `parseDocument`/`parsePresentation`/`parseWorkbook` async; Prism's adapters call the new synchronous `parse*Sync` variants, so no Prism signature changed — but the office package requires the 0.14.5 line.
- `zod` **`^4.4.3` → `^4.6.2`** in `@arnilo/prism-mcp` (AG-UI's `^3.25.0 || ^4.0.0` peer range is unchanged and still admits it).
- `@biomejs/biome` dev **`2.5.11` → `2.5.13`** (lint/format only; 0 findings on the repo).

## 3. `@arnilo/prism-office` is peer-free

The optional `playwright-core` peer is **removed**. No office subpath ever imported it at runtime — `/diagrams` drives a host-supplied iframe — so the only Browser consumer was a gated live draw.io test, now behind a devDependency. Hosts that added the install for office can drop it; office installs and imports without a browser.

## 4. Additive host knobs

All optional, all defaulting to the previous behavior:

- **Context assembly:** `AssembleProviderInputOptions.tokenEstimator?: (text: string) => number` replaces the built-in UTF-16/4 heuristic for eviction accounting. Hard byte caps stay estimator-independent.
- **Session snapshot cache:** `AgentSessionConfig.snapshotCacheTtlMs` — default `DEFAULT_SNAPSHOT_CACHE_TTL_MS` (1000), cap `HARD_MAX_SNAPSHOT_CACHE_TTL_MS` (30000), `0` disables the branch-rebuild cache.
- **Memory-session search:** `createMemorySessionStore(entries, { search: { maxLinearSessions, maxLinearEntries, maxLinearBytes } })`, validated against the same fail-closed bounds as the defaults.
- **SSRF policy:** `SsrfPolicy.allowedCidrs` takes IPv4/IPv6 CIDR entries for hosts that must reach a private range. Hostname denials (metadata endpoints), credential and redirect checks are unchanged, and an unparseable CIDR still fails closed.
- **Browser run lifetime:** `BrowserLimitOptions.idleRunTtlMs` (default `0` = never reap, cap `HARD_IDLE_RUN_TTL_MS` 30 min) closes a run with nothing queued after the TTL; any interaction resets the clock, and `manager.closeRun(runId)` stays the explicit close.

## 5. Behavior fixes (no host action)

- **Durable concurrent tool rounds.** With `toolConcurrency > 1`, a failed or aborted call used to throw before the round's results were appended, dropping the successful siblings — the next provider request then carried `tool_use` blocks with no `tool_result`. Successful results and synthetic errors (`tool_execution_failed` for the failing call, `tool_call_not_dispatched` for calls that never started) are now persisted before the round fails or aborts. Run-level control errors (`ERR_PRISM_AGENT_RUN_SUSPENDED`, `ERR_PRISM_DELEGATION_SUSPENDED`, `ERR_PRISM_LOOP_*`) intentionally skip synthetic results: durable recovery re-dispatches them.
- **Content-less tool results.** A `ToolResult` without `content`/`result` folds to `(tool completed with no output)` (`EMPTY_TOOL_RESULT_TEXT`) instead of an empty payload, so strict OpenAI-compatible providers accept the request.
- **Memory patch merge.** `packages/memory`'s `mergeJsonObjects` now delegates to core `mergeConfigLayers` (deep copy, strict JSON validation — `undefined`/`Date`/function values fail closed — with the `MemoryValidationError` taxonomy preserved) instead of aliasing the caller's objects.
- **`redactSecrets` cost.** A guarded single-pass alternation fast path handles large inputs (≥16 KiB, 2–32 non-overlapping needles) with byte-identical output (~13× faster on 1 MiB transcripts); the ordered loop stays the fallback.
- **Peer manifest resolution.** Upstream resolvers handle packages that do not export `./package.json` (e.g. `@dietrichgebert/ponytail`) by resolving the entry point and walking up to the manifest.

## 6. Test, coverage, and release-gate changes (no runtime contract)

- **`npm test` never short-circuits.** Every stage runs through `scripts/run-all-tests.mjs`, which prints one summary, so a failing stage cannot hide later failures.
- **Coverage truth.** Discovery finds nested `dist/**/__tests__` in all 9 workspace packages, `coverage-thresholds.json` may no longer name retired packages, and a failing coverage child is self-describing: the summary prints the child's redacted output tail and the artifact row records `status`/`exitCode`/`tail`.
- **Version-literal gate.** `scripts/version-literal-gate.test.mjs` asserts every release-claim surface (10 manifests, internal ranges, `package-lock.json`, the `src/index.ts` version constant, the `docs/index.md` current line, `release.yml` tag lists, `scripts/package-truth.json`) equals the root manifest version, so a half-finished cut fails the suite instead of shipping.
- **Workflow liveness.** `scripts/workflow-liveness.test.mjs` resolves every `-w`/`--workspace` target, named npm script, and `uses:` reference in `.github/workflows/*.yml` against the workspace inventory and requires full 40-hex SHA pins for actions.
- **Startup budget under load.** The root import budget asserts a machine-relative ratio (trimmed mean of imports ÷ process-start cost) and only applies the absolute 250 ms ceiling when the machine is off-load, so a busy CI runner no longer reports a false regression.
- **Internal ranges at the cut version exactly.** `release.mjs` lockstep mode requires every `@arnilo/*` range to be the cut version (exact `0.6.0` or caret `^0.6.0`); a range that merely *satisfies* it fails closed, because it lets two installs of one release line resolve different first-party minors.
- **Protected legs fail closed with one convention.** `scripts/blocked-gate.mjs` gives every environment-blocked gate the same shape and message, and `scripts/release-skip-manifest.mjs` records env var **names** only (never values) in the release evidence.

## Upgrade steps

1. Move the host process, containers, and CI legs to Node 22+ (§1) and bump `@types/node` to 22 if you build from source.
2. Bump every `@arnilo/*` dependency and peer to `^0.6.0` (0.5.x hosts: `^0.5.6` still resolves until you want the new knobs).
3. Move the third-party ranges your host pins itself (§2).
4. Remove `playwright-core` from an office install if you added it for `/diagrams` (§3).
5. Adopt the optional knobs where they matter (§4).
6. Build and run your suite. No persisted-data migration exists or is needed.

## Rollback

Pin the previous published line: `@arnilo/prism@0.5.6` (exact pins per package). Nothing persisted under 0.5 or 0.6 changes, so a pin rollback is safe; the Node floor, peer ranges, and host knobs listed here are the only deltas a 0.6 host would lose.

## Related APIs

- [Migration guide](migration.md): the era index of migration cuts with replacement tables and rollback notes.
- [Migrate Prism 0.4 to 0.5](migrate-to-0.5.md): the previous line's guide (plans 055–067).
- [Release and install](release-and-install.md): packed surfaces, install rules, support matrix, and the offline test budget.
- [Peer dependencies](peer-dependencies.md): every third-party peer declaration with range, optionality, subpath, and install line.
- [CHANGELOG](../CHANGELOG.md): the per-release record, including the folded 0.5.7 content.
