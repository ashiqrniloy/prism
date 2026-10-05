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

## `--max-cost` fails closed on any catalog-unknown model
- Section: Further Actions
- Priority: P2
- Source: plans/140-Prism-Code-Distribution-And-Release.md
- What: A model that is not in the provider's static catalog (every `opencode-go` gateway model, for example) reports `observed: null` for the maxCost axis, so `--max-cost <n>` aborts the run with `Run limit exceeded: maxCost` before the first token. Treat an unpriced model as zero-cost-with-a-warning, or price it from the live model list, instead of failing closed.
- Why: Plan 140 Task 6's live acceptance could not set a cost cap on the operator's free gateway model, so the journey shipped with the cap opt-out — the safety net that documentation promises is unreachable exactly where a naive user is most likely to try it.

## Publish evidence for a model that cannot complete the task
- Section: Further Actions
- Priority: P2
- Source: plans/140-Prism-Code-Distribution-And-Release.md
- What: The observational-memory observer declared `record_observation` with a bare `{ type: "object" }` schema, so a weaker model answered in prose and the pass recorded nothing while `/om:status` reported 0. That is fixed, but the general gap is a provider-capability matrix for structured worker output.
- Why: Every memory worker (observer, reflector, dropper) depends on tool-call compliance; the live matrix only exercises anthropic/openai-class models, so a weaker or unusual provider looks identical to a memory bug.

## Headless and acp-agent keep a synthesized local identity
- Section: Compromises Made
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- Compromise: Headless and `@arnilo/prism-acp-agent` keep their `config.userId`-based verified identity rather than the SDK literal `identity: "local-operator"`, because `assertIdentityMatchesOwnership` requires `identity.userId === ownership.userId` and the literal's fixed `userId` conflicts with the configured one.
- Implications: The literal profile is exercised only by `examples/agent-sdk-coding.ts`; a Prism Code host cannot opt into it without losing `config.userId`.

## Registry default duplicate policy silently shadows
- Section: Compromises Made
- Priority: P4
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- Compromise: `createToolRegistry`'s default duplicate policy stays `"replace"`. The SDK added an explicit `load_skill` collision check, but every other duplicate registration still silently shadows.
- Implications: A host tool can overwrite an SDK or plane tool without an error unless that specific collision is checked by hand.

## Retire AgentSdkDefinition from /docs and changelogs when SDK 0.2.0 ships
- Section: Further Actions
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- What: Update `docs/agent-sdk.md` to the shipped `Agent`/`session()` contract, add the host entry to `docs/index.md`, and leave the historical changelog mentions of `AgentSdkDefinition` as release history.
- Why: Phase 0 forbids `/docs` API edits while the rename is unshipped; the page still documents the released 0.1.0 `AgentSdkDefinition` return type.

## SDK local-operator profile cannot carry a host user id
- Section: Further Actions
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- What: Let the `"local-operator"` profile accept a host-supplied user id, or align Prism Code's `config.userId` handling with its `ownership` scope, so a host can use the literal and keep a configured user.
- Why: The literal hardcodes `userId: "local-operator"`, so any host with an ownership scope must build the identity itself.

## Replace the prose offer-reset pins with a typed check
- Section: Further Actions
- Priority: P4
- Source: plans/143-Phase-0-Reset-The-Offer.md
- What: When the `@arnilo/prism` 0.13.0 kernel surface lands, replace the `offer reset: PRODUCT.md` and `offer reset: README pointer` phrase and heading-line pins with a typed or generated check.
- Why: The pins assert prose, so a wording-only edit that keeps the contract fails them and costs a test edit, while a semantic change that keeps the exact strings passes.

## A `tool.call` deny is scoped to a call, not a run
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: A guardrail pack tripwire is now a denied tool call in a run that succeeds, because the hook bus converts a throwing `tool.call` handler into a deny and a deny is scoped to one call.
- Implications: A caller that asserted a pack tripwire would fail the run (`status === "failed"`, `GuardrailError` `ERR_PRISM_GUARDRAIL_BLOCKED`) now sees a succeeded run with a `hook_denied` tool result. Run-level rejection is only expressible as `ctx.reject` on a transform.

