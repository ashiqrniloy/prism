# Project Backlog

Tracking compromises, deferred work, and follow-up actions recorded from completed implementation plans.

## Command Code provider package (deferred past 0.13.0)
- Review (plan 205, 2026-10-25): post-0.13. Owner scope change: the provider was in 0.13.0 and was moved out. Additive provider package, no public 0.13 contract change.
- Section: Further Actions
- Priority: P2
- Source: plans/205-Phase-11-Part-AC-Command-Code-Provider.md
- What: Ship `@arnilo/prism-provider-commandcode` on the Provider API's Chat, Responses, and Messages wires, with per-wire prompt-cache parity against `pi-commandcode-provider` 0.7.10, ZDR, plan errors, and cache pricing.
- Why: Deferred out of 0.13.0 by the owner on 2026-10-25; the 0.13.0 provider set stays the seven packages already in the tree. Plan 205 carries the research and task breakdown to run in the first release after 0.13.0.

## Ollama Cloud provider package (deferred past 0.13.0)
- Review (plan 206, 2026-10-25): post-0.13. Owner scope change: the provider was in 0.13.0 and was moved out. Additive provider package, no public 0.13 contract change.
- Section: Further Actions
- Priority: P2
- Source: plans/206-Phase-11-Part-AD-Ollama-Cloud-Provider.md
- What: Ship `@arnilo/prism-provider-ollama-cloud` with a route chosen by measured cache reuse (native `/api/chat` `prompt_eval_cached_count`, pi-compatible `/v1` route), a per-model thinking map, bounded discovery, and `ollamaCloudBalance()`.
- Why: Deferred out of 0.13.0 by the owner on 2026-10-25. Plan 206 carries the research and task breakdown to run after 0.13.0, after plan 205.

## Re-audit tarball diet and bundle footprint for Agent SDK docs and baseline
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Compromises Made
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- Compromise: Raised `root.packedBytes` from 1486492 to 1562714 (+5.1%) in `scripts/budgets.json` to accommodate `docs/agent-sdk.md`, compatibility baseline entries, and plan documentation rather than trimming existing docs.
- Implications: Packed tarball size ceiling increased slightly; future doc additions will need to watch the budget limit closely.

## Consolidate optional peer dependency resolution between Agent SDK and host apps
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- Compromise: Marked `@arnilo/prism-coding-tools`, `@arnilo/prism-hooks`, and `@arnilo/prism-mcp` as peerDependencies of `@arnilo/prism-agent-sdk` to guarantee lockstep versions in consumer workspaces rather than dynamic runtime imports with fallback stubs.
- Implications: Consumers installing `@arnilo/prism-agent-sdk` must satisfy or accept npm/bun peer dependency warnings unless all three are provided or ignored.

## Hot-reload / dynamic update of skills and hooks in live agent session
- Closed (2026-10-29): resolved. `agent.reload()` re-reads `skills.dirs`, re-runs every package `setup` (so package-discovered `.agents/skills` refresh), and re-compiles `AgentConfig.hooks`/package hooks on a fresh bus and slot registry, swapping in place with atomic failure. Open sessions keep their conversation and see the new skills/hooks next run; docs/agent.md has the contract and `src/__tests__/agent-reload.test.ts` covers success, failure rollback, concurrency, dispose, open-session continuity, and hook recompilation.
- Section: Further Actions
- Priority: P2
- Source: plans/134-Prism-Agent-SDK.md
- What: Add a runtime mutation method on `AgentSession` or `Agent` to re-discover skills and re-compile hooks without rebuilding the entire `Agent` instance via `defineAgent`.
- Why: Interactive coding apps like Prism Code (Plan 135) may benefit from on-the-fly editing of `.agents/skills` or `.agents/hooks.json` during a session without tearing down the conversation.

## Structured telemetry and tracing integration for defineAgent assembly
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/134-Prism-Agent-SDK.md
- What: Expose OpenTelemetry spans or telemetry hooks covering the tool-plane resolution and eager MCP bridge startup phases in `defineAgent`.
- Why: Allows host applications to monitor startup latency and failures in remote or stdio MCP server handshakes.

## Local release gate runs without the Postgres leg
- Closed (plan 174 Task 11, 2026-10-15): resolved. A local `postgres:17` podman container plus `PRISM_TEST_POSTGRES_URL=postgres://postgres:prism@localhost:5432/postgres` makes `bun run test:postgres` (55 tests, 55 pass) write `scripts/postgres-evidence.json`; `bun run release:evidence` then records `blocked: false` with `pass` for "test:postgres durable conformance", and `bun run release:gate` exits 0 in 92s. `docs/next/release.md` carries the recipe.
- Section: Compromises Made
- Priority: P2
- Source: plans/135-Prism-Code-App.md

## bun install parity for file:../.. workspace deps
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- Compromise: Per-package `@arnilo/prism: file:../..` copies produced by `bun install`/`bun ci` were replaced manually (workspace resolution) during verification instead of fixing the toolchain rule.
- Implications: A fresh install can re-break provider conformance (`instanceof` across duplicate module trees) and the `npm ls` packaging guard; the toolchain needs a link-vs-copy rule or documented install flag.

## Local Postgres path for release.mjs gate
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/135-Prism-Code-App.md
- What: Provide a docker-compose/Postgres fixture (or an explicit required-env waiver surface) so `release.mjs gate --update-baseline` does not need the publish-mode marker on developer hosts.
- Why: Baseline regeneration currently cannot run on a workstation without Postgres, which makes release verification host-dependent.

## Fix bun file:../.. copy-vs-link workspace resolution
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/135-Prism-Code-App.md
- What: Investigate the bun hoisted-linker behavior that materializes `file:../..` root devDependencies as per-package real copies, and pin the fix (link rule or documented `bun install` option) in the toolchain docs and a regression check.
- Why: Fresh installs currently break cross-package class identity (provider conformance) and the `npm ls` packaging guard.

## Loopback OAuth callback listener for `/mcp login`
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/138-Prism-Code-Sessions-And-MCP.md
- What: Add a loopback HTTP listener (default redirect `http://127.0.0.1:1456/oauth/callback`, overridable via `PRISM_MCP_OAUTH_REDIRECT_URI`) so `/mcp login <id>` completes the authorization-code flow without the operator pasting the callback URL or code.
- Why: Pasting works today but is error-prone; a listener removes a manual step while keeping the pasted path as fallback.

## Per-server reconnect backoff surfaced in the MCP footer
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/138-Prism-Code-Sessions-And-MCP.md
- What: Add a retry/backoff policy to the agent-sdk MCP plane and surface pending reconnect attempts in the Prism Code footer (`MCP: connected/total (n failed)` today only reflects the last status).
- Why: A failed server currently stays failed until the user runs `/mcp reconnect <id>`; transient network failures need no user action once the plane retries on its own.

## Cross-package @arnilo/prism copies go stale after a root rebuild
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/139-Prism-Code-TUI-Rendering-And-UX.md
- What: The per-package `node_modules/@arnilo/prism` entries bun materializes for the `file:../..` devDependency are hardlinks into `~/.bun/install/cache/@arnilo/prism/@T@*` snapshots, so rebuilding the root `dist` never refreshes them; a workspace then fails at runtime with missing exports (observed: `SESSION_TITLE_METADATA_KEY`, `DiscoveryRoot`). Fix the linker rule or add a post-install staleness check, and commit the regenerated `bun.lock` (the old one was unparseable by bun 1.4.2).
- Why: Plan 139 Task 7's PTY journeys could not start the built binary until the copies were re-pointed at the repo root; the same failure will hit any workspace that uses a newly added root API.

## `usedDefaults` precision for catalog entries
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/137-Prism-Code-Agent-Loop-And-Skills.md
- What: Record assumed limits separately from `usedDefaults` (which reports a catalog miss per its docstring) when a catalog entry declares capabilities but no limits.
- Why: The footer would otherwise signal a catalog miss while the run is quietly using assumed limits.

## Split the live task leg across model strengths
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/137-Prism-Code-Agent-Loop-And-Skills.md
- What: Give the tool-use-heavy task leg its own model env var instead of running on whatever key is configured.
- Why: Haiku-class models can flake on multi-step file/test work, which would read as a CLI regression in the live matrix.

## `--max-cost` fails closed on any catalog-unknown model
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/140-Prism-Code-Distribution-And-Release.md
- What: A model that is not in the provider's static catalog (every `opencode-go` gateway model, for example) reports `observed: null` for the maxCost axis, so `--max-cost <n>` aborts the run with `Run limit exceeded: maxCost` before the first token. Treat an unpriced model as zero-cost-with-a-warning, or price it from the live model list, instead of failing closed.
- Why: Plan 140 Task 6's live acceptance could not set a cost cap on the operator's free gateway model, so the journey shipped with the cap opt-out — the safety net that documentation promises is unreachable exactly where a naive user is most likely to try it.

## Publish evidence for a model that cannot complete the task
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/140-Prism-Code-Distribution-And-Release.md
- What: The observational-memory observer declared `record_observation` with a bare `{ type: "object" }` schema, so a weaker model answered in prose and the pass recorded nothing while `/om:status` reported 0. That is fixed, but the general gap is a provider-capability matrix for structured worker output.
- Why: Every memory worker (observer, reflector, dropper) depends on tool-call compliance; the live matrix only exercises anthropic/openai-class models, so a weaker or unusual provider looks identical to a memory bug.