## `deny` beats `ask` at `tool.call`, reversing the 0.12 ordering
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: Deny-wins was chosen over 0.12's ask-then-deny ordering so a `tool.call` gate is a security boundary rather than a prompt.
- Implications: Ask-then-deny scenarios that used to suspend now deny outright. Hosts that relied on suspension as a review checkpoint for a call another rule also denies lose that checkpoint.

## `PermissionPolicy` was kept while `AgentConfig.permission` was retired
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The field and its dispatch use are gone, but the interface stays as the gate type for direct `dispatchToolCall` callers (which have no hook bus and check at `beforeExecute`) and for non-dispatch kernel users like resource loading.
- Implications: Two ways to express a tool gate now exist — a `tool.call` hook and a `PermissionPolicy` at `beforeExecute` — and a reader may not know which applies without checking whether the caller has a hook bus.

## `CompactionTrigger` and `resolveShouldCompact` were kept out of the `compaction.when` hook
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The four trigger kinds are a reusable policy evaluator with two non-session callers (the observational-memory attach loop and Prism Code's config), so they were kept as a helper a handler composes with. Only the alias `CompactionOptions.trigger` was removed.
- Implications: Auto-compaction has two layers (hook decision, else the kernel threshold) where one seam was implied, and a reader must know the evaluator is not itself a trigger registration.

## `HOOK_COMBINATION` is internal, not a root export
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The freeze test reads it from `src/hooks/index.ts`; exposing it would have meant a public-surface addition and a compat-baseline update for a rule set that is fully documented in `docs/next/hooks.md`.
- Implications: A host cannot introspect the combination rules at runtime, only observe them. Phase 2 work that wants to extend the table works against an internal symbol until someone decides to export it.

## Released 0.12 prose for the retired mechanisms was left in place
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: `docs/middleware-hooks.md`, `docs/compaction-and-retry.md`, and `docs/instruction-injection.md` still describe the retired API, and the historical CHANGELOG sections still name `stopHooks` and `maxStopContinuations`. Their test pins were dropped rather than rewritten.
- Implications: A reader arriving at a released docs page finds 0.12 API that no longer exists, with nothing on the page saying so. The released-doc pins that would flag the drift were removed rather than repointed.

## Promote the hook harness into `@arnilo/prism/testing`
- Section: Further Actions
- Priority: P1
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Ship `src/__tests__/helpers/hook-harness.ts` as a public testing subpath.
- Why: It is the standard way to drive a loop and assert which hooks fired, and every Phase 2 test needs it. Until it ships, a native package cannot test against the hook contract without writing a bespoke harness.

## Decide the fate of the five `artifact_*` `AgentEventPayload` variants
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Retire `artifact_validation_started`/`_finished`, `artifact_revision_started`, `artifact_finished`, and `artifact_failed`, or keep them as a package-emittable contract.
- Why: They are the residue of the retired `generate-validate-revise` loop strategy, sit in the frozen catalog as observe hooks, and are only likely to be emitted by a Phase 9 `workflows` package. The current state is neither retired nor usable.

## Make the context budget a `context.build` handler
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Re-express `applyContextBudget` as a `context.build` handler that sees handler-added blocks.
- Why: `context.build` runs after assembly, so blocks a handler adds escape the budget entirely — the budget still trims its own group but nothing feeds it. This is the Phase 8 (`@arnilo/prism-context-engineering`) work the deferral points at.

## Give the run-start `run.input` transform a turn-1 provider path
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Either make turn-1 assembly read the messages `run.input` produced, or document the turn-1 boundary in `docs/next/hooks.md`.
- Why: `run.input` rewrites the messages appended to session history, but turn 1's provider request is assembled from the raw `nextInput`, so a rewrite first reaches the provider on turn 2. A reject is unaffected, so the security-relevant case is already correct.

## Add session-lifecycle hooks if Phase 2 needs them
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Add a session-open/session-close seam (an observe hook keyed on a real event, or a named hook) if Phase 2 needs one.
- Status: Delivered in plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md Task 7 as the `session.opened` / `session.closed` observe hooks. Part B Task 5 (`hooks-json`) moves onto `session.opened` and drops the first-`context.build` piggyback.
- Why: `session_start` had no observe-hook replacement — `OBSERVE_HOOKS` is keyed on `AgentEventPayload["type"]` and no `session_started` event exists — so the one real user now piggybacks on the first `context.build` of a session. That works, but a Phase 2 that wants to open a session per se has no seam.

## Decide whether `AgentRunState.stopReason` keeps its now-unreachable members
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Narrow the persisted `stopReason` union, or record why the retired values stay as vocabulary hosts may still have written.
- Why: `hook_stop`/`hook_limit` are the only values the kernel writes now. The union is persisted, so it was left intact, but each retired value is a branch a future reader will look for.

## Decide the kernel skills catalog's owner
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Move the kernel skills catalog onto a named `kernel:context.build` registration. The owner seam shipped in plan 146 Task 3 (`bus.registrar("kernel")`); the move is deferred to Phase 3, where `skills.disclosure` reshapes the config. `disable.skills` already covers hiding skills.
- Why: The catalog is contributed during assembly today. Moving it changes where it lands relative to host `context.build` handlers, which shifts the prompt bytes that `src/testing/prefix-stability-conformance.ts` pins, and it depends on run-state `loaded`/demotion sets (`src/skill-disclosure.ts`).
- Status: Delivered in plans/148-Phase-3-Part-A-Host-Port-Event-Catalog-And-Agent-Config.md Task 5 as `src/skills-catalog.ts` (`kernel:context.build`, listed by `inspect().hooks` and removable via `disable.hooks`). Skills now render ahead of context blocks; `prefix-stability-conformance` gained `skillsDisclosure` and no longer pins byte-identical output.

## Decide whether a failed `requires` check skips an `optional` package
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Make the call in the Phase 4 manifest plan: today `optional` covers a `setup` throw only, and `kernel_range`, `missing_package`, and `missing_service` stay fatal.
- Why: A manifest entry marked `optional: true` is meant to be skippable, and a kernel-range mismatch is the most common reason an optional package cannot load. Until it is decided, such a package fails the whole load.
- Status: Still open after plans/150-Phase-4-Manifest-And-Installer.md; `loadManifest` skips an `optional` entry only when the package is not installed.

## Close the `search_tools` gap for `when`-hidden package tools
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Narrow the `search_tools` index by the same per-turn `when` filter, or by Phase 3's `tools.disclosure`.
- Why: The index is built once per run from the run's tool list, which `when` does not narrow, so with `toolsDisclosure: "search"` a hidden tool can still be found by search. `dispatchFilter` still refuses to run it, and no test pins the gap.

## Move the remaining readers of `agent.config.tools` / `skills` onto the merged view
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md; narrowed by plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md Task 5
- What: `agent.tools` / `agent.skills` (frozen `ToolInfo` / `SkillInfo`) are the merged view; `/tools` (`activeToolNames`) and the two `app.agent.config.tools.list()` examples moved onto it. Three readers remain: `packages/prism-code/src/tui/index.ts` `toolRegistry()` (MCP session disable registers and unregisters on a `ToolRegistry`, which `AgentConfig.tools: { add }` no longer is), the `/skills` command's `config.skills?.add` (`inspectSkills` needs `Skill` bodies, and `SkillInfo` has none), and `packages/prism-core/src/governance/evals/scenarios.ts` `wrapTools`, which does not wrap a package tool.
- Why: `agent.config` stays the host's input, so these 0.12 consumers do not see package tools. `wrapTools` would not wrap a package tool, which weakens failure injection. The first two die with the Prism Code rewrite (Phase 12); `wrapTools` needs a way to wrap a package's tool without loading the package twice.

## Review the serialized `appendEntry` path
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Decide whether session-level append serialization stays in `RuntimeAgentSession`, moves into the store contract, or gets a real tip check on `expectedParentId`.
- Why: Plan 146 Task 7 found that `expectedParentId` only validates existence, so two appends from one tip silently orphan one entry. The fix serializes every append and rebases a tip-appended entry; it touches the central append path for every entry kind.

## Settle when `session.opened` fires and who receives it
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Revisit in Phase 3 when `Agent` / `Session` are reshaped: eager versus lazy open, and whether `session.opened`/`session.closed` should also reach subscribers.
- Why: Today `session.opened` fires lazily (first run, command, `set`, or `close()`) and only when a handler or package state needs the branch, and the two lifecycle events reach hooks only so existing streams are unchanged.

## Rename `Credential` to `Secret` on `credentials.resolve`
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Do it in the Phase 5 model-layer plan, with the one baseline change.
- Why: The roadmap names `Secret`; Part A returns the existing `Credential` and `models.client` is a thin client over today's provider resolution. Phase 5 replaces the internals, not the member names.

## Re-key `agent.inspect().hooks` when the 0.12 observe hook names are renamed
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Phase 3 renames the snake_case observe hooks to dotted names; update `inspect()` tests, `docs/next/packages.md`, and `examples/define-package.ts` in that plan, and have Phase 12's `doctor` read field names from `AgentInspection`.
- Why: `inspect().hooks` is keyed by today's catalog names (`tool_execution_finished`), so a rename changes its output.

## Run the `package_state` store conformance step against Postgres
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Run `bun run test:postgres` with a Postgres URL once and record the result in plan 148's or the next store plan's Notes.
- Why: Task 7 covered the memory store, the kernel JSONL store, and SQLite. The Postgres leg needs a URL and was not run. No DDL changed, since `kind` is plain text.
- Status: Delivered in plans/153-Phase-6-Session-Store-Packages.md Task 5. `@arnilo/prism-store-postgres` runs the whole `storeConformance` suite — the `package-state` leg included — against a live server: 45 pass / 0 fail with `PRISM_TEST_POSTGRES_URL`, and 37 skips without one. The measured run is in that task's Notes.

## Clear the red baseline of `bun run test`
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Delete stale `dist/__tests__/*.test.js` with no source, then fix or retire the recorded failures: `prism init` (Bun 1.4.2 prints no per-test line in a non-TTY run), `host-composition-compat` (`policy-chain-snapshot`), the agent-sdk peer check, the ACP bin spawn path (`dist/bin/prism-acp-agent.js`), and the field-policy timing benchmark.
- Why: Plans 144-146 each recorded the same failures and attributed them by cause, without a before/after run. A permanently red suite hides a real regression, and the TUI frame-budget test (`filters 50k paths inside a frame budget`) is timing-flaky as well.

## Move the hosts onto `session.resume` and delete the checkpoint lifecycle
- Section: Further Actions
- Priority: P1
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `resumeAgentRun`, `createAgentRunLifecycle` and `AgentRunRef` are still the resume path of AG-UI `handler.ts`, ACP `recovery.ts`, the server handler, channels `runtime-turn.ts`, the supervisor's nested resume and Prism Code. Move each to `agent.session({ id }).resume(decisions)` over the store slot, then delete the lifecycle.
- Why: Task 4 shipped `session.resume` on the same internal core but did not move the hosts, so there are still two public resume paths. Belongs with Phase 6 (stores) and Phase 10/12 (hosts).

## Decide how legacy unscoped sessions reopen under an ownership-scoped agent
- Section: Further Actions
- Priority: P1
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `agent.session({ id })` requires every entry on the branch to carry the agent's ownership scope. Sessions written before ownership stamping have none, so they answer `SessionNotFoundError`. Add a migration or an explicit unscoped-read policy.
- Why: Prism Code scopes its agent to `{ tenantId: "local", userId: "local" }`, so adopting `agent.session` would hide a user's existing sessions.

## Add `listSessions` and `deleteSession` to the durable stores
- Section: Further Actions
- Priority: P2
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: Implement both in the JSONL store, `packages/prism-core` SQLite, Postgres and NATS stores, and Prism Code's session store, and run `assertSessionStoreConforms(..., { exerciseSessionIndex: true })` against each.
- Why: `agent.sessions.list/delete` answer `UnsupportedStoreCapabilityError` on every store except the kernel memory store. Phase 6.
- Status: Delivered for the JSONL, SQLite, and Postgres stores in plans/153-Phase-6-Session-Store-Packages.md Tasks 3-5 (each passes the `list-and-delete` leg of `storeConformance`, the renamed successor of `assertSessionStoreConforms(..., { exerciseSessionIndex: true })`), and Prism Code's session store follows because `resolveSessionStore` returns the SQLite store. Still open for the NATS store (`packages/prism-core/src/sessions/nats`), which plan 153 left in the family package.

## Close the agent's sessions on `agent.dispose()`
- Section: Further Actions
- Priority: P2
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: Keep an agent-owned live-session set (including sessions `fork()` builds inside the session class) and close them in `dispose()`.
- Why: The roadmap says `dispose()` closes sessions; today it ends subscriptions and packages only.

## Isolate Prism Code's tests from the real home directory
- Section: Further Actions
- Priority: P3
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `packages/prism-code` tests that use the default store write to `<prism home>/sessions/sessions.db`. Add a home override for tests, move the remaining tests off the real path, and clean the stale `test-prog-session` and `test-eager-session` rows.
- Why: Plan 149 found ~130 stale rows there, which made a strict `agent.session({ id })` fail on ownership.

## Trace the `@arnilo/prism-providers` export count growth
- Section: Further Actions
- Priority: P3
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `scripts/budgets.json` moved from 588 to 590 at plan 149 Task 6 with no attribution.
- Why: A rebaseline without a cause hides an unintended public export.

## Rewrite the older `scripts/` conformance suites for the Phase 1-3 shapes
- Section: Further Actions
- Priority: P3
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `scripts/phase8-conformance`, `phase20-security`, `phase40-security`, `obscura-host-conformance` and `phase16-freeze` pass `tools: [...]`, use `askEveryTool`, and read the old durable-resume shapes.
- Why: They fail on shapes plans 144-148 changed, so their coverage is dark.

## Fix the stale `install-smoke` assertions
- Section: Further Actions
- Priority: P1
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: `src/__tests__/install-smoke.test.ts` checks `createCodingCompactionStrategy` from `@arnilo/prism-memory/compaction/llm` (no longer exported) and its packed integration script expects an exclusive `shell` call not to overlap siblings.
- Why: It is the only test that installs the packed tarballs, including `prism new package`, and it is red for reasons that are not about the install.

## Install lock for concurrent manifest writers
- Section: Compromises Made
- Priority: P2
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- Compromise: `install`, `remove`, `configure`, `setEnabled`, and `assignSlot` read, change, and atomically write one manifest with no lock.
- Implications: Two concurrent writers on one scope can lose an update. No torn file.

## Move the CLI `--provider` table out with the runner modes
- Section: Further Actions
- Priority: P2
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: Delete `src/cli-providers.ts` and its `core-boundaries.test.ts` allowance when Phase 11 retires the runner modes.
- Why: It names provider packages inside core as a temporary seam.

## Update the released docs for `prism add` and `prism new package`
- Section: Further Actions
- Priority: P3
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: `docs/cli-rpc.md`, `provider-packages.md`, `release-and-install.md`, `host-compositions.md`, `dev-inspector.md`, and the `docs.test.ts` assertions that pin them still describe `prism init` and `providers add`.
- Why: They are 0.12.1 pages and change at the Phase 11 release.