## Headless and acp-agent keep a synthesized local identity
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- Compromise: Headless and `@arnilo/prism-acp-agent` keep their `config.userId`-based verified identity rather than the SDK literal `identity: "local-operator"`, because `assertIdentityMatchesOwnership` requires `identity.userId === ownership.userId` and the literal's fixed `userId` conflicts with the configured one.
- Implications: The literal profile is exercised only by `examples/agent-sdk-coding.ts`; a Prism Code host cannot opt into it without losing `config.userId`.

## Registry default duplicate policy silently shadows
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P4
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- Compromise: `createToolRegistry`'s default duplicate policy stays `"replace"`. The SDK added an explicit `load_skill` collision check, but every other duplicate registration still silently shadows.
- Implications: A host tool can overwrite an SDK or plane tool without an error unless that specific collision is checked by hand.

## Retire AgentSdkDefinition from /docs and changelogs when SDK 0.2.0 ships
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- What: Update `docs/agent-sdk.md` to the shipped `Agent`/`session()` contract, add the host entry to `docs/index.md`, and leave the historical changelog mentions of `AgentSdkDefinition` as release history.
- Why: Phase 0 forbids `/docs` API edits while the rename is unshipped; the page still documents the released 0.1.0 `AgentSdkDefinition` return type.

## SDK local-operator profile cannot carry a host user id
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/142-Phase-1-One-Import-Runs-An-Agent.md
- What: Let the `"local-operator"` profile accept a host-supplied user id, or align Prism Code's `config.userId` handling with its `ownership` scope, so a host can use the literal and keep a configured user.
- Why: The literal hardcodes `userId: "local-operator"`, so any host with an ownership scope must build the identity itself.

## Replace the prose offer-reset pins with a typed check
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P4
- Source: plans/143-Phase-0-Reset-The-Offer.md
- What: When the `@arnilo/prism` 0.13.0 kernel surface lands, replace the `offer reset: PRODUCT.md` and `offer reset: README pointer` phrase and heading-line pins with a typed or generated check.
- Why: The pins assert prose, so a wording-only edit that keeps the contract fails them and costs a test edit, while a semantic change that keeps the exact strings passes.

## A `tool.call` deny is scoped to a call, not a run
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: A guardrail pack tripwire is now a denied tool call in a run that succeeds, because the hook bus converts a throwing `tool.call` handler into a deny and a deny is scoped to one call.
- Implications: A caller that asserted a pack tripwire would fail the run (`status === "failed"`, `GuardrailError` `ERR_PRISM_GUARDRAIL_BLOCKED`) now sees a succeeded run with a `hook_denied` tool result. Run-level rejection is only expressible as `ctx.reject` on a transform.

## `deny` beats `ask` at `tool.call`, reversing the 0.12 ordering
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: Deny-wins was chosen over 0.12's ask-then-deny ordering so a `tool.call` gate is a security boundary rather than a prompt.
- Implications: Ask-then-deny scenarios that used to suspend now deny outright. Hosts that relied on suspension as a review checkpoint for a call another rule also denies lose that checkpoint.

## `PermissionPolicy` was kept while `AgentConfig.permission` was retired
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The field and its dispatch use are gone, but the interface stays as the gate type for direct `dispatchToolCall` callers (which have no hook bus and check at `beforeExecute`) and for non-dispatch kernel users like resource loading.
- Implications: Two ways to express a tool gate now exist — a `tool.call` hook and a `PermissionPolicy` at `beforeExecute` — and a reader may not know which applies without checking whether the caller has a hook bus.

## `CompactionTrigger` and `resolveShouldCompact` were kept out of the `compaction.when` hook
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The four trigger kinds are a reusable policy evaluator with two non-session callers (the observational-memory attach loop and Prism Code's config), so they were kept as a helper a handler composes with. Only the alias `CompactionOptions.trigger` was removed.
- Implications: Auto-compaction has two layers (hook decision, else the kernel threshold) where one seam was implied, and a reader must know the evaluator is not itself a trigger registration.

## `HOOK_COMBINATION` is internal, not a root export
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: The freeze test reads it from `src/hooks/index.ts`; exposing it would have meant a public-surface addition and a compat-baseline update for a rule set that is fully documented in `docs/next/hooks.md`.
- Implications: A host cannot introspect the combination rules at runtime, only observe them. Phase 2 work that wants to extend the table works against an internal symbol until someone decides to export it.

## Released 0.12 prose for the retired mechanisms was left in place
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Compromise: `docs/middleware-hooks.md`, `docs/compaction-and-retry.md`, and `docs/instruction-injection.md` still describe the retired API, and the historical CHANGELOG sections still name `stopHooks` and `maxStopContinuations`. Their test pins were dropped rather than rewritten.
- Implications: A reader arriving at a released docs page finds 0.12 API that no longer exists, with nothing on the page saying so. The released-doc pins that would flag the drift were removed rather than repointed.

## Promote the hook harness into `@arnilo/prism/testing`
- Closed (2026-10-29): resolved by plan 147 Task 2 before this entry was actioned. The harness shipped as `loopConformance` on the public `./testing` subpath (`src/testing/loop-conformance.ts`, exported from `src/testing/index.ts`), not under the old test-helper path. It takes a `LoopStrategy` (or full options), drives `createAgent`/`session.run` with a scripted provider, registers a firing probe for every `HOOK_CATALOG` entry unless `probe: false`, and returns `{ result?, error?, events, fired, agent, session }`. `docs/testing.md` documents the options and result; `hook-catalog-coverage.test.ts` proves every named and observe hook fires from both the default loop and a custom planning loop; `package-conformance.test.ts` covers the bare-`LoopStrategy` form; `packages/integrations/workflows` and `packages/tools/coding` consume it through `@arnilo/prism/testing`. No separate `hookHarness` alias is exported.
- Section: Further Actions
- Priority: P1
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Ship `src/__tests__/helpers/hook-harness.ts` as a public testing subpath.
- Why: It is the standard way to drive a loop and assert which hooks fired, and every Phase 2 test needs it. Until it ships, a native package cannot test against the hook contract without writing a bespoke harness.

## Decide the fate of the five `artifact_*` `AgentEventPayload` variants
- Review (plan 174 Task 1, 2026-10-14): stale for the catalog variants (plan 169 Task 8). Remaining orphan `ArtifactValidation` (`src/contracts-core/loop.ts:9`) is deleted with the plan 175 docs rewrite, not a Part A contract change.
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Status: Plan 169 Task 8 found the five variants are already absent from the catalog and `src/`; only the orphan `ArtifactValidation` interface (`src/contracts-core/loop.ts:9`) and the released 0.12.1 docs remain. Delete the interface with the Phase 11 docs rewrite.
- What: Retire `artifact_validation_started`/`_finished`, `artifact_revision_started`, `artifact_finished`, and `artifact_failed`, or keep them as a package-emittable contract.
- Why: They are the residue of the retired `generate-validate-revise` loop strategy, sit in the frozen catalog as observe hooks, and are only likely to be emitted by a Phase 9 `workflows` package. The current state is neither retired nor usable.

## Make the context budget a `context.build` handler
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status already cites plan 158 Task 7; `context_engineering_budget_sees_handler_blocks`.
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- Status: Delivered by plan 158 Task 7 (`@arnilo/prism-context-engineering`). The handler runs at priority -1000 and sees every block another handler added this turn. `context_engineering_budget_sees_handler_blocks` pins it.
- What: Re-express `applyContextBudget` as a `context.build` handler that sees handler-added blocks.
- Why: `context.build` runs after assembly, so blocks a handler adds escape the budget entirely — the budget still trims its own group but nothing feeds it. This is the Phase 8 (`@arnilo/prism-context-engineering`) work the deferral points at.

## Give the run-start `run.input` transform a turn-1 provider path
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Either make turn-1 assembly read the messages `run.input` produced, or document the turn-1 boundary in `docs/next/hooks.md`.
- Why: `run.input` rewrites the messages appended to session history, but turn 1's provider request is assembled from the raw `nextInput`, so a rewrite first reaches the provider on turn 2. A reject is unaffected, so the security-relevant case is already correct.

## Add session-lifecycle hooks if Phase 2 needs them
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status cites plan 146 Task 7 (`session.opened` / `session.closed`).
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Add a session-open/session-close seam (an observe hook keyed on a real event, or a named hook) if Phase 2 needs one.
- Status: Delivered in plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md Task 7 as the `session.opened` / `session.closed` observe hooks. Part B Task 5 (`hooks-json`) moves onto `session.opened` and drops the first-`context.build` piggyback.
- Why: `session_start` had no observe-hook replacement — `OBSERVE_HOOKS` is keyed on `AgentEventPayload["type"]` and no `session_started` event exists — so the one real user now piggybacks on the first `context.build` of a session. That works, but a Phase 2 that wants to open a session per se has no seam.

## Decide whether `AgentRunState.stopReason` keeps its now-unreachable members
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Narrow the persisted `stopReason` union, or record why the retired values stay as vocabulary hosts may still have written.
- Why: `hook_stop`/`hook_limit` are the only values the kernel writes now. The union is persisted, so it was left intact, but each retired value is a branch a future reader will look for.

## Decide the kernel skills catalog's owner
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status cites `src/skills-catalog.ts` (plan 148 Task 5).
- Section: Further Actions
- Priority: P2
- Source: plans/145-Phase-1-Part-B-Retire-0-12-Interception-Mechanisms.md
- What: Move the kernel skills catalog onto a named `kernel:context.build` registration. The owner seam shipped in plan 146 Task 3 (`bus.registrar("kernel")`); the move is deferred to Phase 3, where `skills.disclosure` reshapes the config. `disable.skills` already covers hiding skills.
- Why: The catalog is contributed during assembly today. Moving it changes where it lands relative to host `context.build` handlers, which shifts the prompt bytes that `src/testing/prefix-stability-conformance.ts` pins, and it depends on run-state `loaded`/demotion sets (`src/skill-disclosure.ts`).
- Status: Delivered in plans/148-Phase-3-Part-A-Host-Port-Event-Catalog-And-Agent-Config.md Task 5 as `src/skills-catalog.ts` (`kernel:context.build`, listed by `inspect().hooks` and removable via `disable.hooks`). Skills now render ahead of context blocks; `prefix-stability-conformance` gained `skillsDisclosure` and no longer pins byte-identical output.

## Decide whether a failed `requires` check skips an `optional` package
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Make the call in the Phase 4 manifest plan: today `optional` covers a `setup` throw only, and `kernel_range`, `missing_package`, and `missing_service` stay fatal.
- Why: A manifest entry marked `optional: true` is meant to be skippable, and a kernel-range mismatch is the most common reason an optional package cannot load. Until it is decided, such a package fails the whole load.
- Status: Still open after plans/150-Phase-4-Manifest-And-Installer.md; `loadManifest` skips an `optional` entry only when the package is not installed.

## Close the `search_tools` gap for `when`-hidden package tools
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Narrow the `search_tools` index by the same per-turn `when` filter, or by Phase 3's `tools.disclosure`.
- Why: The index is built once per run from the run's tool list, which `when` does not narrow, so with `toolsDisclosure: "search"` a hidden tool can still be found by search. `dispatchFilter` still refuses to run it, and no test pins the gap.

## Move the remaining readers of `agent.config.tools` / `skills` onto the merged view
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md; narrowed by plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md Task 5
- What: `agent.tools` / `agent.skills` (frozen `ToolInfo` / `SkillInfo`) are the merged view; `/tools` (`activeToolNames`) and the two `app.agent.config.tools.list()` examples moved onto it. One reader remains: `packages/prism-core/src/governance/evals/scenarios.ts` `wrapTools`, which does not wrap a package tool.
- Why: `agent.config` stays the host's input, so this 0.12 consumer does not see package tools, and `wrapTools` would not wrap a package tool, which weakens failure injection. The two Prism Code readers died with the lab (plan 173 Task 8); `wrapTools` needs a way to wrap a package's tool without loading the package twice.

## Review the serialized `appendEntry` path
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Decide whether session-level append serialization stays in `RuntimeAgentSession`, moves into the store contract, or gets a real tip check on `expectedParentId`.
- Why: Plan 146 Task 7 found that `expectedParentId` only validates existence, so two appends from one tip silently orphan one entry. The fix serializes every append and rebases a tip-appended entry; it touches the central append path for every entry kind.

## Settle when `session.opened` fires and who receives it
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Revisit in Phase 3 when `Agent` / `Session` are reshaped: eager versus lazy open, and whether `session.opened`/`session.closed` should also reach subscribers.
- Why: Today `session.opened` fires lazily (first run, command, `set`, or `close()`) and only when a handler or package state needs the branch, and the two lifecycle events reach hooks only so existing streams are unchanged.

## Rename `Credential` to `Secret` on `credentials.resolve`
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Do it in the Phase 5 model-layer plan, with the one baseline change.
- Why: The roadmap names `Secret`; Part A returns the existing `Credential` and `models.client` is a thin client over today's provider resolution. Phase 5 replaces the internals, not the member names.

## Re-key `agent.inspect().hooks` when the 0.12 observe hook names are renamed
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Phase 3 renames the snake_case observe hooks to dotted names; update `inspect()` tests, `docs/next/packages.md`, and `examples/define-package.ts` in that plan, and have Phase 12's `doctor` read field names from `AgentInspection`.
- Why: `inspect().hooks` is keyed by today's catalog names (`tool_execution_finished`), so a rename changes its output.

## Run the `package_state` store conformance step against Postgres
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status cites plan 153 Task 5.
- Section: Further Actions
- Priority: P3
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Run `bun run test:postgres` with a Postgres URL once and record the result in plan 148's or the next store plan's Notes.
- Why: Task 7 covered the memory store, the kernel JSONL store, and SQLite. The Postgres leg needs a URL and was not run. No DDL changed, since `kind` is plain text.
- Status: Delivered in plans/153-Phase-6-Session-Store-Packages.md Task 5. `@arnilo/prism-store-postgres` runs the whole `storeConformance` suite — the `package-state` leg included — against a live server: 45 pass / 0 fail with `PRISM_TEST_POSTGRES_URL`, and 37 skips without one. The measured run is in that task's Notes.

## Clear the red baseline of `bun run test`
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/146-Phase-2-Part-A-Package-Loader-And-PackageAPI.md
- What: Delete stale `dist/__tests__/*.test.js` with no source, then fix or retire the recorded failures: `prism init` (Bun 1.4.2 prints no per-test line in a non-TTY run), `host-composition-compat` (`policy-chain-snapshot`), the agent-sdk peer check, the ACP bin spawn path (`dist/bin/prism-acp-agent.js`), and the field-policy timing benchmark.
- Why: Plans 144-146 each recorded the same failures and attributed them by cause, without a before/after run. A permanently red suite hides a real regression, and the TUI frame-budget test (`filters 50k paths inside a frame budget`) is timing-flaky as well.

## Move the hosts onto `session.resume` and delete the checkpoint lifecycle
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: `src/__tests__/kernel-no-checkpoints.test.ts:50-57` asserts `resumeAgentRun` and `createAgentRunLifecycle` are absent. No production caller.
- Section: Further Actions
- Priority: P1
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `resumeAgentRun`, `createAgentRunLifecycle` and `AgentRunRef` are still the resume path of AG-UI `handler.ts`, ACP `recovery.ts`, the server handler, channels `runtime-turn.ts`, and the supervisor's nested resume. Move each to `agent.session({ id }).resume(decisions)` over the store slot, then delete the lifecycle.
- Why: Task 4 shipped `session.resume` on the same internal core but did not move the hosts, so there are still two public resume paths. Belongs with Phase 6 (stores) and Phase 10/12 (hosts).

## Decide how legacy unscoped sessions reopen under an ownership-scoped agent
- Review (plan 174 Task 1, 2026-10-14): post-0.13. §1.4 forbids a compatibility read. Plan 175 migration note records that unscoped 0.12 sessions do not reopen.
- Section: Further Actions
- Priority: P1
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `agent.session({ id })` requires every entry on the branch to carry the agent's ownership scope. Sessions written before ownership stamping have none, so they answer `SessionNotFoundError`. Add a migration or an explicit unscoped-read policy.
- Why: Prism Code scopes its agent to `{ tenantId: "local", userId: "local" }`, so adopting `agent.session` would hide a user's existing sessions.

## Add `listSessions` and `deleteSession` to the durable stores
- Review (plan 174 Task 1, 2026-10-14): not a new contract. JSONL/sqlite/postgres already done (entry Status). Remaining NATS leg closes by deleting `./sessions/nats` in plan 174 Task 6, not by implementing it.
- Section: Further Actions
- Priority: P2
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: Implement both in the JSONL store, `packages/prism-core` SQLite, Postgres and NATS stores, and Prism Code's session store, and run `assertSessionStoreConforms(..., { exerciseSessionIndex: true })` against each.
- Why: `agent.sessions.list/delete` answer `UnsupportedStoreCapabilityError` on every store except the kernel memory store. Phase 6.
- Status: Delivered for the JSONL, SQLite, and Postgres stores in plans/153-Phase-6-Session-Store-Packages.md Tasks 3-5 (each passes the `list-and-delete` leg of `storeConformance`, the renamed successor of `assertSessionStoreConforms(..., { exerciseSessionIndex: true })`), and Prism Code's session store follows because `resolveSessionStore` returns the SQLite store. Still open for the NATS store (`packages/prism-core/src/sessions/nats`), which plan 153 left in the family package.

## Close the agent's sessions on `agent.dispose()`
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: Keep an agent-owned live-session set (including sessions `fork()` builds inside the session class) and close them in `dispose()`.
- Why: The roadmap says `dispose()` closes sessions; today it ends subscriptions and packages only.

## Trace the `@arnilo/prism-providers` export count growth
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `scripts/budgets.json` moved from 588 to 590 at plan 149 Task 6 with no attribution.
- Why: A rebaseline without a cause hides an unintended public export.

## Rewrite the older `scripts/` conformance suites for the Phase 1-3 shapes
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md
- What: `scripts/phase8-conformance`, `phase20-security`, `phase40-security`, `obscura-host-conformance` and `phase16-freeze` pass `tools: [...]`, use `askEveryTool`, and read the old durable-resume shapes.
- Why: They fail on shapes plans 144-148 changed, so their coverage is dark.

## Fix the stale `install-smoke` assertions
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 8. Exclusive-shell assertion still at `install-smoke.test.ts:324`. This run failed first on prism-core enterprise/postgres.
- Section: Further Actions
- Priority: P1
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: `src/__tests__/install-smoke.test.ts` checks `createCodingCompactionStrategy` from `@arnilo/prism-memory/compaction/llm` (no longer exported) and its packed integration script expects an exclusive `shell` call not to overlap siblings.
- Why: It is the only test that installs the packed tarballs, including `prism new package`, and it is red for reasons that are not about the install.

## Install lock for concurrent manifest writers
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- Compromise: `install`, `remove`, `configure`, `setEnabled`, and `assignSlot` read, change, and atomically write one manifest with no lock.
- Implications: Two concurrent writers on one scope can lose an update. No torn file.

## Move the CLI `--provider` table out with the runner modes
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 2 (`cli-providers.ts` deleted with the runner).
- Section: Further Actions
- Priority: P2
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: Delete `src/cli-providers.ts` and its `core-boundaries.test.ts` allowance when Phase 11 retires the runner modes.
- Why: It names provider packages inside core as a temporary seam.

## Update the released docs for `prism add` and `prism new package`
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P3
- Source: plans/150-Phase-4-Manifest-And-Installer.md
- What: `docs/cli-rpc.md`, `provider-packages.md`, `release-and-install.md`, `host-compositions.md`, `dev-inspector.md`, and the `docs.test.ts` assertions that pin them still describe `prism init` and `providers add`.
- Why: They are 0.12.1 pages and change at the Phase 11 release.

## Revisit the tools-work subpath layout against §2.10
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- Compromise: `@arnilo/prism-tools-work` keeps its eleven 0.12 subpaths and a curated root barrel instead of §2.10's single `.` export, because `documents`/`sheets`/`diagrams`/`document-reader`/`document-extraction` share type names a flat `export *` cannot re-export unambiguously.
- Implications: Importers still use `@arnilo/prism-tools-work/<sub>`; consolidating onto one barrel later means renaming the colliding type exports and migrating every importer.

## Give tools-work a host-provided sandbox and filesystem instead of a local root
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- Compromise: `@arnilo/prism-tools-work` connectors require host-declared `configDir` and `identity`, and `root` backs a local `node:fs` filesystem, because the 0.12 CLI adapters require both and the `PackageAPI` has no filesystem or sandbox slot.
- Implications: `work_exec` is unavailable unless the host provides the `work.sandbox` service, and file-touching work tools bypass a host sandbox unless the host also supplies one.

## YAML OpenAPI documents
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- Compromise: `@arnilo/prism-tools-openapi` parses JSON documents only; a YAML spec fails closed as `ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS` and is skipped.
- Implications: A host with YAML specs registers no tools for them and sees only the skip note.

## Consolidate the duplicated Playwright structural types
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- Compromise: The nine Playwright interfaces are duplicated between `packages/tools/browser/src/types.ts` and `packages/tools/web/src/obscura/playwright.ts` rather than making one package depend on the other for types.
- Implications: A Playwright API change must be applied in two places; a drift would only surface at runtime.

## Retire the workflow-local execution policy in Phase 16
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- Compromise: `packages/prism-core`'s workflows keep a workflow-local structural `ExecutionPolicy` and `ToolNodeDefinition.action` after the kernel export is deleted.
- Implications: A second in-tool policy shape survives until Phase 16 re-scopes workflows; `run/node-execution.ts` inlines the deny check instead of calling a shared helper.

## Investigate providerPackage with nested per-turn scripts
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- What: `providerPackage("…", [provider])` around a nested (per-turn) script delivered no tool call to an agent node — the run produced only a `user` message — while the same script through `mockProvider` works.
- Why: Found while rewriting `examples/workflow-tool-approval.ts`; a host that builds its provider through `providerPackage` cannot script tool calls today.

## Fix the pre-existing agent-sdk hooks.json allow-list test
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 7 (workspace deleted).
- Section: Further Actions
- Priority: P2
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- What: `defineAgent > hooks.json run.end handlers and registerHooks share the bus, hooks.json first` fails because `allowCommands` defaults to `{}` and the test's `hooks.json` declares no pins.
- Why: Either the test should pin the command hash or the plane should pass a computed allow-list; today the test cannot pass.

## Make the source-package postinstall idempotent
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/155-Phase-7-Part-B-Web-Browser-Work-Computer-Use-And-OpenAPI-Tools.md
- What: `store-jsonl`, `store-sqlite`, `store-codecs`, `credentials/keyring`, and `integrations/hooks-json` should run `rm -rf node_modules/@arnilo/prism` before `ln -sfn`, the form `@arnilo/prism-store-postgres` already uses.
- Why: A Bun-materialized directory copy makes the bare `ln -sfn` fail and abort `bun install` before it writes `bun.lock`.

## RAG indexes lazily, not in the background
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: `@arnilo/prism-memory-rag` indexes on the first `rag_search` or `context.build`, behind a per-agent promise, because package setup has no session and `SessionContext.background` needs one.
- Implications: The first retrieval pays the index. `createAgent` makes no network request.

## Wiki extractDocument and ocrImages deleted
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: No extraction service succeeded the hooks, so compressed-PDF, CSV-via-host, and image-OCR extraction leave the wiki.
- Implications: Those inputs fail closed with a named error. Uncompressed PDF, text, markdown, HTML, and the no-OCR image stub stay.

## autoDeploySkills defaults to false
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: The 0.12 wiki deployed skills into `.agents/skills/` unless the host opted out. The package default is now false.
- Implications: A host that depended on the old default must set `autoDeploySkills: true`.

## Memory family deleted with no shim
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: `@arnilo/prism-memory` is deleted. Importers use the six packages. Released `/docs` still name the family and the 0.12 subpaths.
- Implications: A 0.12 import fails at module resolution. Phase 11 owns the doc rewrite and the npm deprecation.

## Context-engineering config is JSON
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: A custom fold summarizer and a predicate attention axis are library exports only. The run-cumulative `run_input_ratio` axis has no package successor (`examples/attention-budget-axes.ts` deleted).
- Implications: A host that needs a function summarizer or the run-spend axis composes the library, or waits for a seam that passes `runInputTokens` into `context.build`.

## Google Drive stays a host callback
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: `resolveAccess` is host code, so a Drive source is not a JSON config ref. The reranker key and the Postgres connection are the ref-only config fields.
- Implications: A config-only host cannot sync Drive. `memory_rag_secret_refs_never_echoed` covers the config refs.

## Fabric tools do not wire the observational session
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: `kind: "episode"` and `reflectionId` promotion work through `createMemoryFabric({ observational })`. The registered tools do not pass `context.session`.
- Implications: A tool-only host cannot promote episodes. The library path still can.

## phase29 freeze manifest has no lateAdditions for plans 157-158
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- Compromise: The seven new packages were not added to `scripts/phase29-freeze-manifest.json` because the suite already fails on the plan 152 providers row, and one addition would not balance the live set.
- Implications: `scripts/phase29-freeze.test.mjs` stays 7 pass / 1 fail and out of `GATE_FILES`.

## Re-point released docs off the 0.12 memory and context-engineering surface
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- What: Rewrite the released pages that still document `@arnilo/prism-memory`, its subpaths, `extractDocument`/`fetchUrl`, and the five retired kernel fields. Move the `docs.test.ts` phrase pins with the pages.
- Why: Phase 11 owns released docs. The local-link gate is green; the prose is not.

## Repair phase29-freeze lateAdditions
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- What: Add `lateAdditions` for the six memory packages and `@arnilo/prism-context-engineering` in the same edit that re-points `@arnilo/prism-providers`, `@arnilo/prism-web-tools`, and `@arnilo/prism-office`.
- Why: The live-set accounting cannot balance until the stale rows and the new packages move together.

## Restore run_input_ratio or drop it
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- What: Pass `runInputTokens` into the context-engineering handler, or record the axis as permanently per-request.
- Why: A `context.build` handler cannot read the run's spend, so the run-cumulative axis degenerates.

## Delete unused kernel exports OM stopped using
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 2. `resolveUseCaseModel` graft callers are the unit test only.
- Section: Further Actions
- Priority: P3
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- What: Delete `resolveUseCaseModel` and `useCaseCredentialProviderId` if no caller remains. Keep `resolveCredentialValue`.
- Why: Plan 157 Task 1 (j) measured them unused once OM stopped importing them. Plan 158 kept `CompactionTrigger` / `resolveShouldCompact` / `assertCompactionTrigger` because the memory packages and Prism Code still compose them.

## Restore a scope gate or drop reflection promotion
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- What: Reintroduce a scoping primitive, or drop the `reflectionId` promotion input and `MemoryNotePromotion` metadata.
- Why: Work scopes were deleted. The fabric promotes any reflection the ledger holds.

## Give deletion propagation an observational-memory leg
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- What: Append a drop record to `state.log("ledger")` and let the projection filter revoked observations.
- Why: `createObservationalMemoryDropHandler` is gone. Hosts rely on the build-time `invalidatedIds` filter alone.

## Carry the out-of-run model-call seams
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- What: Deliver `om.status` to `session.subscribe()`, and give a package worker a channel for `thinkingLevel` and provider request options. Redact `models.client` provider requests with the agent's secrets.
- Why: Observe hooks see the event; subscribers do not. Worker prompts currently leave the agent secret set.

## Wire fabric tools to the observational session
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/158-Phase-8-Part-B-RAG-Wiki-Fabric-And-Context-Engineering-Packages.md
- What: Pass `context.session` into the fabric on tool calls so `kind: "episode"` and `reflectionId` promotion work without a host calling the library.
- Why: The tools already receive `context.session`. The package does not forward it.

## Work scopes deleted with no replacement
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- Compromise: The work-scope controller, shared scopes, `SCOPES.md` projection, scope commands, and scope tests were deleted. Nothing in Phase 8 restores a scoping primitive.
- Implications: Fabric reflection promotion accepts any reflection the ledger holds. `MemoryNotePromotion.scopeId` is optional. Follow-up: "Restore a scope gate or drop reflection promotion".

## Observational-memory deletion-propagation leg deleted
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- Compromise: `createObservationalMemoryDropHandler` wrote a 0.12 custom entry a package cannot write, so the leg was deleted with the subpath.
- Implications: A `createDeletionPropagator` host relies on the build-time `invalidatedIds` filter. Follow-up: "Give deletion propagation an observational-memory leg".

## Released docs still describe the 0.12 observational-memory subpath
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Compromises Made
- Priority: P2
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- Compromise: Nine released pages still document `@arnilo/prism-memory/compaction/observational-memory` and `createObservationalMemory().attach()`. `docs.test.ts` still asserts those mentions.
- Implications: A reader of released docs sees an API that is gone. The assertions must move with the pages in Phase 11. Follow-up: "Re-point released docs off the 0.12 memory and context-engineering surface".

## Family observational-memory tests and three 0.12 examples deleted
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/157-Phase-8-Part-A-Observational-Memory-And-Compaction-Packages.md
- Compromise: `observational-memory-lifecycle`, `observational-memory-recall-status-view`, and `work-scopes-coding-loop` were deleted. The package suites and `examples/observational-memory.ts` replace them.
- Implications: Coverage of the deleted attach API is gone on purpose. The Done proof is the new example, not the old attach surface.

## Move delegate from the `child` event field to `origin`
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 9. Catalog field is already gone. Package payload remains at `packages/integrations/delegate/src/runtime.ts:118`.
- Section: Further Actions
- Priority: P1
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Phase 13 replaces `delegate.step` package events and the unused `child` field with `origin`.
- Why: The supervisor that set `child` is gone, so the field has no producer.

## Move prism-core workflow observability into the observability package
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: `packages/integrations/observability/src/index.ts:3` and `:107` (`createWorkflowInstrumentation`).
- Section: Further Actions
- Priority: P1
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Move `./governance/observability` (workflow spans, timeline, summary, RAG telemetry) into `@arnilo/prism-observability` in Phase 16.
- Why: Workflow instrumentation still builds on the package through a library edge.

## Resume a suspended delegated child
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Add `delegate_resume`, or give the child a host so `ask` reaches the parent's UI.
- Why: A child that suspends is disposed and cannot be continued.

## Validate delegate `inherit` at createAgent
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Expose the loaded-package list during `setup`, or compute `requires.packages` from config.
- Why: An unloaded name now fails at the first delegation.

## Clamp delegate child limits to the parent's
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Expose the resolved run limits to packages.
- Why: Children are clamped only to the delegate package's own ceilings.

## Fix the release gate for tools-coding declaration emit
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: `@arnilo/prism` no longer exports `ExecutionPolicy`, `ExecutionAction`, `ExecutionDecision`; fix the imports and re-run `release.mjs gate --update-baseline`.
- Why: The gate stops at tools-coding, so three baselines were produced by hand.

## Diff a whole-repo test sweep against the plan 159 baseline
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- What: Run `bun test src packages` plus the per-workspace suites and compare with the 154-failure baseline.
- Why: Phase 9 Part B did not run the full sweep.

## Released docs still name retired supervisor, router, and observability APIs
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Compromises Made
- Priority: P3
- Source: plans/160-Phase-9-Part-B-Model-Router-Observability-And-Delegate-Packages.md
- Compromise: `core.md`, `multi-agent-patterns.md`, `a2a.md`, `supervisors.md`, `server.md` and others still name `createSupervisor` and similar.
- Implications: Readers see removed APIs until Phase 11 rewrites the pages.

## Reshape prism-mcp-server into serveMcp(agent)
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: `serveMcp` at `packages/hosts/mcp-server/src/serve.ts:46`. `serve-tools.ts` exists.
- Section: Further Actions
- Priority: P1
- Source: plans/159-Phase-9-Part-A-MCP-Guardrail-Packs-And-Governance-Packages.md
- What: Phase 10 reshapes `@arnilo/prism-mcp-server` and fixes `mcp_server_host_library_uses_public_api`.
- Why: The host library still has the 0.12 API.

## MCP OAuth tokens through the credentials slot
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/159-Phase-9-Part-A-MCP-Guardrail-Packs-And-Governance-Packages.md
- What: Store MCP OAuth tokens and client secrets via the credentials slot.
- Why: Deferred from plan 159 Task 1.

## Governance `require` is enforced at the run boundary
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/159-Phase-9-Part-A-MCP-Guardrail-Packs-And-Governance-Packages.md
- Compromise: A package cannot read `AgentConfig.principal`, so `require` rejects in `run.input` and `tool.call` instead of `createAgent`.
- Implications: A missing principal surfaces at the first run, not at build time.

## Unblock `node scripts/release.mjs gate` at prism-coding-tools approval imports
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: typecheck exit 0 (2026-10-14). Remaining gate block is Postgres, not this import.
- Section: Further Actions
- Priority: P1
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `packages/prism-coding-tools/src/security/approval.ts` imports `ExecutionAction`, `ExecutionDecision`, and `ExecutionPolicy` from `@arnilo/prism`, which no longer exports them. Repoint each import to its owning package.
- Why: The declaration emit stops the release gate here, and it has blocked the gate since plan 160.

## Extend the host-surface gate to prism-core reaches and computed imports
- Closed (plan 197 Task 9 and its follow-up, 2026-10-26): resolved on both sides. The `evals` half: no `prism-core` specifier remains in `packages/hosts/evals/src`, and its three computed `@arnilo/prism-observability` imports are one literal dynamic import in `src/timeline.ts`. The gate half: `src/__tests__/host-surface-gate.test.ts` now rejects every dynamic `import()` whose specifier is not a string literal (`DYNAMIC_IMPORT_CALL` + `LITERAL_SPECIFIER`), so a specifier bound to a variable cannot hide a reach; a runtime module path needs a `// host-gate: <reason>` comment on its line or the line above (the only two uses in the tree are `packages/hosts/remote/src/testing.ts` and its `serve-stdio` fixture). `prism-core` stays rejected by name and as a literal anywhere in a host module. No `prism-core` specifier is left in any `packages/hosts/*/src` outside `channels` test comments.
- Section: Further Actions
- Priority: P1
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: Forbid `@arnilo/prism-core` names in `packages/hosts/*` and computed-specifier dynamic imports. At filing, `ag-ui` (`a2a.ts`, `a2a-server.ts`) and evals (`experiment.ts`, `score.ts`, `scenarios.ts`, `trajectory.ts`) reached `prism-core`.
- Why: The gate read literal specifiers of `@arnilo/prism` only, so those reaches passed it unseen. Closed ahead of Phase 16 because the evals rewrite proved one literal import is enough.

## Repoint stale evals path maps in freeze tests and e2e coverage
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `scripts/phase{19,20,21,26}-freeze.test.mjs` map `packages/evals/` to `packages/prism-core/src/governance/evals/`. `scripts/e2e-coverage.json:634` lists moved `prism-core` governance/evals test paths. Repoint both to `packages/hosts/evals`, then run `scripts/e2e-coverage.test.mjs` and the freeze suites.
- Why: The maps and coverage keys still name a path that plan 162 Task 3 moved away.

## Rewrite released docs that describe retired evals, dev, and messaging surface
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P2
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `docs/evaluations.md` (`wrapAgentWithFailureInjection`, `governance/evals`), `docs/dev-inspector.md` (`prism dev`, `createPrismDevInspector`), `docs/messaging-channels.md`, `docs/messaging-channel-operations.md`, `docs/signal-channel.md`, `docs/telegram-channel.md`, `docs/enterprise-postgres-state.md` (`createMessagingRuntime`).
- Why: Plan 162 left released `/docs` untouched. Rewrite them in the release that retires these names.

## Triage pre-existing docs test failures outside plan 162
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P2
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: The phase54 retired-package count (35, expected 36); `ManifestContributionKind` not exported from `src/index.ts`; `RunOptions` per-run tools and `activeSkills` assertions; the plan 081 open-connector check (`packages/memory/package.json` absent).
- Why: `bun test src/__tests__/docs.test.ts` shows 6 failures after plan 162. None comes from plan 162, and each needs its owning plan's triage.

## Remove the invalid file: prism-core devDependencies
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 6.
- Section: Further Actions
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `npm ls --all --depth=0` reports `invalid` `file:../../prism-core` devDependencies in `hosts/ag-ui`, `hosts/devtools`, `hosts/evals`, and `prism-coding-tools`.
- Why: They serve test imports and evals runtime resolution. Fix with the Phase 16 removal of the `prism-core` runtime, not with a manifest edit now. `packages/hosts/evals` is at the same invalid state.

## Remove the unused createSkillRegistry import in cli-runner
- Review (plan 174 Task 1, 2026-10-14): contract-before-freeze, owned by plan 174 Task 2 (runner deleted).
- Section: Further Actions
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `src/cli-runner.ts` imports `createSkillRegistry` and never uses it. It is already unused at HEAD.
- Why: Dead import. Remove it with the next kernel CLI change.

## Verify or drop the ag-ui-mapper anchor in the phase72 evidence record
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `docs/_evidence/phase72-primitive-review.md` cites `packages/hosts/ag-ui/src/ag-ui-mapper.ts#L48-L453`. The moved file differs from HEAD, so the range may be stale.
- Why: Recompute the range or drop the anchor.

## Cut the evals changelog version at release
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Further Actions
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- What: `packages/hosts/evals/CHANGELOG.md` has `## [Unreleased]` for the Phase 10 change. At release, cut the version header and confirm the `0.0.28` and `0.1.0` sections still match the lockstep convention.
- Why: Plan 162 does not release, and the header was `[0.12.1]` before this task.

## Surface gate exempts frozen names from the usage check
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- Compromise: `scripts/host-surface-allowlist.json` `frozen` entries are not required to be imported by a host library. Seven frozen names have no host import: `AgentInspection`, `RunOptions`, `RunLimits`, `CommandDefinition`, `PackageCommandInfo`, `JsonValue`, `ToolKind`.
- Implications: These are payload and member types of the Phase 4 freeze. The usage check covers only the tagged `phase11` and `phase16` extras, so an unused frozen name stays on the list without failing the gate.

## Released docs got link-target edits only in plan 162
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Docs/README/changelog cut is plan 175. Not deferred past 0.13.
- Section: Compromises Made
- Priority: P3
- Source: plans/162-Phase-10-Part-B-Channels-Evals-Devtools-And-Surface-Gate.md
- Compromise: `docs/messaging-channels.md` and `docs/messaging-channel-operations.md` had their README link targets changed to `packages/hosts/channels/README.md`. Their content is untouched.
- Implications: Released pages keep their text but now point at the moved host library. The shipped link check stays green without changing released content.

## Kernel package validator rejects object branches under oneOf
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry says resolved 2026-10-11 (plan 164).
- Section: Further Actions
- Priority: P1
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- What: `src/packages/schema.ts` rejected every object value under `oneOf` (`unknown key`, then `does not match any allowed shape`). Resolved 2026-10-11 (plan 164 P1): the validator now applies the object shape keywords only when the node declares an object, so a combinator node leaves the value to its branches. `externalAgentSpecSchema`'s `systemPrompt` is restored as a `oneOf` over the `{ replace }`/`{ append }` object shapes, and `assertSystemPromptShape` is deleted (the schema covers the top-level spec and every sub-agent spec). Tests: `src/__tests__/package-config.test.ts` object `oneOf`/`anyOf` cases; `src/driver-kit/__tests__/driver-kit.test.ts`.
- Implications: None open. Export count moved 1707 → 1706; `scripts/budgets.json` and `scripts/compat-baseline/arnilo__prism.txt` follow.

## Typecheck and release gate blocked by tools-web and tools-coding
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: `bun run typecheck` exit 0 on 2026-10-14. `bun scripts/release.mjs gate` fails only on unset `PRISM_TEST_POSTGRES_URL` (separate entry).
- Section: Further Actions
- Priority: P1
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- What: Moved into plan 164 as Task 8.1 (tools-coding imports its own `Execution*` types), Task 8.2 (remove the duplicate Obscura test from tools-web), Task 8.3 (a Bun-only release gate that collects emit failures, packs with Bun, rejects duplicate lock keys, and regenerates the 30 failing compat baselines with attributed removals), and Task 8.4 (publish with `bun publish` from prepacked, attested tarballs).
- Why: `bun run typecheck` and `bun run release:gate` are Phase 13 Done criteria; the full-gate analysis is in plan 164 Task 8's failure analysis.

## Phase 11 registry operations without npm
- Review (plan 174 Task 1, 2026-10-14): not a Part A contract change. Owned by plan 175 Task 8 (registry HTTP deprecation, no npm binary).
- Section: Further Actions
- Priority: P2
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- What: Publication moves to `bun publish` (plan 164 Task 8.4, owner decision 2026-10-11), but Bun 1.4.2 has no `deprecate` or `dist-tag` command. Phase 11 deprecates the 0.12 family packages, so it needs either a stdlib script over the npm registry HTTP API (same `NPM_TOKEN`) or a recorded manual step.
- Why: Prism runs no Node or npm in its release path after Task 8.4.

## Run driver-package loops through the invariant suites
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- Compromise: The invariant suites (`hook-invariants`, `conformance-helpers`, `host-ui`, `session-index`) run against the default loop only. The driver loop is covered by `driverConformance`'s observe, gating, steer, abort, and resume legs, not by re-running those suites on a driver loop.
- Implications: The "from a driver loop" Phase 13 criterion is partly inferred. A regression that only affects driver loops would be caught only if a conformance leg covers it.

## Record the K4 and K5 store legs on Postgres
- Closed (plan 174 Task 11, 2026-10-15): resolved. `bun run test:postgres` runs `storeConformance` against a live Postgres and passes (0 fail), covering `package-state`, `external-state` (K5) and `session-links` (K4). Three Postgres bugs had to be fixed first: `keyPrefix` checkpoint listing returned an empty page under the en_US.utf8 default collation (the `prefix + U+FFFF` bound now compares `COLLATE "C"`), two migration-backfill tests had four placeholders for five `IN` names, and the advisory-lock test's frozen migration count was 9 instead of 10.
- Section: Compromises Made
- Priority: P2
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md

## Canary cannot see silent reads on atime-less filesystems
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- Compromise: `credential_canary` detects reads by atime. This host mounts `/tmp` tmpfs and `/home` btrfs with `noatime`, so a silent read passes; the leg returns that limit as its reason. Mode `0000` catches only a non-root read, as `EACCES`.
- Implications: The no-secret-read guarantee for protected paths is weaker than stated on such filesystems. Add an atime-independent check, or run conformance in CI on a filesystem that records atime.

## Process handle named child in tools-coding breaks the event sweep
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md
- What: `packages/tools/coding/src/agent/process/sessions-host.ts:73` declares `child?: ChildProcessWithoutNullStreams`. It is a process handle, not an event origin, but it matches the Phase 13 sweep `\bchild\?: `. Rename it (for example `process`), or narrow the sweep to exclude process handles.
- Implications: The sweep reports one hit that is not an event, so the plan 164 verification cannot run clean as written.

## Restore Phase 15 Part A whole-plan verification
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/166-Phase-15-Part-A-Generic-Process-Driver-And-Adapter-Contract.md
- What: Resolve the six existing docs failures, packaging guard failures for emitted source files in the MCP client/server and ACP packages, invalid/extraneous workspace dependency links, and missing Postgres release evidence; rerun the whole-plan checks.
- Why: Task 7 and the process package compatibility checks can pass while these unrelated repository checks still block a clean whole-plan/release verification. Run docs demo compilation serially with source-package integration tests: its emitted JS and cleanup can race their imports.

## Exercise the rpc-server account mode in conformance, or drop it
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md
- Compromise: `examples/adapters/rpc-server.ts` declares an account-kind auth mode (local only), but `adapterConformance` cannot exercise it: `createProfiles` receives no binary, so the status command's `{binary}` substitution never resolves and the mode fails with `auth_required`. The conformance fixtures use the api-key mode instead, and the account refusal is pinned only at the guard.
- Implications: A declared mode has no conformance coverage. Either give the harness a status-command path so the account mode can be exercised, or record the mode as guard-only in the adapter and the guide.

## Carry thinking tokens into Usage
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md
- Compromise: `examples/adapters/workspace-config.ts` declares `capture.thinking: "tokens-only"` and reports a thinking token count on the usage activity, but `Usage` (`src/contracts-core/content.ts`) has no `thinkingTokens` field and `createUsageAccumulator` sums only input/output/cache/total/cost, so the count is dropped downstream.
- Implications: A `tokens-only` capture adapter cannot persist what it reports. Add `thinkingTokens` to `Usage` and sum it, or document the loss and stop reporting it.

## Give OpenContext the agent spec
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md
- Compromise: `OpenContext` is `{ sessionId?, turnId?, resume, tools }` with no `ExternalAgentSpec`, so `examples/adapters/rpc-server.ts` writes instructions, model, and approval policy into the `--config` file from `configure` instead of carrying them in the `initialize`/`thread.start` handshake.
- Implications: A transport whose handshake needs the spec (for example Codex's `thread/start` params) cannot express it today, and the adapter authoring guide must state the split as shipped. Widen `OpenContext` with the spec, or record the configure/open split as the contract.

## De-flake the unknown_request_fails conformance leg
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/167-Phase-15-Part-B-Adapter-Conformance-Reference-Adapters-And-Authoring-Guide.md
- Compromise: One `bun examples/adapters/conformance.ts` run failed the `rpc-server` `unknown_request_fails` leg with `unknown server request did not fail closed`; two immediate reruns passed all 21 legs. The sensitivity is in the conformance-harness leg, not the adapter (the same class as the abort-leg contention flake).
- Implications: A green conformance run is not fully trustworthy until the leg is bounded or de-flaked like the abort leg.

## Run Phase 16 Postgres restart proof and the release gate
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- Compromise: Part A's Postgres restart proof and `bun scripts/release.mjs gate` were never run (no `PRISM_TEST_POSTGRES_URL`); the phase is verified on SQLite only, and 21 docs-suite plus one SQLite Node-import failures are inherited.
- Implications: The release gate cannot go green and Postgres durability of `checkpoints`/`leases` is unproven.

## Cross-process profile pacing for fanOut
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- Compromise: Driver-kit admission is process-wide per profile home inside one process; a second process on the same profile is invisible to the cap and relies on `profile_busy` backoff.
- Implications: Two hosts sharing a profile can still collide, costing retries rather than correctness.

## Make workflowLoop resumable
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- Compromise: `workflowLoop` has no `snapshot`/`restore` and runs in memory with no checkpoints; `ask` with no `host.ui` denies.
- Implications: A suspended loop cannot be resumed after a restart.

## Expose the WorkflowRun from workflowCommand
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status says `workflowCommand(..., { onRun(run) })`.
- Section: Further Actions
- Priority: P1
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- What: Let `workflowCommand` return or register the `WorkflowRun`, or expose a stream hook, so a host command can render the merged stream.
- Status: done — `workflowCommand(..., { onRun(run) })`; example uses it.
- Why: `examples/build-workflow.ts` had to bypass `workflowCommand` and call `startWorkflow` to reach `stream()`.

## Rebind a recorded worktree after a process kill
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status says `workspace.worktree.rebind`.
- Section: Further Actions
- Priority: P1
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- What: Give the coding `workspace` service a rebind API so a mid-run worktree node resumes in its recorded worktree.
- Status: done — `workspace.worktree.rebind`; `agentNode` uses it on resume.
- Why: Worktree bindings live in process memory, so after a real kill `bound()` is empty and the node fails `worktree_lost` even when the path exists.

## Stamp origin.profile on external events
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- What: Have the driver kit set `origin.profile` on external events.
- Why: Observability reads the attribute but it is never set, so per-profile concurrency needs a session-id lookup.

## Validate gate back edges and re-entry activation at defineWorkflow
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/169-Phase-16-Part-B-Agent-Nodes-Gates-FanOut-And-Merged-Stream.md
- What: Fail `defineWorkflow` when a gate's failure target is not a declared successor, and warn when a re-entered node lacks `activation: "any"`.
- Why: Today the first fails at run time and the second silently skips the node while the run reports success.

## Preserve remote resume events during session-open registration
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md
- Compromise: Server-initiated resume can emit before the proxy registers the opened session handle (Task 4).
- Implications: Subscribers and mirrors can miss events in that reconnect window. Buffer or coordinate registration with a focused regression test.

## Restore Phase 17 Part A whole-plan verification
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md
- Compromise: Implementation tasks are complete; whole-plan validation still reports unrelated provider-domain, MCP host-surface, tarball diet, packaging, docs, and missing-suite coverage failures; release evidence lacks PRISM_TEST_POSTGRES_URL.
- Implications: No all-green release claim. The remote package, workflow package, root typecheck, offline example/no-secret gate, and remote packaging checks pass.

## Re-run remote release verification after repository gate repairs
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md
- What: Repair the recorded whole-plan failures, supply Postgres release evidence, and repeat the plan verification before publishing.
- Why: Task completion does not establish repository-wide release readiness.

## Diagnose invalid remote UI answers without adding a host-specific kernel hook
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P4
- Source: plans/170-Phase-17-Part-A-Remote-Agents-Protocol-ServeAgent-And-ConnectAgent.md
- What: Assess a generic way to record a notice for wrong-kind HostUiResponse values; prove the kernel need first.
- Why: Task 3 fails closed today, but the malformed answer has no run notice because no host-side emit hook exists.

## Restore Phase 17 Part B whole-plan verification
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- Compromise: Task 8 completed the Done record with 145/25 docs, 334/4 packaging/host-surface, stale coverage annotations, and missing PRISM_TEST_POSTGRES_URL.
- Implications: No all-green release claim; remote, headless (isolated rerun), channels and workflows pass. Coordinate repairs with plan 170.

## Establish reliable headless scheduler test timing
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P2
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- Compromise: The first package-script run had two scheduler timeouts; the identical isolated rerun passed all 51 tests without source changes.
- Implications: A passing rerun does not establish timing reliability under parallel test execution.

## Revisit scheduler claim-to-start crash loss if stronger durability is required
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- Compromise: Persisted CAS claims precede target execution; crashes can lose a firing, and uncertain attempts are not replayed.
- Implications: Live workers fire each occurrence once; leases do not provide transactional exactly-once external effects. Any stronger guarantee needs a separately scoped design and crash proof.

## Re-run headless release verification after gate repairs
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- What: Repair the Task 8 repository failures, provide PRISM_TEST_POSTGRES_URL, and repeat whole-plan/release checks before publishing, coordinating with plan 170.
- Why: Implementation and record completion do not establish release readiness.

## Diagnose headless scheduler timeout failures
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P2
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- What: Investigate bounded_concurrency_stop_drains_and_completion_preserves_pause_delete and crash_after_claim_is_not_replayed under the package script's parallel execution; preserve their concurrency/crash assertions.
- Why: Task 8 initially failed both and then passed the same isolated command; the cause remains unproven.

## Leave Phase 12 Part A inherited gates red
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Compromises Made
- Priority: P3
- Source: plans/172-Phase-12-Part-A-Reference-Host-Scaffold-Research-Pack-And-Workers.md
- Compromise: Whole-plan verification left inherited failures red: docs 148/22, packaging/host-surface 345/4 (MCP host-surface, neuralwatt umbrella, retired provider family, npm ls), and `bun scripts/release.mjs gate` blocked on unset `PRISM_TEST_POSTGRES_URL`.
- Implications: Part A is not an all-green release claim. Do not open a second repair; plan 171's "Re-run headless release verification after gate repairs" already owns it.

## Stop bun install from duplicating lock keys
- Review (plan 174 Task 1, 2026-10-14): stale. Evidence: entry Status says delivered 2026-10-14, `duplicateLockKeys` at 0.
- Section: Further Actions
- Priority: P3
- Source: plans/172-Phase-12-Part-A-Reference-Host-Scaffold-Research-Pack-And-Workers.md
- Status: Delivered 2026-10-14. Dropped the extra `file:` devDependency where the same name was already a `dependencies` caret (`@arnilo/prism-tools-coding`, `@arnilo/prism-mcp`, `@arnilo/prism-acp-agent`). Three `bun install` runs left `duplicateLockKeys` at 0.
- What: Stop `bun install` from writing duplicate `bun.lock` keys under `@arnilo/prism-tools-coding` / `@arnilo/prism-core`.
- Why: Every install in plan 172 reintroduced 13 duplicate keys. The detector already fails `truth-current` until they are stripped by hand, so the next plan that installs goes red for a reason that is not its diff.

## Confirm Phase 17 remote conformance package-subpath placement
- Review (plan 174 Task 1, 2026-10-14): post-0.13. Additive feature or a break that waits for 0.14. Not a public 0.13 contract change small enough for plan 174 Tasks 2–11.
- Section: Further Actions
- Priority: P3
- Source: plans/171-Phase-17-Part-B-HostUi-Routing-Scheduler-And-Headless-Host.md
- What: Obtain the user's decision on @arnilo/prism-remote/testing versus the roadmap's kernel /testing wording, and reconcile the roadmap after that decision.
- Why: Plan 170 Task 1 (a) leaves confirmation open; package-subpath implementation avoids a forbidden kernel-to-package import. No user confirmation is recorded in Task 8.

## Move the core branch-coverage floor to a Bun instrument or retire the stage
- Section: Compromises Made
- Priority: P2
- Source: plans/174-Phase-11-Part-A-Kernel-Sweep-Family-Retirement-And-Kernel-Gates.md (Task 8)
- What: `scripts/branch-coverage-audit.mjs` instruments the kernel suite with Node, whose test-coverage flags are the only place a branch floor is measurable (Bun emits no BRDA). Plan 174 Task 8 made the kernel publish TypeScript source, so the instrumented set is `src/__tests__/*.test.ts` and Node cannot execute it (its type stripping does not rewrite the kernel's `.js`-suffixed relative specifiers). The script now reports that reason and fails closed.
- Why: The `branch coverage` stage of `bun run test` is permanently red until the floor either moves to a Bun branch instrument (the `probeBunBranchRecords` probe already flags when Bun starts emitting BRDA) or the stage is retired with the floor recorded elsewhere. The stage was already red before Task 8 for a different reason (`packages/memory/core/src/acl.js` ENOENT), so this records the new, precise blocker rather than the old symptom.

## Inline the 0.3.3 legacy-registry symbols so the frozen compat baselines can go
- Section: Further Actions
- Priority: P3
- Source: plans/174-Phase-11-Part-A-Kernel-Sweep-Family-Retirement-And-Kernel-Gates.md
- What: 31 of the 92 files in `scripts/compat-baseline/` belong to the frozen 0.3.3 legacy-registry record: `scripts/phase54-package-map.mjs` reads `scripts/compat-baseline/<name>.txt` for every `CONSOLIDATION_SPEC` entry (`retiredPackages` 55, `officeDrafts` 3, the retained 7) that has no live `dist/`.
- Implications: Task 11's criterion to delete every baseline without a live workspace could only delete one file (`arnilo__prism-work.txt`, a rename leftover). If `CONSOLIDATION_SPEC` carried its own symbol lists, `scripts/compat-baseline/` would be exactly the release set again. Rewriting frozen 0.3.3 evidence, so after 0.13.0.

## Postgres checkpoint prefix ranges depend on a locale collation fix
- Section: Further Actions
- Priority: P3
- Source: plans/174-Phase-11-Part-A-Kernel-Sweep-Family-Retirement-And-Kernel-Gates.md
- What: `packages/stores/postgres/src/checkpoints.ts` builds `keyPrefix` ranges from a `prefix + U+FFFF` sentinel, which only sorts last under code-point order; en_US.utf8 (the default in the `postgres:17` image) treats U+FFFF as ignorable, so the range was empty. Both bounds now compare `COLLATE "C"`.
- Implications: `packages/stores/sqlite/src/checkpoints.ts` uses the same sentinel and is correct only because SQLite's default BINARY collation sorts by code point. A shared prefix-range helper (or `strpos(key, $prefix) = 1`) would remove the class.

## Two more 200 ms poll helpers flake under parallel load
- Section: Further Actions
- Priority: P2
- Source: plans/174-Phase-11-Part-A-Kernel-Sweep-Family-Retirement-And-Kernel-Gates.md
- What: `packages/hosts/headless/src/__tests__/scheduler-missed.test.ts:33`, `packages/hosts/headless/src/__tests__/fixtures/scheduler-restart.mjs:46`, and `packages/hosts/remote/src/__tests__/serve.test.ts:89` poll 200 times at 1 ms.
- Implications: The Task 8 instance (`scheduler.test.ts`) failed as a false "scheduler did not settle" under full-run load and was converted to a 5 s wall-clock deadline. These three siblings carry the same fragility and pass in isolation.

## Address contained lifecycle defect fixes (D4, D5, D13) in plan 188.1
- Section: Compromises Made
- Priority: P1
- Source: plans/188.1-Phase-11-Part-O1-Memory-Fabric-OKF-Markdown-Source-And-Lexical-Retrieval.md
- Compromise: Added Task 11 to address superseded reflections (D4), verification by use (D5), and archive separate from validity (D13) early in plan 188.1 rather than waiting for plans 188.3/188.4.
- Implications: Avoids distorting retrieval benchmarks and subsequent phase experiments with unbounded retrieval touches or archive/validity conflation.

## Execute Plan 188.2: Memory Scope Hierarchy
- Section: Further Actions
- Priority: P1
- Source: plans/188.1-Phase-11-Part-O1-Memory-Fabric-OKF-Markdown-Source-And-Lexical-Retrieval.md
- What: Implement memory scope hierarchy covering user, agent, project, and path scopes (`plans/188.2-Phase-11-Part-O2-Memory-Scope-Hierarchy-User-Agent-Project-And-Path-Scopes.md`).
- Why: Provides project identity, replaces flat scope with scoped configs, and supports union recall across hierarchy levels.

## Execute Plan 188.3: Memory Session Consolidation and Gated Promotion
- Section: Further Actions
- Priority: P1
- Source: plans/188.1-Phase-11-Part-O1-Memory-Fabric-OKF-Markdown-Source-And-Lexical-Retrieval.md
- What: Implement memory session consolidation and gated promotion from observational memory (`plans/188.3-Phase-11-Part-O3-Memory-Session-Consolidation-Gated-Promotion-From-Observational-Memory.md`).
- Why: Replaces naive per-reflection promotion with structured candidate gathering, single-pass extraction, transparent promotion scoring, and reconsolidation.

## Execute Plan 188.4: Memory Use-Based Verification, Retention, and Capacity
- Section: Further Actions
- Priority: P1
- Source: plans/188.1-Phase-11-Part-O1-Memory-Fabric-OKF-Markdown-Source-And-Lexical-Retrieval.md
- What: Implement use-based verification, two-strength retention, capacity management, and scope widening (`plans/188.4-Phase-11-Part-O4-Memory-Use-Based-Verification-Two-Strength-Retention-Capacity-And-Scope-Widening.md`).
- Why: Unifies lifecycle tracking, citation-based verification, ACT-R storage/retrieval decay, capacity merging/eviction, and scope replication.

## Execute Plan 188.5: Memory Delivery Tiers
- Section: Further Actions
- Priority: P1
- Source: plans/188.1-Phase-11-Part-O1-Memory-Fabric-OKF-Markdown-Source-And-Lexical-Retrieval.md
- What: Implement delivery tiers: pinned core block, path cues, and team store (`plans/188.5-Phase-11-Part-O5-Memory-Delivery-Tiers-Pinned-Core-Path-Cues-And-Team-Store.md`).
- Why: Establishes cache-stable pinned core memory, once-per-session path cues in the prompt tail, and checked-in team store synchronization.


## Plan 198 whole-plan verification remains blocked

- Section: Compromises Made
- Priority: P2
- Source: plans/198-Phase-11-Part-W-Evals-Statistics-Clustered-Errors-Pass-At-K-Paired-Comparison-And-Confidence-Gates.md
- Compromise: Completed all seven eval statistics tasks while preserving failures outside Task 7: coding hard-deny timing, memory benchmark hook/performance checks, docs promotion/navigation, and release peer/lock/compatibility/kernel-size gates.
- Implications: Evals/devtools/browser, typecheck, examples and coverage pass, but plan completion is not a green release sign-off.

## Restore plan 198 whole-plan verification

- Section: Further Actions
- Priority: P2
- Source: plans/198-Phase-11-Part-W-Evals-Statistics-Clustered-Errors-Pass-At-K-Paired-Comparison-And-Confidence-Gates.md
- What: Resolve the Task 7 execution note's coding timing, memory-benchmark hook/performance, docs promotion/navigation, and release peer/lock/compatibility/kernel-size blockers; rerun the plan's verification commands. Preserve plan 200 Task 2's dataset-content-hash comparison follow-up.
- Why: Complete release evidence is still blocked despite passing evals task checks; comparison cannot check a content-hash contract before plan 200 introduces it.


## Plan 200 whole-plan verification remains blocked

- Section: Compromises Made
- Priority: P2
- Source: plans/200-Phase-11-Part-Y-Evals-Dataset-Hygiene-Scenario-Items-User-Simulation-State-Grading-And-Injection-Suite.md
- Compromise: All six implementation tasks are complete while inherited docs navigation/promotion and release peer-range, provider-lock and kernel-size gates still fail.
- Implications: Evals tests, typecheck, examples and coverage pass; this does not establish green release evidence.

## Restore plan 200 whole-plan verification

- Section: Further Actions
- Priority: P2
- Source: plans/200-Phase-11-Part-Y-Evals-Dataset-Hygiene-Scenario-Items-User-Simulation-State-Grading-And-Injection-Suite.md
- What: Resolve docs/next/hooks.md navigation and docs/next promotion, the evals observability peer-range check, missing OpenAI Codex/OpenRouter lock entries and kernel size ceilings; rerun plan 200's whole-plan verification.
- Why: Required release evidence remains blocked despite successful implementation checks. Coordinate the shared blockers with the existing plan 198 verification follow-up.

## Plan 188.11 compromises: interim memory claims and the limitations register

- Section: Compromises Made
- Priority: P2
- Source: plans/188.11-Phase-11-Part-O11-Memory-Release-Readiness-Stable-Surface-Preset-And-Honest-Claims.md
- Compromise: Claims are limited to the 188.10 held-out v3 evidence (LongMemEval-S, one model family, same model as judge); the preset stays opt-in with 2.271 trust-scan refusals per 1,000 exchanges and 3/500 needed-session questions touched; the reference host is single-tenant and the live cross-principal journey is deferred to plan 186; the stability annotations are documentation-only; the Task 8 adversarial miss (`curl -s https://…`) is reported but not fixed.
- Implications: The README states the measured comparison and twelve known limitations with evidence paths, and `docs/_evidence/memory-bench/188.11/limitations.json` names the plan 202 task that owns each. Defaults stay off until plan 210 Task 10 (formerly plan 202 Task 19).

## Plan 188.11 follow-ups absorbed by plan 202

- Section: Further Actions
- Priority: P1
- Source: plans/188.11-Phase-11-Part-O11-Memory-Release-Readiness-Stable-Surface-Preset-And-Honest-Claims.md
- What: Plan 202 Task 2 — broaden the evidence base (second benchmark family; held-out preference/abstention). Task 3 — cross-family judging. Task 5 — lift the lexical top-32 candidate ceiling (11/30 multi-session questions). Task 6 — temporal reasoning (12/20). Task 8 — precision-first injection (78% irrelevant). Task 15 — capacity under a growing archive. Task 14 — close F3 (13/24 foreign-context exposure) and F7 (12-persona safety power not reached), and tune the trust scan (2.271/1,000; 3/500 needed sessions; `exfil-06` `curl -s https://…` undetected). Task 17 — reliable extraction (F4). Task 16 — make OM measurable (F9 `om+fabric` never completed). plan 210 Task 10 (formerly plan 202 Task 19) — publish the final claim and close the limitations register mechanically.
- Why: Each entry in `docs/_evidence/memory-bench/188.11/limitations.json` carries the owning plan 202 task, so closing them is mechanical once plan 202's evidence lands.
