# Phase 13 Part A — External-agent kernel primitives (K1–K6)

## Objectives

- Review every kernel contract Phase 13 touches (both parts), classify each Scope bullet as expressible or a kernel addition, and verify the assumptions Tasks 2–8 and plan 164 make.
- Replace the producer-less `child` event tag with `EventOrigin` (K3) on every event and on the `tool.call` payload, repo-wide, with no alias.
- Narrow `RunController.emit` (and the hook-context `emit`) to `package.event`, and make `executeTools` re-entrant, `origin`-aware, and result-returning (K2, first half).
- Add the driver primitives `observe`, `ask`, `steers()`, and the reason-carrying `end()` result to `RunController` (K2, second half).
- Make `AgentConfig.model` optional for loops that declare `usesModel: false`, and expose `run.model` (K1).
- Persist session links, add `SessionSummary` link fields and list/search filters, and add `createSessionIndex` (K4) on every store.
- Add the `external_state` entry kind and `run.state(key)` (K5) on every store.
- Add the `terminal` `HostUi` request kind (K6), its scripted support, and its fail-closed handling in every `HostUi` implementer.

## Expected Outcome

- `AgentEvent` is `AgentEventPayload & { readonly origin?: EventOrigin }`. `ChildEventOrigin` and `child` are gone from `src/`, `packages/`, `examples/`, `scripts/` (baselines regenerated), and `docs/next/`. The `tool.call` payload carries `origin` when the caller supplied one.
- A loop calling `run.emit("my.event", data)` produces exactly one `package.event` owned by the loop's slot owner. No loop, driver, or hook context can emit a catalog event (`run.started`, `tool.completed`, …). `run.executeTools(calls, { origin })` returns `readonly ToolResult[]` and can be called concurrently from several async callers; each call fires `tool.call` once.
- `run.observe(activity)` records every `ExternalActivity` kind: text and thinking through `message.delta`/`message.append` (persisted, redacted, with `origin`), `tool.*` catalog events with `origin.executedBy: "external"`, the standard `agent.*` package events, and usage into `RunResult.usage`. It never fires `tool.call`. `run.ask(request)` fires `tool.call`, resolves `ask` inline through `host.ui`, suspends only on a resumable loop, and otherwise denies with `non_interactive`, `rewrite_unsupported`, or `respond_unsupported`. `run.steers()` yields `session.steer()` input to a loop that never calls `turn()`. `run.end()` returns `{ continue: false }` or `{ continue: true, reason }`.
- `createAgent({ slots: { loop: driverLoop } })` with no `model` succeeds when the loop declares `usesModel: false`. Any other loop without a model fails with `model_required`. `run.turn()` on a model-less agent fails with `no_model`. `run.model` carries `RunOptions.model`, which fails closed with `run_model_unsupported` on a loop declaring `runModel: "none"`.
- `agent.session({ parent: { sessionId, agentId, workflowRunId, delegationId } })` persists the link. `SessionSummary` carries `agentId`, `parentSessionId`, `workflowRunId`, and `actor`. `listSessions`/`searchSessions` filter on them. `createSessionIndex(store, { ownership })` lists and searches without an `Agent`. Memory, JSONL, SQLite, and Postgres pass the new `session-links` and `external-state` conformance legs.
- `run.state(key).append(entries)`/`load()` writes and reads bounded, redacted `external_state` entries. They are excluded from `session.messages()`, copied on fork, and deleted with the session.
- `host.ui.request({ kind: "terminal", title, command, env?, cwd? })` answers `{ status: "answered", value: { exitCode } }`, `dismissed`, or `unavailable`. `createScriptedHostUi({ terminal: { exitCode: 0 } })` scripts it. Every in-repo `HostUi` implementer answers `terminal` with `unavailable` unless it can run a command. The kernel never receives terminal input or output.

This plan implements roadmap **Phase 13 — External-agent kernel primitives and driver kit**, Part A: the K1–K6 kernel additions of §2.12.9. Plan 164 (Part B) builds the `@arnilo/prism/driver-kit` subpath, the `prism relay` bin, the `/testing` scripted CLI and `driverConformance`, `examples/external-agent.ts`, and the Phase 13 Done record on top of it. Task 1 is the phase review for **both parts**; plan 164 opens with an entry check. This plan does not bump versions, publish, deprecate on npm, or edit released `/docs`. Kernel pages are staged in `docs/next/`. Unusual points: K3 is a 0.13 break with no alias, and it touches only the type and its docs note because `child` has no producer since plan 160 (`docs/next/events.md:24`). K4 and K5 extend the store contract that plan 153 wrote, so every store package changes in the task that adds the leg. The kernel stays vendor-neutral: no vendor or binary name appears in any file this plan creates.

## Tasks

- [x] Task 1: Phase 13 review — K1–K6 contracts, driver-kit seams, and the vendor-neutral boundary (read-only, both parts)
  - Acceptance Criteria:
    - Functional: Inventory, with roadmap section and `file:line`:
      - `RunController`/`LoopStrategy` (`src/loop/types.ts:34-65`), `RunEndResult` (`:21-24`), and `createRunController` (`src/loop/run-controller.ts:126-327`, `executeTools` `:207-247`, `end` `:290-311`, the controller object `:313-326`)
      - `RunControllerInternals.ask` and its kernel implementation `resolveAskDecisions` (`src/agent-session/session/assemble.ts:454`)
      - `HookContext.emit` (`src/hooks/types.ts:29-30`, wired at `src/hooks/bus.ts:116`), `ToolCallHookPayload` (`src/hooks/types.ts:91-98`), and `PackageAPI.events.emit` (`src/packages/api.ts:153-154`, `src/packages/loader.ts:603`)
      - `ChildEventOrigin` and `AgentEvent` (`src/contracts-protocol.ts:195-200`, `:435`)
      - `AgentConfig.model` (`src/contracts-core/agent.ts:60`), `ResolvedAgentConfig` (`:208`), `RunOptions.model` (`src/contracts-protocol.ts:84`), and `parseModelRef` in `createAgent` (`src/agent-session/create-agent.ts:80-81`)
      - `SessionOptions` (`src/contracts-core/agent.ts:241`), `SessionListQuery`/`SessionSummary`/`SessionSearchQuery` (`src/contracts-core/session.ts:89-107`, `:158`), `SESSION_ENTRY_KINDS` (`:10-31`), and `STORE_CONFORMANCE_STEPS` (`src/testing/store-conformance.ts:25-35`)
      - the per-store entry and summary code: JSONL `parseEntry` kind switch (`packages/stores/jsonl/src/jsonl-store.ts:496-548`), SQLite entries and summary SQL (`packages/stores/sqlite/src/persistence.ts:189`, `:1219`), Postgres `ddl.ts`/`migrations.ts`, the shared codecs (`packages/stores/codecs/src/`), and the kernel memory store
      - the internal `createSessionIndex({ store, ownership })` (`src/agent/sessions.ts:25`) behind `agent.sessions` (`src/agent-session/create-agent.ts:138`) and `storeConformance` (`src/testing/store-conformance.ts:81`, `:395`), which K4 reshapes into the public `createSessionIndex(store, { ownership })`
      - `Session.steer`/`pendingSteers`/`applyPendingSteers` (`src/agent-session/session.ts:116`, `:439`, `:934`)
      - `package_state` as the precedent for a kernel-owned entry kind (`src/session/state.ts`)
      - `HostUiRequest`/`HostUiAnswerMap`/`HostPort` (`src/host/types.ts:56-105`), `createScriptedHostUi` (`src/testing/host-ui.ts:24-43`), the `host-ui` capability (`src/packages/capabilities.ts:10`), and every `HostUi` implementer: `packages/hosts/acp/src/host.ts`, `packages/hosts/mcp-server/src/host.ts`, `packages/policy/approval/src/index.ts`, `packages/tools/coding/src/ask-user-host.ts`, `packages/prism-code/src/tui/index.ts`
      - the kernel CLI entry (`src/cli.ts`, `src/cli-runner.ts:222-229`) and the `./provider-kit` subpath precedent (`package.json` exports, `src/__tests__/public-export-contract.test.ts:942`)
      - `scripts/host-surface-allowlist.json` (`frozen`), which names `AgentEvent`
    - Functional: Classify each Phase 13 Scope bullet as *expressible with what exists* or *needs a kernel addition*. For each addition, state the kind, payload, result, combination rule, error policy, and the primitive that fires it. Expected: K1–K6 are additions (the roadmap names them in §2.12.9, so the "named in the catalog" test is met); everything under `driver-kit`, `prism relay`, and `/testing` is expressible on K1–K6 plus Node built-ins.
    - Functional: Record each decision below, with evidence and rejected options.
      - (a) **Where the loop declares `usesModel` and `runModel`.** `DriverDescriptor` lives in the driver-kit subpath, and the core must not import it. Recommended: two optional `LoopStrategy` fields, `usesModel?: false` and `runModel?: "passthrough" | "none"`, which `defineDriver` (plan 164 Task 2) sets from the descriptor. Rejected: a kernel `LoopDescriptor` type that duplicates `DriverDescriptor`, and reading the descriptor from the slot owner's package (a provided loop has no back-pointer to its package). Name the error codes: `model_required`, `no_model`, `run_model_unsupported`.
      - (b) **`run.end()` result shape.** §2.5 sketches `{ stop: true } | { continue: string }`; the code returns `{ continue: boolean }` and queues the reason through the steer path. A driver needs the reason text to inject into the vendor agent. Recommended: `{ continue: false } | { continue: true; reason: string }`, a minimal change that keeps `defaultLoop` and every custom loop's `if (result.continue)` working. List every caller with `graft callers end --depth all` scoped to loops.
      - (c) **Narrowing `emit`.** §1.4 says only primitives emit catalog events. `HookContext.emit` takes any `AgentEvent`, so a hook can forge one too. `src/testing/loop-conformance.ts:188-195` uses it to inject synthetic catalog events. Recommended: narrow both `RunController.emit` and `HookContext.emit` to `(name: string, data: JsonValue)` → `package.event`, owned by the loop's slot owner or the hook's registering owner. Move the conformance helper's synthetic injection onto a kernel-internal test seam. List every `ctx.emit(` and `run.emit(` caller across `src/`, `packages/`, `examples/`.
      - (d) **`ask` suspension rule.** "Suspends only on drivers that can resume." Recommended: a loop is resumable when it implements both `snapshot` and `restore` (the existing §2.5 contract for suspendable custom loops). Otherwise an unanswered `ask` resolves to `{ allow: false, reason: "non_interactive" }`. Confirm how `resolveAskDecisions` (`assemble.ts:454`) stages a suspension and whether a mid-`run()` suspension from `ask` can reuse it, or whether `ask` must return a `suspend` marker the loop honors by returning.
      - (e) **`observe` routing.** Confirm which internal seams emit `message.delta`, append a message with redaction, and fold usage, so `observe` reuses them and adds none. Decide the `package` of the standard `agent.*` events (recommended: the loop's slot owner, with `name: "agent.skill"` etc., keeping the catalog count unchanged). Confirm observed tool calls can be charged to the tool-call limit through `chargeToolRound` without a provider turn.
      - (f) **Re-entrancy of `executeTools`.** `toolRounds` is a shared counter and `dispatchToolCallsInOrder` appends messages. Decide whether concurrent rounds may interleave message appends (recommended: yes, each result appends atomically in completion order; ordering within one call's round is unchanged), and how `maxToolRounds` counts concurrent rounds.
      - (g) **K4 storage shape per store.** SQLite and Postgres: new nullable columns on the sessions table plus indexes, through each store's migration path, versus a links table. JSONL and memory: derive from a `metadata`-kind link entry written at session open. Recommended: columns (nullable, indexed) for SQL stores, and a first-entry `metadata` record for JSONL and memory. Confirm `SessionSummary.actor` is derived from the session's first `origin`-bearing entry or passed in `SessionOptions.parent`, and pick one.
      - (h) **K5 bounds.** Name `external_state_limit` (recommended: per-key entry count and per-entry bytes, mirroring `package_state`'s 64 KiB), and confirm the redaction path the message pipeline uses applies to `data`.
      - (i) **K6 implementers.** For each `HostUi` implementer, decide its `terminal` answer: `unavailable` for ACP, MCP server, approval, and coding `ask_user` adapters; the lab TUI may run the command in a PTY or answer `unavailable` (recommended: `unavailable` now, recorded in Further Actions for the reference host in Phase 12).
      - (j) **Plan 164 inputs.** Confirm Node built-ins cover the driver kit with no runtime dependency: `node:child_process`, `node:net` (Unix sockets), `node:http`, `node:crypto`, `node:fs`. Confirm `src/cli.ts` can dispatch `prism relay` by dynamic import before `cli-runner.ts` loads, so a hook relay pays only its own import cost. Confirm the `host-surface-allowlist.json` change: `EventOrigin` joins `frozen`.
    - Functional: Count the importers of every name this phase retires or reshapes, per workspace, with the command, and assign each file to a task here or in plan 164: `ChildEventOrigin`, `AgentEvent.child`, `RunController.emit(event)`, `HookContext.emit(event)`, `RunEndResult`, `executeTools(...): Promise<void>`, `AgentConfig.model` reads that assume presence.
    - Functional: Record the failing-test baseline (`bun run typecheck`, the kernel suites, the store package suites, `node scripts/release.mjs gate`) and compare it with plan 162's close.
    - Functional: Record a verdict. If a finding invalidates a later task, stop and re-cut.
    - Performance: n/a — read-only.
    - Code Quality: Every count cites its command. Every decision cites the source span it rests on.
    - Security: Confirm each new primitive fails closed: `ask` with a throwing `tool.call` hook is a deny; `ask` with no UI on a non-resumable loop is a deny; `observe` never fires `tool.call`; a `terminal` request without the `host-ui` capability is refused; the narrowed `emit` cannot produce a catalog event.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.3, §2.4, §2.5, §2.12 (all subsections, read with the 2026-10-10 re-scope note), Phases 13–15, Order, Part 3 In-flight work
      - `docs/next/{loop,events,agent,host,slots,testing,packages}.md`
      - plan 153 Task 1 (store conformance), plan 160 Task 4 Notes (`child` producer removed with the in-process supervisor)
      - the code spans cited above
    - Options Considered:
      - Skip the review because the roadmap specifies K1–K6 in detail. Rejected: (a)–(d) are shape choices the roadmap leaves open, and (c) widens the roadmap's stated `emit` narrowing to the hook context.
      - One review per part. Rejected: plan 164's descriptor, profiles, and broker are built on K1, K2, and K6; their seams must be decided together.
    - Chosen Approach:
      - Read the spans, run the counts, decide (a)–(j), and amend Tasks 2–8 here and plan 164 in place.
    - API Notes and Examples:
      ```bash
      graft callers executeTools --depth all
      graft callers createRunController --depth all
      graft callers createScriptedHostUi --depth all
      rg -n 'ChildEventOrigin|\.child\b' src packages examples scripts docs/next -g '!**/dist/**' -g '!**/node_modules/**'
      rg -n '\bctx\.emit\(|\brun\.emit\(' src packages examples -g '!**/dist/**' -g '!**/node_modules/**'
      ```
    - Files to Create/Edit:
      - `plans/163-Phase-13-Part-A-External-Agent-Kernel-Primitives.md`, `plans/164-Phase-13-Part-B-Driver-Kit-Relay-And-Conformance.md`: Notes and amendments only.
    - References:
      - plan 161 Task 1 (review pattern), plan 159 Task 1
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **Verdict: proceed, with the amendments below.** No finding invalidates a later task. Four findings change task text (marked **AMEND**); the rest confirm the plan.
    - **Inventory (all spans confirmed):** `RunController`/`LoopStrategy` `src/loop/types.ts:34-58`; `RunEndResult` `:24`; `createRunController` `src/loop/run-controller.ts:126-327` (`executeTools` `:207`, `dispatchOne` `:249`, `end` `:290`, controller object `:313`); `RunControllerInternals` `:34-72` (`emit(event: AgentEvent)` `:50`, `ask?` `:64`, `chargeToolRound?` `:55`, `queueContinuation` `:68`); kernel `ask` = `resolveAskDecisions` `src/agent-session/session/assemble.ts:83` (the plan said `:454`; that line is now the `emit: (event) => session.emit(event)` wiring and `createRunController` is at `:465`); `HookContext.emit(event: AgentEvent)` `src/hooks/types.ts:30`, built in `contextFor` `src/hooks/bus.ts:116`; `ToolCallHookPayload` `src/hooks/types.ts:91-98`; `PackageAPI.events.emit(name, data)` `src/packages/api.ts:153` over `emitPackageEvent` `src/packages/loader.ts:595-603`; `ChildEventOrigin` `src/contracts-protocol.ts:195`, `AgentEvent` `:435`; `AgentConfig.model: ModelRef` `src/contracts-core/agent.ts:60`, `ResolvedAgentConfig` `:208`, `parseModelRef` `src/agent-session/create-agent.ts:80`; `SESSION_ENTRY_KINDS` `src/contracts-core/session.ts:10-31`; `STORE_CONFORMANCE_STEPS` `src/testing/store-conformance.ts:25-35`; internal `createSessionIndex({store, ownership})` `src/agent/sessions.ts:25`; `summarizeSession` `src/session-stores.ts:582`; `HostUiRequest`/`HostUiAnswerMap`/`HostPort` `src/host/types.ts:56-105`; `createScriptedHostUi` `src/testing/host-ui.ts:24`.
    - **Scope classification:** K1–K6 are kernel additions (named in roadmap §2.12.9). `driver-kit`, `prism relay`, and `/testing` scripted CLI are expressible on K1–K6 plus Node built-ins. `src/` already imports `node:child_process`/`node:http` (`src/manifest/install.ts`, `src/pinned-fetch.ts`), so Node-only code in the kernel has precedent.
    - **Importer counts** (`rg -l '\b<name>\b' src packages examples scripts` excluding `dist/`, `node_modules/`, `scripts/budgets.json`):
      - `ChildEventOrigin`: 1 file (`src/contracts-protocol.ts`, 2 hits). It is not named in `src/index.ts` or `src/contracts.ts` (`rg` finds no hit), so it reaches the root through a wildcard re-export; Task 2 verifies that and drops the `src/index.ts` edit if nothing names it. Also named in `docs/supervisors.md`, `docs/agent-events.md` (released docs, untouched) and the `scripts/budgets.json` reason line (history, untouched). `AgentEvent.child` has zero readers or writers; every `.child` hit in the sweep is an unrelated process handle or delegate tool arg.
      - `RunEndResult`: 6 files (`src/index.ts`, `src/loop/{types,index,run-controller}.ts`, `src/__tests__/public-export-contract.test.ts`, baseline). Task 4.
      - `RunController.emit(event)`: 1 definition (`run-controller.ts:324`) and **0 loop callers** (`rg 'run\.emit\('` finds none; only `src/testing/loop-conformance.ts:193` and the internal `message.completed` at `run-controller.ts:191`). Task 3.
      - `HookContext`: 26 files name it; `ctx.emit(`/`context.emit(` callers are 6 production sites: `packages/policy/model-router/src/around.ts:113,144,266,346`, `packages/policy/governance/src/claim-grounding.ts:84`, `packages/policy/guardrail-packs/src/index.ts:129,161` (forwards into a runner's `emit` option), plus tests `packages/policy/governance/src/__tests__/{field-evidence,package}.test.ts` and `src/testing/loop-conformance.ts:193`. All production sites already emit `type: "package.event"` with their own package name, so the narrow to `(name, data)` loses nothing. Task 3.
      - `executeTools`: 1 definition; callers `examples/custom-loop.ts:23`, `examples/durable-loops-and-approvals.ts:34`, `src/loop/default-loop.ts`, and tests `packages/context/engineering/.../package.test.ts:342`, `packages/policy/governance/.../package.test.ts:392`, `packages/policy/guardrail-packs/.../package.test.ts:310`. All `await` it and ignore the value, so returning results breaks none. Task 3.
      - `run.end()` callers: `src/loop/default-loop.ts:23`, `examples/custom-loop.ts:25`, `src/__tests__/session-state-background.test.ts:316,495`. All branch on `.continue` only. Task 4.
      - `config.model` readers that assume presence (K1): `src/run-bundle.ts:89`, `src/agent-run-state.ts:137`, `src/agent-session/session.ts:266,399,822,1027`, `src/agent-session/session/assemble.ts:278,285,304,386,585`, `src/agent-session/create-agent.ts:143` (`createModelIndex({ configured })`), plus tests asserting `agent.config.model.provider` (`src/__tests__/model-ref.test.ts:76`, `agent-definitions.test.ts:77`). The `packages/providers/*` hits (`prism.config.models`, `config.model`) are provider-local model config, not `AgentConfig.model`. Task 5.
    - **Decisions:**
      - (a) `usesModel?: false` and `runModel?: "passthrough" | "none"` as optional `LoopStrategy` fields, as recommended. Evidence: the loop slot resolves through `slots.resolve("loop", ...)` (`assemble.ts:463`), and `LoopStrategy` is the only object a provided loop hands the kernel; there is no back-pointer to its package. Errors `model_required`, `no_model`, `run_model_unsupported` sit beside the kernel errors in `src/agent-session/`. **AMEND Task 5:** `createAgentWith` parses the model at `create-agent.ts:80` *before* the slot registry exists (`createSlotRegistry` at `:95`), and the loop is only resolved per run (`assemble.ts:463`, `ctx.loop = session.slots().resolve("loop", ...)`). Task 5 must resolve the loop at `createAgent` time (after packages load and slots are assigned) to validate `model_required`; recommended: parse `config.model` only when present, then check `usesModel` after slot assignment.
      - (b) `{ continue: false } | { continue: true; reason: string }`. `RunControllerInternals.queueContinuation` already receives `reason` (`run-controller.ts:308`), so the change is returning `asked.reason`. No caller breaks (see counts).
      - (c) Narrow both. `contextFor` (`bus.ts:116`) builds the context per payload with no owner, so **AMEND Task 3:** the hook context needs the registering owner threaded in (`contextFor(payload, owner)`; the dispatch sites at `bus.ts:207,225,253,276` all know `registration.owner`). `RunController.emit` owner = the loop slot's owner (the loop slot's registered owner; `"kernel"` for `defaultLoop`). `loop-conformance.ts:193` injects synthetic catalog events through `ctx.emit`; it moves to a kernel-internal seam (a `RunControllerInternals`-level `emitRaw`, reachable only through `RUN_CONTROLLER_INTERNALS`).
      - (d) Resumable = `isResumableLoop` (`src/agent-session/helpers.ts:105`: `snapshot` and `restore` both functions). `resolveAskDecisions` stages with `stageAskDecisions` and the run suspends at the next `generate()` (`assemble.ts:414`) or loop end (`tool-round.ts:559`) through `suspendGatedRound` (`tool-round.ts:233`), which throws `AgentRunSuspended`. A broker callback is outside the loop's stack, so `ask` cannot throw it. **AMEND Task 4:** `ask` on a resumable loop with no inline answer stages the decision through the same path and returns `{ allow: false, reason: "approval_pending" }`; the run then suspends at loop end (the loop's `run()` returns, `suspendGatedRound` throws). `ExternalToolDecision` gains the `approval_pending` reason string; plan 164's broker answers the vendor with a deny whose text says approval is pending. A non-resumable loop, or no `host.ui`/`interactive: false`, resolves `non_interactive`. `ask` needs a seam that does not exist on `RunControllerInternals.ask` (it takes `AskRequest[]` and returns `AskResolution` with `kind: "suspend"`); reuse it as-is, mapping `suspend` to `approval_pending` or `non_interactive` by `isResumableLoop`.
      - (e) Seams: `message.delta` is emitted in `provider-round.ts:313-325` via `emitOutput`, tied to a provider stream, so `observe` cannot reuse it. **AMEND Task 4:** `observe` emits `message.delta` through `RunControllerInternals.emit` directly (a typed-event emit, no new path), appends with the controller's existing `append` (runs `message.append` transform, `run-controller.ts:133`), and folds usage through a new `RunControllerInternals.addUsage?(usage)` seam over the run's usage ledger (`runUsage`, `assemble.ts`); add that one seam and no other. Tool-limit charging: `chargeToolRound` (`tool-round.ts:332`) charges `maxToolRounds` once per round, not `maxToolCalls`; **AMEND Task 4 test `observed_tool_calls_count_against_limits`**: the per-call axis is `maxToolCalls` (`src/run-limits.ts:17`, default 32, counter `toolCalls`); `observe` charges `limits.charge("maxToolCalls")` on `tool.started`, not `chargeToolRound`. Standard `agent.*` events use `package: <loop slot owner>` as recommended; catalog count unchanged.
      - (f) Re-entrancy: `toolRounds` (`run-controller.ts:129`) is the only shared counter and is incremented once per `executeTools`. `maxToolRounds` check lives only in `turn()` (`:195`), so concurrent rounds just increment; no lock needed. `dispatchToolCallsInOrder` appends after dispatch; concurrent rounds interleave appends per call (accepted, as recommended). `executeTools` today returns `Promise<void>` and drops results; `dispatchToolCallsInOrder` must return results in input order (a `results[]` array already exists on the concurrent path in `dispatch.ts`; the serial path at `dispatch.ts:30-36` must collect too).
      - (g) K4 storage. **Correction:** SQLite has **no** sessions table. It derives session summaries from `prism_session_entries` (`persistence.ts:1210-1225`, `summarizeSession` over entries). Postgres does have `prism_sessions` (`ddl.ts:51`). **AMEND Task 6:** Postgres: nullable indexed columns on `prism_sessions` via `migrations.ts`. SQLite, JSONL, memory: one `metadata`-kind entry written at session open (`data: { parent: {...} }`), which `summarizeSession` reads; SQLite lists by a scan of the metadata entries unless a new indexed `prism_session_links` table is cheaper (decide in Task 6 after reading `persistence.ts`; the link entry must stay the source of truth either way so `fork` and export carry it). `actor` is passed in `SessionOptions.parent`'s sibling field `actor?: { kind; agent; vendor? }`, not derived (entries carry no `origin` yet; deriving would break on a session with no external entry). **AMEND Task 6:** add `SessionOptions.actor`.
      - (h) K5 bounds: mirror `MAX_STATE_VALUE_BYTES = 64 KiB` (`src/session/state.ts:15`) per entry; add `MAX_EXTERNAL_STATE_ENTRIES` per key (recommended 10 000) and a total bytes cap per key (recommended 8 MiB). Redaction: `package_state` entries are redacted via the session redactor before `append`; `external_state` reuses `SessionLog`-style append (`src/session/state.ts`, the `SessionLog` interface already exists with `op: "append"`). **AMEND Task 7 (Code Quality):** `external_state` is close to `SessionLog` over `package_state` with `op: "append"`; the reason for a new kind is exclusion from `session.messages()` and an unbounded-log cap that `package_state` lacks. Task 7 must state why `package_state` + `append` is insufficient (the roadmap names the new kind, so keep it) and put the new kind in the JSONL switch (`jsonl-store.ts:496-548`; it currently has no `external_state` case and `isSessionEntryKind` rejects unknown kinds fail-closed, so every store rejects until updated, and the SQLite `kind` column check/DDL needs reading in Task 7).
      - (i) K6: five implementers confirmed (`packages/hosts/acp/src/host.ts:31`, `packages/hosts/mcp-server/src/host.ts:26`, `packages/prism-code/src/tui/index.ts:1128-1153`, plus `packages/policy/approval/src/index.ts:128` and `packages/tools/coding/src/ask-user-host.ts:21`, which are *consumers* of `HostUi` that call `ui.request`, not implementers). **AMEND Task 8:** only ACP, MCP-server, and the lab TUI implement `HostUi`; approval and coding `ask_user` only call it, so they need no `terminal` branch, only a check that none uses an exhaustive `switch` on `kind`. The three implementers cast `request as HostUi["request"]`, so the typecheck will not flag a missing `terminal` case; Task 8 needs a runtime test per implementer. TUI answers `unavailable` now (Further Actions: Phase 12 reference host).
      - (j) Plan 164 inputs: Node built-ins suffice (`node:child_process`, `node:net`, `node:http`, `node:crypto`, `node:fs` are all already used in `src/`). **AMEND (plan 164 Task 6):** `src/cli.ts` is `import { runCli } from "./cli-runner.js"` at top level (static), and `package.json` has one `bin` (`prism` → `dist/cli.js`). Dynamic dispatch needs `cli.ts` to check `argv[0] === "relay"` and `await import("./cli-relay.js")` before importing `cli-runner.js`; the static import must become dynamic. `scripts/packaging-current.test.mjs:104` and `scripts/e2e-cli-live.test.mjs:81` pin `dist/cli.js`; no new bin entry is needed. `EventOrigin` joins `frozen` in `scripts/host-surface-allowlist.json` (`AgentEvent` is already there).
    - **Plan 164 (f) correction:** its example command `rg -i '\b(claude|codex|agy|antigravity|gemini)\b' src/testing src/cli*.ts` hits `src/cli-providers.ts:31` (the model id `anthropic/claude-sonnet-4`). The forbidden-name scan must cover `src/driver-kit/`, `src/testing/`, `src/cli-relay.ts`, `src/relay*` only, not `src/cli*.ts`. `src/testing/` has no hits today.
    - **Failing-test baseline (2026-10-10, tree at `72a4f9df` + 1706 uncommitted paths):**
      - `bun run typecheck`: **fails** in `@arnilo/prism-tools-web` (`src/obscura/__tests__/browser.test.ts(12,8)`: `../../browser/index.js` missing) and `@arnilo/prism-tools-coding` (`src/security/approval.ts(2,*)`: `ExecutionAction`/`ExecutionDecision`/`ExecutionPolicy` not exported by `@arnilo/prism`). Neither is in this plan's file list. Everything else exits 0. The editor also flags `cli-runner.ts:17` (`createSkillRegistry` unused) and `packages/hosts/devtools/src/__tests__/serve.test.ts:6` (`resolveDevtoolsToken` missing from `../index.js`, though `serve.ts`/`security.ts` define it).
      - Kernel suites (the 12 files in Verification): 530 pass, **1 fail** (`src/__tests__/packaging.test.ts:518`, `npm ls --all --depth=0` exits 1: stale nested `@arnilo/prism-core@0.12.1` under `packages/{prism-coding-tools,hosts/devtools,hosts/evals,tools/coding}/node_modules`).
      - Stores: jsonl typecheck ok, 42 pass; sqlite typecheck ok, 36 pass, **1 fail** (`sqlite-persistence.test.ts:1116`, "names the Bun runtime when the sqlite modules are imported under node"); postgres typecheck ok, 12 pass, 37 skipped (no `PRISM_POSTGRES_URL`).
      - `node scripts/release.mjs gate`: **fails** at the compat step (`@arnilo/prism-tools-coding declaration emit failed`, same `ExecutionAction` errors).
      - Plan 162's close was **not** compared (its Notes were not re-read in this task); these failures are present in the current tree and none touches K1–K6. Task 2 opens by re-running this list and diffing. **Rule for Tasks 2–8:** a task is green when it adds no new failure beyond this list; the gate's compat step cannot go green until `tools-coding`/`tools-web` are repaired, so each task records the `--update-baseline` diff for `arnilo__prism*` files only and notes the gate as red-for-baseline-reasons.
    - **Security confirmations:** `ask` with a throwing `tool.call` hook: `hooks.decide` failure path must be checked in Task 4 (the existing `executeTools` lets it throw; for `ask` wrap in try/catch and deny). `observe` never fires `tool.call` by construction (it does not call `executeTools`). A `terminal` request without `host-ui`: the package `host` wrapper that refuses other kinds (`capabilities.ts:10,21`) is kind-agnostic, so `terminal` is refused the same way; verify with the Task 8 test. The narrowed `emit` can produce only `package.event`; Task 3's `emit_reserved_name` check covers a cast.
    - **Files amended:** Tasks 3, 4, 5, 6, 7, 8 below, and plan 164 Task 1 (f) and Task 6 (relay dispatch). No code was changed.

- [x] Task 2: K3 — `EventOrigin` replaces `child` repo-wide
  - Acceptance Criteria:
    - Functional: `EventOrigin` (§2.12.9 K3: `kind`, `agent`, `vendor?`, `profile?`, `agentId`, `remote?`, `delegationId?`, `parentSessionId?`, `parentToolCallId?`, `subagentId?`, `depth`, `executedBy?`) is exported from the root. `AgentEvent` is `AgentEventPayload & { readonly origin?: EventOrigin }`. `ChildEventOrigin` and the `child` member are deleted, with no alias.
    - Functional: `ToolCallHookPayload` gains `origin?: EventOrigin`. The kernel's own model-loop calls carry no `origin` (absent means "this agent, executed by Prism"), so existing `tool.call` hooks see an unchanged payload.
    - Functional: The event count of the catalog does not change (`OBSERVE_HOOKS` keyed by `AgentEventPayload`).
    - Functional: Retirement sweep: `rg -n 'ChildEventOrigin|\bchild\?: |\.child\b'` over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`) returns only unrelated hits (process handles, delegate tool args), each listed in the task note.
    - Performance: Type-only for the event; the `tool.call` payload gains one optional field. No allocation on the default path.
    - Code Quality: `EventOrigin` lives next to `AgentEvent` in `src/contracts-protocol.ts`. `vendor` is an opaque `string`, documented as "set by the driver", with no example vendor names in the type's comments.
    - Security: `origin.profile` is a profile name and never a credential. The redactor still runs over every event.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.9 K3, §2.12.15; `docs/next/events.md:24`
      - `src/contracts-protocol.ts:195-200`, `:435`; `src/hooks/types.ts:91-98`
      - `scripts/host-surface-allowlist.json`
    - Options Considered:
      - Keep `child` beside `origin` until Phase 11. Rejected: roadmap §1.4 forbids aliases, and `child` has no producer.
      - Put `origin` inside `AgentEventPayload` members one by one. Rejected: the roadmap puts it on every event; the intersection keeps one definition.
    - Chosen Approach:
      - Replace the type, add the payload field, regenerate baselines, and add `EventOrigin` to the allow-list's `frozen` set.
    - API Notes and Examples:
      ```ts
      export interface EventOrigin {
        readonly kind: "prism" | "external";
        readonly agent: string;
        readonly vendor?: string;
        readonly profile?: string;
        readonly agentId: string;
        readonly remote?: string;
        readonly delegationId?: string;
        readonly parentSessionId?: string;
        readonly parentToolCallId?: string;
        readonly subagentId?: string;
        readonly depth: number;
        readonly executedBy?: "prism" | "external";
      }
      export type AgentEvent = AgentEventPayload & { readonly origin?: EventOrigin };
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: `EventOrigin`, `AgentEvent`; delete `ChildEventOrigin`.
      - `src/hooks/types.ts`: `ToolCallHookPayload.origin`.
      - `src/index.ts`: export `EventOrigin`, drop `ChildEventOrigin`.
      - `src/__tests__/public-export-contract.test.ts`, `src/__tests__/agent-surface-freeze.test.ts`: freeze update.
      - `scripts/host-surface-allowlist.json`: add `EventOrigin` to `frozen`.
      - `scripts/compat-baseline/arnilo__prism.txt` (and any package baseline the regeneration rewrites): `node scripts/release.mjs gate --update-baseline`; the task note records the diff with `ChildEventOrigin` removal attributed to this plan.
      - `scripts/budgets.json`: export-count reason line, if the counter moves.
      - `docs/next/events.md`: replace the `child` note with an `origin` section.
      - `CHANGELOG.md`: `## [Unreleased]` entry.
    - References:
      - plan 160 Task 4 (supervisor retirement), plan 148 Task 4 (event catalog freeze)
  - Test Cases to Write:
    - `event_origin_replaces_child`: a type-level and runtime check that `AgentEvent` has no `child` key and accepts `origin`; fails if `child` returns.
    - `tool_call_payload_carries_origin`: a `tool.call` hook registered on a custom loop sees `origin` passed to `executeTools` (lands with Task 3's `origin` option; this task asserts the default loop's payload has no `origin` key).
    - `catalog_count_unchanged_by_origin`: the `OBSERVE_HOOKS` key count equals the pre-change count.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a public type is replaced.
    - Docs pages to create/edit:
      - `docs/next/events.md`: `origin` fields and meaning, `executedBy` semantics, no `child`.
    - `docs/index.md` update: no — `docs/next/` is staged.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **What changed:** `src/contracts-protocol.ts`: `ChildEventOrigin` deleted, `EventOrigin` added next to `AgentEvent`; `AgentEvent = AgentEventPayload & { readonly origin?: EventOrigin }`. `src/hooks/types.ts`: `ToolCallHookPayload.origin?: EventOrigin`. `scripts/host-surface-allowlist.json`: `EventOrigin` joins `frozen`. `src/__tests__/agent-surface-freeze.test.ts`: `EventOrigin` added to `ROOT_TYPES`. New `src/__tests__/event-origin.test.ts` (`event_origin_replaces_child`, `tool_call_payload_carries_origin`, `catalog_count_unchanged_by_origin`: 3 pass). `docs/next/events.md` `origin` section replaces the `child` note. `CHANGELOG.md` Unreleased entry.
    - **No `src/index.ts` edit:** `AgentEvent`/`ChildEventOrigin` reach the root through `export type * from "./contracts.js"` (`src/index.ts:142`), so `EventOrigin` is exported with no named change. `public-export-contract.test.ts` needed no edit (it pins named exports only; it passes).
    - **Baseline:** `scripts/compat-baseline/*` records value exports only (no type names; `rg 'EventOrigin|child'` finds none), so this type-only change produces no baseline diff. `node scripts/release.mjs gate --update-baseline` aborts at the known `tools-coding` compat emit failure (Task 1 baseline), so nothing was regenerated by this task; the existing working-tree baseline diffs are earlier WIP, not from this plan. `scripts/budgets.json` counter: no export-count change (types are not counted as new values; no edit).
    - **Sweep:** `rg -n 'ChildEventOrigin|\bchild\?: |\.child\b'` over `src packages apps scripts examples docs` (excluding dist, node_modules, history, `_evidence`, `budgets.json` history line) has zero live `ChildEventOrigin`/`event.child` readers or writers. Remaining hits are unrelated process handles (`scripts/phase27-*.test.mjs`, `packages/tools/coding/.../client.ts`, `sessions-teardown.ts`), delegate tool args (`packages/integrations/delegate/src/{runtime,tools,step}.ts`), and ag-ui `props.child`. Released docs `docs/supervisors.md`, `docs/agent-events.md`, `docs/multi-agent-patterns.md` still describe the 0.12 supervisor `child` tag; they are released docs and stay untouched until the 0.13 docs promotion.
    - **Checks:** typecheck adds no new error (kernel `tsc` clean; the `tools-web`/`tools-coding` failures are the Task 1 baseline). `public-export-contract`, `agent-surface-freeze`, `hook-catalog-freeze`, `hook-invariants`, `event-origin` all pass. `docs.test.ts` has 6 failures (markdown links, retired package names, manifest kinds, connector sidecar, `RunOptions` per-run tools, `activeSkills`) that sit in `RunOptions`/docs areas this task did not touch; they predate it and are not in Task 1's baseline list, so Task 3 should re-baseline them before relying on `docs.test.ts` as a gate.
    - **For later tasks:** `tool_call_payload_carries_origin` only asserts the default path has no `origin` key; the positive case lands with Task 3's `executeTools({ origin })`.

- [x] Task 3: K2 (first half) — narrowed `emit` and re-entrant, result-returning `executeTools`
  - Acceptance Criteria:
    - Functional: `RunController.emit(name: string, data: JsonValue): void` emits one `package.event` whose `package` is the loop's slot owner (`"kernel"` for `defaultLoop`). `HookContext.emit` takes the same signature and emits a `package.event` owned by the registering owner (per Task 1 (c)). Neither can produce a catalog event.
    - Functional: `executeTools(calls, { concurrency?, origin? })` returns `readonly ToolResult[]` in input order (including `hook_denied` and `approvalPending` results). It is re-entrant: two overlapping calls each fire `tool.call` once per call, append their results, and count toward `maxToolRounds` per Task 1 (f). `origin` is passed to `tool.call` and stamped on the call's `tool.*` events.
    - Functional: `src/testing/loop-conformance.ts` synthetic-event injection moves to the kernel-internal seam Task 1 (c) names; its legs stay green.
    - Functional: Every caller found by Task 1's count is updated in this task: in-repo custom loops (`packages/**`, `examples/custom-loop.ts`, tests) and every `ctx.emit(` hook caller.
    - Performance: `executeTools` allocates one result array per call; no extra hook dispatch. Re-entrancy adds no lock on the default path (a single caller).
    - Code Quality: The internal `emit(event)` seam (`RunControllerInternals.emit`) stays internal; only the public surface narrows. No new type for the narrowed signature beyond the method.
    - Security: The invariant "a loop cannot emit a catalog event" is enforced by the type and by a runtime check that rejects a `name` equal to a catalog event name (`emit_reserved_name`), so a cast cannot bypass it. A throwing `tool.call` hook in a concurrent call denies only that call.
  - Amended by Task 1 (2026-10-10):
    - `contextFor` (`src/hooks/bus.ts:116`) has no owner; thread `registration.owner` from the four dispatch sites (`bus.ts:207,225,253,276`). Callers to update: none in production (all six already emit `package.event` with their package name); move them to `(name, data)` anyway: `model-router/src/around.ts:113,144,266,346`, `governance/src/claim-grounding.ts:84`, `guardrail-packs/src/index.ts:129,161`, and tests `governance/src/__tests__/{field-evidence,package}.test.ts`. `emit_reserved_name` blocks a name equal to any catalog event.
    - `dispatchToolCallsInOrder` serial path (`dispatch.ts:30-36`) must collect results too.
  - Approach:
    - Documentation Reviewed:
      - roadmap §1.4, §2.5, §2.12.9 K2; G3, G4
      - `src/loop/types.ts:34-56`; `src/loop/run-controller.ts:207-247`, `:313-326`; `src/loop/dispatch.ts`; `src/hooks/types.ts:29-30`; `src/hooks/bus.ts:116`; `src/testing/loop-conformance.ts:188-195`
    - Options Considered:
      - Keep `emit(event)` and filter catalog types at runtime only. Rejected: the type would still advertise the wrong contract.
      - Serialize all `executeTools` calls behind a queue. Rejected: the broker must answer concurrent vendor callbacks without head-of-line blocking (§2.12.10).
    - Chosen Approach:
      - Narrow both `emit` surfaces, return results from `dispatchToolCallsInOrder`, thread `origin` to the payload and events, and keep per-call state local so overlapping calls are independent.
    - API Notes and Examples:
      ```ts
      interface RunController {
        executeTools(calls: readonly ToolCallContent[], options?: { readonly concurrency?: number; readonly origin?: EventOrigin }): Promise<readonly ToolResult[]>;
        emit(name: string, data: JsonValue): void; // package.event only
      }
      ```
    - Files to Create/Edit:
      - `src/loop/types.ts`, `src/loop/run-controller.ts`, `src/loop/dispatch.ts`: signatures, results, `origin`, reserved-name check.
      - `src/hooks/types.ts`, `src/hooks/bus.ts`: narrowed `HookContext.emit`.
      - `src/testing/loop-conformance.ts`: internal injection seam.
      - every caller from Task 1's count (tentative until the count lands: `examples/custom-loop.ts`, `packages/integrations/delegate/src/**`, `packages/memory/*/src/**` hooks that call `ctx.emit`).
      - `scripts/compat-baseline/arnilo__prism.txt` and `arnilo__prism-*` baselines whose declarations reference `RunController`: regenerate with `node scripts/release.mjs gate --update-baseline`; record the diff and attribution in the task note.
      - `docs/next/loop.md`, `docs/next/hooks.md`: signatures and invariants.
      - `CHANGELOG.md`.
    - References:
      - plan 144 Task 4 (`RunController`), plan 146 Task 4 (`package.event`)
  - Test Cases to Write:
    - `loop_cannot_emit_catalog_event` (invariant): a custom loop calling `run.emit("tool.completed", {})` throws `emit_reserved_name`; `run.emit("x.y", {})` yields one `package.event` with the slot owner.
    - `hook_context_cannot_emit_catalog_event`: same through a `turn.before` hook's `ctx.emit`.
    - `execute_tools_returns_results_in_order`: denied, allowed, and pending calls come back in input order.
    - `concurrent_execute_tools_fires_tool_call` (invariant): two overlapping `executeTools` from a custom loop each fire `tool.call` once per call and both results append.
    - `execute_tools_origin_reaches_payload_and_events`: `origin` appears on the `tool.call` payload and the `tool.started`/`tool.completed` events.
    - Each invariant test runs from `defaultLoop` (where applicable) and from a custom loop via `loopConformance`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `RunController` and `HookContext` signatures.
    - Docs pages to create/edit:
      - `docs/next/loop.md`: `emit`, `executeTools` result and re-entrancy, `origin`.
      - `docs/next/hooks.md`: `HookContext.emit` is `package.event` only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **What changed:** `src/hooks/emit.ts` (new): `packageEventFor(owner, sessionId, runId, name, data)` builds the one event a loop or hook may emit and throws `emit_reserved_name` (a `HookError`) when `name` is any `HOOK_CATALOG` key; `RAW_EMIT` is the kernel-internal test seam (not in any barrel). `HookContext.emit(name, data)` (`src/hooks/types.ts`); `createHookBus` (`src/hooks/bus.ts`) now builds a per-registration context view in every dispatch (previously only on a session-bound bus), so `emit` is owned by the registering package; the base context's `emit` is a no-op. `RunController.emit(name, data)` and `executeTools(calls, { concurrency?, origin? }): Promise<readonly ToolResult[]>` (`src/loop/types.ts`, `run-controller.ts`); `RunControllerInternals.loopOwner` (new, wired in `assemble.ts` from `slots().ownerOf("loop", ...)`) and `dispatchToolCall(call, origin?)`. `dispatchToolCallsInOrder` returns results in input order on both the serial and concurrent paths (`dispatch.ts`). `bindDispatchToolCall` stamps `origin` on the call's `tool.*` events by wrapping its `emit`. `tool.call` payload carries `origin` only when supplied.
    - **Callers moved:** `model-router/src/around.ts` (4), `governance/src/claim-grounding.ts` to `(name, data)`; `guardrail-packs/src/index.ts` (2) and the governance tests forward a runner `package.event` into `context.emit(event.name, event.data ?? null)`; `claim-grounding.test.ts` helper; `src/testing/loop-conformance.ts` injects synthetic catalog events through `RAW_EMIT` on the hook context. Because the package is now stamped by the registering owner, `claim-grounding` emits as the governance package rather than `"kernel"`; the unused `PACKAGE` const is removed. Test fixtures `run-controller.test.ts` (`loopOwner`) and `tool-narrowing.test.ts` (`Promise<unknown>`) adjusted. `examples/` and the other `executeTools` callers ignore the return value and needed no edit.
    - **Tests (all pass):** `run-controller.test.ts`: `loop_cannot_emit_catalog_event`, `emit_is_owned_by_the_loop_slot_owner`, `hook_context_cannot_emit_catalog_event`, `execute_tools_returns_results_in_order`, `execute_tools_returns_approval_pending_marker_in_place`, `concurrent_execute_tools_fires_tool_call`, `execute_tools_origin_reaches_payload_and_dispatch`, `a_throwing_tool_call_hook_denies_only_that_call_in_a_concurrent_round`. `hook-invariants.test.ts` (custom loop through `loopConformance`): `execute_tools_origin_stamps_tool_events_from_a_custom_loop`, `default_loop_tool_events_carry_no_origin`. This also settles Task 2's open item: the positive `tool_call_payload_carries_origin` case is covered.
    - **Checks:** kernel `tsc` clean; package typechecks clean for governance (apart from its pre-existing perf-benchmark timeout, see below), model-router, guardrail-packs, context-engineering, delegate; `tsc -p examples` clean. The 16-file kernel list (Verification files plus `run-controller`, `event-origin`, `session-state-background`, `hook-catalog-freeze`): 573 pass, 1 fail (`packaging.test.ts` `npm ls`, the Task 1 baseline). Package suites: model-router 44, guardrail-packs 11, context-engineering 77, delegate 13 pass; governance 124 pass, 2 skip, 1 fail (`field-policy.test.ts` microbenchmark exceeded its 5 s timeout, a timing test unrelated to `emit`; not in Task 1's baseline, so re-check on a quiet machine). `docs.test.ts` shows the same 6 failures Task 2 recorded.
    - **Baseline diff:** none. `scripts/compat-baseline/*` records value exports only and this task changes types and method signatures. `node scripts/release.mjs gate` stays red for the Task 1 `tools-coding` compat emit reason.
    - **Docs:** `docs/next/loop.md` (table rows, `emit` / re-entrancy / `origin` notes), `docs/next/hooks.md` (`emit` bullet), `CHANGELOG.md`.
    - **Findings for later tasks:** (1) Task 4 can reuse `internals.emit` and the new `loopOwner` for `agent.*` package events; `packageEventFor` is the one builder, so `observe` should call it with `internals.loopOwner` rather than hand-build events. (2) `RunControllerInternals.dispatchToolCall` now takes `origin`; `observe` must not use it (it never dispatches). (3) The hook bus now allocates a per-dispatch `Map` and one view per registration owner even on an unbound bus; the cost is bounded by registrations, but Task 4's `message.delta` `observe` path is hot, so check it against the performance budget. (4) I ran `git stash` / `git stash pop` once on the dirty tree to compare a governance test baseline; the pop restored everything (verified by diff), but do not repeat it on this tree. The one remaining stash entry (`stash@{0}`, from commit `12192d66`) predates this task.

- [x] Task 4: K2 (second half) — `observe`, `ask`, `steers()`, and `end()` with a reason
  - Acceptance Criteria:
    - Functional: `observe(activity: ExternalActivity)` handles every kind in §2.12.9 K2:
      - `message.delta` (text or thinking) emits `message.delta`; `message` appends through `message.append` with redaction and persists with `origin`. Thinking persists as `thinking` content.
      - `tool.started`/`tool.progress`/`tool.completed` emit the catalog `tool.*` events with `origin.executedBy: "external"`, and count against the tool-call limit.
      - `skill`, `file`, `plan`, `subagent`, `compaction`, `notice`, `raw` emit `package.event` with `name: "agent.<kind>"` and the slot owner as `package` (per Task 1 (e)). `subagent` `started` opens a nested `origin` scope (`depth + 1`, `subagentId`, `parentToolCallId`) that later activities inherit until `completed`.
      - `usage` folds into `RunResult.usage` and `turn.completed`.
      - It never fires `tool.call`.
    - Functional: `ask(request: ExternalToolRequest): Promise<ExternalToolDecision>` fires `tool.call` with `origin` and the request's `effects`. `allow` → `{ allow: true }`. `deny` → `{ allow: false, reason }`. `ask` resolves inline through `host.ui`; with no UI it suspends only on a resumable loop (Task 1 (d)), else `{ allow: false, reason: "non_interactive" }`. `rewrite` → `{ allow: true, args }`; the driver-side `rewrite` support check lives in plan 164's descriptor, so the kernel takes a per-call `{ rewrite?: boolean; respond?: boolean }` support flag and answers `rewrite_unsupported` / `respond_unsupported` denies when the flag is off. A throwing gate is a deny.
    - Functional: `steers(): AsyncIterable<Message>` yields each message `session.steer()` queues, after the `run.input` transform (the same gate `applyPendingSteers` applies, `src/agent-session/session.ts:934`). It ends when the run ends or aborts. A loop that never calls `steers()` keeps today's behavior: steers apply at `turn()`.
    - Functional: `end()` returns `{ continue: false } | { continue: true; reason: string }` (Task 1 (b)), callable from any async context during `run()` (a broker callback), capped by `limits.maxContinuations`.
    - Functional: `ExternalActivity`, `ExternalToolRequest`, and `ExternalToolDecision` are root type exports.
    - Performance: `observe` of a `message.delta` costs one event emit and no store write; only `message` and terminal tool events write. `steers()` adds no polling: it awaits the existing queue.
    - Code Quality: `observe` and `ask` reuse the controller's existing append, usage, limit, and `ask` seams (`RunControllerInternals`); no second redaction or dispatch path. The `agent.*` names are kernel constants, so plan 164's driver kit re-exports them rather than redefining them.
    - Security: `observe` never fires `tool.call` and always stamps `executedBy: "external"` on tool events, so a driver cannot claim Prism executed a vendor tool. `ask` with a throwing `tool.call` hook, a `dismissed` UI, or no UI on a non-resumable loop is a deny. `raw` data is redacted before emit.
  - Amended by Task 1 (2026-10-10):
    - `ask` on a resumable loop (`isResumableLoop`, `src/agent-session/helpers.ts:105`) with no inline answer stages through `stageAskDecisions` and returns `{ allow: false, reason: "approval_pending" }`; the run suspends at loop end through `suspendGatedRound` (`tool-round.ts:233`). Add `approval_pending` to the decision reasons and a test `resumable_ask_stages_and_suspends_at_loop_end`.
    - `observe` needs one new internal seam, `addUsage`; tool-call limit is `limits.charge("maxToolCalls")` on `tool.started`. `ask` wraps `hooks.decide("tool.call")` in try/catch and denies on throw.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.5, §2.12.7 ("What gets captured"), §2.12.9 K2; G4, G8
      - `src/loop/run-controller.ts:34-72` (internals), `:207-311`; `src/agent-session/session/assemble.ts:83-135`, `:454`; `src/agent-session/session.ts:439-451`, `:934-960`
    - Options Considered:
      - Emit `agent.*` as new catalog events. Rejected: the roadmap keeps the catalog count unchanged and names them package events.
      - Put `observe`/`ask` in the driver kit only. Rejected: they must emit catalog `tool.*` events and fire `tool.call`, which only primitives may do (§1.4).
    - Chosen Approach:
      - Add the four members on `createRunController`, each delegating to the existing internal seams, and add `steers()` over the session's steer queue.
    - API Notes and Examples:
      ```ts
      const decision = await run.ask({ toolCallId: "t1", name: "write_file", args: { path: "a.ts" }, effects: ["write"] });
      if ("allow" in decision && decision.allow) answerVendor("allow");
      await run.observe({ kind: "tool.started", call: { id: "t1", name: "write_file" }, effects: ["write"] });
      await run.observe({ kind: "file", path: "a.ts", change: "modified", source: "agent" });
      for await (const steer of run.steers()) writeToVendor(steer);
      ```
    - Files to Create/Edit:
      - `src/loop/types.ts`: `observe`, `ask`, `steers`, `RunEndResult`; the three external types.
      - `src/loop/run-controller.ts`: implementations; `RunControllerInternals` gains only what Task 1 (d)/(e) name.
      - `src/agent-session/session.ts`, `src/agent-session/session/assemble.ts`: steer iterator and the ask/suspend wiring Task 1 (d) selects.
      - `src/index.ts`, `src/__tests__/public-export-contract.test.ts`, `src/__tests__/agent-surface-freeze.test.ts`.
      - `src/testing/loop-conformance.ts`: legs for `observe`, `ask`, `steers`, `end` reason.
      - `src/loop/default-loop.ts` and every `end()` caller from Task 1 (b): the new result shape.
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate (`node scripts/release.mjs gate --update-baseline`); diff in the note.
      - `docs/next/loop.md`, `docs/next/events.md`, `CHANGELOG.md`.
    - References:
      - plan 144 Task 5 (`ask` resolution), plan 148 Task 4 (event catalog)
  - Test Cases to Write:
    - `observe_never_fires_tool_call` (invariant): observing `tool.started`/`tool.completed` emits `tool.*` with `executedBy: "external"` and no `tool.call` probe fires.
    - `thinking_deltas_persist_as_thinking_content` (invariant): `message.delta` thinking plus a final `message` with thinking blocks persist as `thinking` content in `session.messages()`.
    - `observe_every_activity_kind`: one assertion per kind (13), including the nested `origin` scope for `subagent` and usage folded into `RunResult.usage`.
    - `observed_tool_calls_count_against_limits`: `maxToolCalls: 1` stops the run on the second observed call.
    - `non_resumable_ask_without_ui_denies` (invariant): a loop without `snapshot`/`restore`, no `host.ui`, a `tool.call` hook returning `ask` → `non_interactive`.
    - `ask_inline_confirm`: scripted `confirm: true` → allow; `dismissed` → deny.
    - `ask_rewrite_and_respond_flags`: rewrite with support off → `rewrite_unsupported`; on → `{ allow: true, args }`; respond likewise.
    - `ask_throwing_gate_denies`.
    - `steers_yields_queued_input_without_turn`: a loop that never calls `turn()` receives a `session.steer()` message after `run.input`; a dropping `run.input` handler removes it.
    - `end_returns_reason_from_callback`: a loop calls `end()` from a timer callback; a `run.end` hook's `continue` reason comes back; the `maxContinuations` cap returns `{ continue: false }`.
    - The invariant tests run from `defaultLoop` where the primitive applies and from a custom (driver-shaped) loop.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `RunController` primitives and types.
    - Docs pages to create/edit:
      - `docs/next/loop.md`: "Driver primitives" section (observe, ask, steers, end) with the invariants.
      - `docs/next/events.md`: `executedBy: "external"` tool events and the `agent.*` package event names and payloads.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **What changed:** `src/loop/types.ts`: `ExternalActivity`, `ExternalToolRequest`, `ExternalToolDecision`, `ExternalAskSupport` (root type exports via `src/loop/index.ts` and `src/index.ts`), `RunEndResult = { continue: false } | { continue: true; reason }`, and `observe` / `ask` / `steers` on `RunController`; the `EXTERNAL_ACTIVITY_EVENTS` kernel constant (`agent.*` names) is exported from `src/loop/index.ts` only, so no root value export was added. `src/loop/run-controller.ts`: implementations. Internals gained `resumable`, `addUsage`, `hasPendingSteers`, `drainSteers`, `onSteer`, and an `options.suspend` argument on `ask`. `src/agent-session/session.ts`: `applyPendingSteers` now delegates to a new `drainSteers` (same `run.input` gate, history, and store writes, and it returns the kept messages) and `steer()` wakes `onSteer` listeners. `assemble.ts` wires them; `resolveAskDecisions` with `suspend: false` returns `suspend` without staging, and `ask` maps it to `non_interactive`. `end()` returns the reason.
    - **Amendments from Task 1 as built:** `isResumableLoop` does not exist; the real helper is `isDurableLoop` (`src/agent-session/helpers.ts:102`, true for `defaultLoop` and any loop with `snapshot` and `restore`). `ask` on a durable loop stages through `stageAskDecisions` and returns `approval_pending`; the run suspends at loop end. `tool.started` charges `limits.charge("maxToolCalls")`; `addUsage` calls `limits.recordUsage` and `runUsage.add`.
    - **Tests (all pass):** new `src/__tests__/driver-primitives.test.ts` (10): `observe_never_fires_tool_call`, `thinking_deltas_persist_as_thinking_content`, `observe_every_activity_kind` (nested subagent scope, usage), `observed_tool_calls_count_against_limits`, `non_resumable_ask_without_ui_denies`, `ask_inline_confirm`, `resumable_ask_stages_and_suspends_at_loop_end`, `ask_rewrite_and_respond_flags`, `ask_throwing_gate_denies`, `steers_yields_queued_input_without_turn` (a dropping `run.input` handler removes a message), `end_returns_reason_from_callback` (including the `maxContinuations` cap). Updated: the controller-keys assertions in `run-controller.test.ts` and `hook-invariants.test.ts`, `run_end_continue_capped`, and the frozen type list in `public-export-contract.test.ts`.
    - **Checks:** kernel `tsc` and `tsc -p examples` clean. `bun run build:core` rebuilt `dist` so the built-declaration export check passes (103 pass). `bun test src` still shows the failures already on this tree (docs markdown links, packaging `npm ls`, hooks-json compile, Prism Code and MCP suites, lifecycle checkpoint); none touches these files. I did not diff them against a pre-change run, so re-baseline before relying on them.
    - **Baseline diff:** none. `scripts/compat-baseline/*` records value exports only and this task adds types.
    - **Not done:** the plan listed new `loopConformance` legs in `src/testing/loop-conformance.ts`. That file is a single-run harness with no leg list, so the invariants live in `driver-primitives.test.ts` over driver-shaped loops instead. Plan 164's `driverConformance` is the right home for reusable legs.
    - **Findings for later tasks:** (1) `observe` stamps a base origin of `{ kind: "external", agent: loopOwner, agentId: loopOwner }`; plan 164's driver kit has no way to set `vendor`/`profile`/`agentId` on it yet, so either `defineDriver` needs an internals seam or `observe` needs an `origin` option. (2) `observe` does not append a tool-result message for `tool.completed` (events only), because an external transcript has no matching assistant tool call. (3) `ask` passes `request.effects` straight to `tool.call`; the "unknown tool gets every effect" mapping belongs to the driver. (4) `ask` on a durable loop for a tool the registry does not know goes through `buildPendingDecision`; it worked in the test, but a driver conformance leg should cover an unregistered vendor tool name with a registered-name collision.

- [x] Task 5: K1 — model-less agents and `run.model`
  - Acceptance Criteria:
    - Functional: `AgentConfig.model` is optional. `createAgent` resolves the loop slot first; if the resolved loop does not declare `usesModel: false`, a missing model fails with `model_required`. `ResolvedAgentConfig.model` becomes `ModelSpec | undefined`, and every reader handles absence.
    - Functional: `run.turn()` on a model-less agent fails the run with `no_model`. `agent.models`, `inspect()`, side calls (`models.client`), and compaction report "no model" without throwing at load.
    - Functional: `RunController.model?: ModelRef` exposes the run's model (`RunOptions.model` or the agent's). On a loop declaring `runModel: "none"`, a `RunOptions.model` fails the run with `run_model_unsupported` before the loop starts.
    - Functional: Every reader of `config.model` found by `graft callers` is updated in this task.
    - Performance: No change on the default path; the loop is resolved once, as today.
    - Code Quality: The fields are optional `LoopStrategy` members (Task 1 (a)); the core imports nothing from the driver kit. No branch in the default loop.
    - Security: A missing model never falls back to a default provider. Unknown `runModel` values fail closed at `createAgent`.
  - Amended by Task 1 (2026-10-10):
    - Resolve the loop at `createAgent` time, after slot assignment (slot registry is created at `create-agent.ts:95`, after `parseModelRef` at `:80`); parse `model` only when present. Readers to make absence-safe: `run-bundle.ts:89`, `agent-run-state.ts:137`, `session.ts:266,399,822,1027`, `assemble.ts:278,285,304,386,585`, `create-agent.ts:143`; tests `model-ref.test.ts:76`, `agent-definitions.test.ts:77`.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.9 K1, §2.3; G5
      - `src/contracts-core/agent.ts:60`, `:208`; `src/agent-session/create-agent.ts:80-81`, `:143`; `src/contracts-protocol.ts:84`; `src/models/`
    - Options Considered:
      - A sentinel "none" model. Rejected: it would flow into `model.call` and providers.
      - Decide `usesModel` at run time. Rejected: the roadmap requires `createAgent` to fail.
    - Chosen Approach:
      - Make the field optional, resolve the loop before model validation, and guard `turn()`.
    - API Notes and Examples:
      ```ts
      const agent = await createAgent({ slots: { loop: { name: "ext", revision: "1", usesModel: false, runModel: "passthrough", run: async (run) => { /* run.model */ } } } });
      ```
    - Files to Create/Edit:
      - `src/loop/types.ts`: `usesModel?`, `runModel?`, `RunController.model`.
      - `src/contracts-core/agent.ts`, `src/agent-session/create-agent.ts`, `src/loop/run-controller.ts`, `src/agent/models.ts`, `src/agent/inspect.ts`, `src/models/registry.ts` (tentative; from the callers count).
      - error codes beside the existing kernel errors (`src/agent-session/` or `src/models/`, per Task 1 (a)).
      - `scripts/compat-baseline/arnilo__prism.txt`: regenerate; diff in the note.
      - `docs/next/agent.md`, `docs/next/loop.md`, `docs/next/models.md`, `CHANGELOG.md`.
    - References:
      - plan 151 Task 2 (model layer), Part 3 "In-flight work" note on K1
  - Test Cases to Write:
    - `model_required_without_model_less_loop`: default loop, no model → `model_required`.
    - `model_less_loop_creates_agent`: `usesModel: false` loop, no model → agent runs; `inspect()` shows no model.
    - `turn_without_model_fails_no_model`: a `usesModel: false` loop that calls `turn()` → run fails `no_model`.
    - `run_model_passthrough`: `RunOptions.model` reaches `run.model`.
    - `run_model_none_fails_closed`: `runModel: "none"` plus `RunOptions.model` → `run_model_unsupported`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentConfig.model` optional, new loop fields and errors.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `model` optionality and errors.
      - `docs/next/loop.md`: `usesModel`, `runModel`, `run.model`.
      - `docs/next/models.md`: behavior with no model.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - **What changed:** `AgentConfig.model` optional, `ResolvedAgentConfig.model` is `ModelSpec | undefined` (`src/contracts-core/agent.ts`). `LoopStrategy.usesModel?: false` / `runModel?: "passthrough" | "none"` and `RunController.model?` (`src/loop/types.ts`). New `ModelError` (`src/agent-session/model-errors.ts`; codes `model_required`, `no_model`, `run_model_unsupported`, `invalid_run_model_mode`). `createAgentWith` parses `model` only when present and, after package load, resolves the loop slot: no model and not `usesModel: false` is `model_required`; an unknown `runModel` is `invalid_run_model_mode`. `createRunController` takes `internals.model`, exposes it as `run.model`, and `turn()` throws `no_model` without one (`assemble.ts` repeats the check on the provider-input path). `assembleRoundContext` resolves the loop first: `runModel: "none"` plus `RunOptions.model` throws `run_model_unsupported`, and a `usesModel: false` loop skips `resolveRunProvider`, so a passed-through `RunOptions.model` is never looked up as a Prism provider.
    - **Readers made absence-safe:** `createModelIndex` (`configured` optional), `SessionContext.model` and `StoredAgentRunState.model` optional (the "Malformed agent run state" check no longer requires `model`), `initialAgentRunState`, `checkpointDurableTurn`/`suspendDurable`/`cleanupRun` (`model | undefined`, run record `provider` only when a model exists), structured-output assertion, `contextMeter` (`inputCap` omitted), `packages/context/engineering` (memo key `none`, attention compiler without `model`). `models.client`/`models.embeddings` already threw a `TypeError` on a missing model. `src/run-bundle.ts` and the fingerprint (`agent-run-state.ts:137`) already tolerate `undefined`. `compaction`/`observational` pass `session.model` to `resolveInputCap(undefined, …)` and typecheck as is. Tests that read `agent.config.model.*` use `?.`.
    - **Deviations from the plan text:** `src/agent/inspect.ts` and `src/models/registry.ts` needed no change (neither reads `config.model`; `tsc` reported nothing there). `ModelError` lives in `src/agent-session/` (Task 1 (a)). `run.model` is typed `ModelRef` (the raw `RunOptions.model` or the parsed agent spec).
    - **Tests (all pass):** new `src/__tests__/model-less-agent.test.ts` (6): `model_required_without_model_less_loop`, `model_less_loop_creates_agent`, `turn_without_model_fails_no_model`, `run_model_passthrough`, `run_model_none_fails_closed`, `unknown_run_model_mode_fails_creation`. Updated the controller-key lists (`run-controller.test.ts`, `hook-invariants.test.ts`) and the `run-controller.test.ts` fixture (it now passes a model). Affected suites: run-controller, hook-invariants, driver-primitives, durable-loops, model-ref, agent-definitions, create-agent-async, event-origin, public-export-contract, agent-surface-freeze; engineering 77 pass, compaction 43 pass.
    - **Checks:** `bun run typecheck` adds no new error (only the Task 1 `tools-web`/`tools-coding` failures remain). `bun test src` still fails the groups already on this tree: docs (6), MCP and Prism Code integration, `packaging` `npm ls`, hooks-json compile, and the skill-loading family (`agent-run-lifecycle` x3, `prefix-stability-conformance` x2, `progressive disclosure`), which I confirmed is not caused by the `createAgent` loop resolution (bypassing it leaves the same 5 failing). `packages/memory/observational` `tokens-fixtures` (35 vs 36) fails and is a tokenizer fixture, unrelated.
    - **Baseline diff:** none. `scripts/compat-baseline/*` records value exports only and this task adds types plus one internal class. `node scripts/release.mjs gate` stays red for the Task 1 `tools-coding` compat emit reason.
    - **Docs:** `docs/next/agent.md`, `docs/next/loop.md` ("Model-less loops and `run.model`"), `docs/next/models.md` ("Agents with no model"), `CHANGELOG.md`.
    - **Findings for later tasks:** (1) `createAgent` now resolves the `loop` slot eagerly, so a loop slot conflict fails at creation rather than at first run. (2) Plan 164's `defineDriver` must set `usesModel: false` and `runModel` on the `LoopStrategy` it returns. (3) A model-less durable run writes a run state with no `model`; `agentFingerprint` serializes it as absent, so changing a model-less agent to a modelled one changes the fingerprint (intended).

- [x] Task 6: K4 — session links, filters, and `createSessionIndex` on every store
  - Acceptance Criteria:
    - Functional: `SessionOptions.parent?: { sessionId?, agentId?, workflowRunId?, delegationId? }` is persisted when the session is created (ignored on resume of an existing session; a mismatch is not an error). `SessionSummary` gains `agentId?`, `parentSessionId?`, `workflowRunId?`, `actor?: { kind: "prism" | "external"; agent: string; vendor?: string }`. `SessionListQuery` and `SessionSearchQuery` gain the matching filters.
    - Functional: `createSessionIndex(store, { ownership })` returns `{ list(query), search(query) }` over a store without an `Agent`, with ownership enforced exactly as `agent.sessions` enforces it. A store lacking a capability rejects with `UnsupportedStoreCapabilityError`.
    - Functional: `storeConformance` gains a `session-links` leg (persist, list by each filter, search by each filter, ownership isolation, fork keeps the links). The kernel memory store, `@arnilo/prism-store-jsonl`, `@arnilo/prism-store-sqlite`, and `@arnilo/prism-store-postgres` pass it. SQL stores add nullable indexed columns through their migration path (Task 1 (g)); existing databases migrate forward without data loss.
    - Performance: A filtered list is an indexed query on SQL stores, and a capped linear scan on memory and JSONL (same caps as today). No new I/O on session open beyond one metadata write when `parent` is given.
    - Code Quality: Filters live on the existing query types; no parallel query API. The public `createSessionIndex(store, { ownership })` is the existing internal `createSessionIndex` (`src/agent/sessions.ts:25`) reshaped and exported, not a second implementation. Its callers (`src/agent-session/create-agent.ts:138`, `src/testing/store-conformance.ts:81`, `:395`) move to the new signature in this task.
    - Security: Ownership is unchanged: a filter never widens the scope. Link ids are opaque strings, validated for length.
  - Amended by Task 1 (2026-10-10):
    - SQLite has no sessions table (summary derived from `prism_session_entries`, `persistence.ts:1210`); Postgres has `prism_sessions` (`ddl.ts:51`). Postgres: nullable indexed columns via `migrations.ts`. SQLite/JSONL/memory: a first `metadata` entry written at session open that `summarizeSession` (`src/session-stores.ts:582`) reads. Add `SessionOptions.actor`; do not derive `actor`.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.9 K4; G5
      - `src/contracts-core/session.ts:73-107`, `:158`; `src/contracts-core/agent.ts:176-184`, `:241`; `src/agent/sessions.ts`; `src/testing/store-conformance.ts`
      - `packages/stores/{jsonl,sqlite,postgres,codecs}/src/`
    - Options Considered:
      - A separate links store. Rejected: §2.12.9 puts links in the session store, and search must join them.
      - Links only in session metadata for SQL stores. Rejected: filters would be unindexed scans.
    - Chosen Approach:
      - Extend the contract and the conformance leg, then each store in this task so `storeConformance` stays green everywhere.
    - API Notes and Examples:
      ```ts
      const child = await agent.session({ parent: { sessionId: parent.id, workflowRunId: "wf-1" } });
      const index = createSessionIndex(store, { ownership: { tenantId: "t" } });
      const page = await index.list({ workflowRunId: "wf-1" });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-core/session.ts`: fields and filters.
      - `src/agent/sessions.ts`: reshape `createSessionIndex` to `(store, { ownership })`, add the filters; `src/agent-session/create-agent.ts:138` caller.
      - the kernel memory store module: links and filters.
      - `src/testing/store-conformance.ts`: `session-links` leg.
      - `packages/stores/jsonl/src/jsonl-store.ts`, `packages/stores/sqlite/src/persistence.ts`, `packages/stores/postgres/src/{ddl,migrations,persistence}.ts`, `packages/stores/codecs/src/*` as needed, with each store's tests and README.
      - `src/index.ts`, export freeze tests; baselines for `arnilo__prism`, `arnilo__prism-store-*`, `arnilo__prism-store-codecs` regenerated; diff in the note.
      - `docs/next/agent.md`, `CHANGELOG.md`.
    - References:
      - plan 153 (store packages and conformance)
  - Test Cases to Write:
    - `store_conformance_session_links` on memory, JSONL, SQLite (`bun test`), Postgres (`bun run test:postgres:run`, recorded as skipped without `PRISM_POSTGRES_URL`).
    - `create_session_index_without_agent`: list and search through a bare store honor ownership.
    - `sqlite_migration_adds_link_columns`: a database created by the current schema opens and gains the columns; old rows list with absent links.
    - `parent_ignored_on_resume`: reopening with a different `parent` does not rewrite the link.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — session options, summaries, queries, and a new export.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: "Sessions" section — `parent`, filters, `createSessionIndex`.
      - `packages/stores/{jsonl,sqlite,postgres}/README.md`: link storage and migration note.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - What changed:
      - Contract (`src/contracts-core/session.ts`, `agent.ts`): `SessionOptions.parent` / `actor`, `SessionActor`, `SessionParentLink`, `SessionLinks`, `SessionLinkFilter` (`agentId`, `parentSessionId`, `workflowRunId`, `delegationId`, `actorKind`, `actorAgent`), the new `SessionSummary` fields, `MAX_SESSION_LINK_ID_LENGTH` (256), `SESSION_LINKS_DATA_KEY`, and `assertSessionLinks` / `assertSessionLinkFilter` (fail closed on a long or non-string id and on an unknown `actorKind`).
      - Storage shape: the links live in the session's first `metadata`-kind entry, `data: { links }`. **Not** in entry `metadata`: the JSONL validator requires object `data` on a `metadata` entry (`jsonl-store.ts` `case "metadata"`), and keeping the links in `data` leaves the ownership stamp in `metadata` untouched. `RuntimeAgentSession.openNewSession` writes it through `appendEntry`, so redaction and the ownership stamp apply. `agent.session({ id })` on an existing session writes nothing (`parent_ignored_on_resume`), and `fork` copies the entry with the branch.
      - Kernel: `sessionLinksOf`, `sessionLinksOfEntry`, `sessionLinksMatch`, `summaryLinkFields` in `src/session-stores.ts`; the memory store's `summarizeSession`, list, and linear search filter on them. `createSessionIndex(store | () => store, { ownership })` is the former internal factory reshaped and exported from `src/agent/sessions.ts`; the callers in `create-agent.ts` and `store-conformance.ts` moved with it.
      - JSONL: the links entry is a session's first line, so the two-line sample finds it; list filters on it, search reuses the memory matcher. No file-format change.
      - SQLite and Postgres: migration `010_session_links` (schema version 10) adds nullable `agent_id`, `workflow_run_id`, `delegation_id`, `actor_kind`, `actor_agent`, `actor_vendor` to `prism_sessions` plus five `prism_sessions_link_*_idx` indexes (`parent_session_id` already existed). `append` mirrors a links entry into the row inside the append transaction; list and search filter on the columns. The step is registered in the shared contract (`src/testing/persistence-schema.ts`); the `001_init` checksum content strips the new columns and indexes so existing databases keep their recorded checksum. Shared helpers (`SESSION_LINK_COLUMN_NAMES`, `sessionLinkColumns`, `sessionLinkFilterColumns`, `sessionLinkSummaryFields`) live in `@arnilo/prism-store-codecs`.
      - `storeConformance` gains the `session-links` leg (list and search by each filter, a combined filter, no match, summary fields, absent links, `get`, limit and `actorKind` rejection, cross-tenant isolation, a fork-style copy). Tests added: `src/__tests__/session-links.test.ts` (persist, `parent_ignored_on_resume`, fork, validation, `create_session_index_without_agent`) and `sqlite_migration_adds_link_columns`.
    - Findings that affect later tasks:
      - **Task 1 (g) was wrong about SQLite:** it does have `prism_sessions` (`ddl.ts:43`) with `parent_session_id` and a `metadata` column. Both SQL stores took the same column approach; there was no scan.
      - SQL stores scope `searchSessions` by the session row's `tenant_id` / `account_id` / `user_id`, which an entry-only `append` never fills (listing scopes by entry metadata). The `session-links` search checks therefore run unscoped, over link values unique to the run, and the scoped isolation check runs through `listSessions`. This predates the task. Worth a Further Actions line: scoped `searchSessions` on SQL stores returns nothing for sessions written through `append` alone.
      - Task 7 adds an entry kind, so it also touches `persistence-schema.ts` and needs migration `011` if SQLite's `kind` column has a CHECK; the `010` registration (`migrationStep`, `ddl.ts`, `migrations.ts`, `ADAPTER_INDEX_NAMES`, the Postgres DDL test, `drill-migration-rollback.mjs`, the docs `Schema version` strings and `docs.test.ts`) is the full list of places a new step touches.
      - `summary.agentId` is `parent.agentId` (the roadmap's only source for it), not the opening agent's id.
    - Baseline diff (`node scripts/release.mjs gate --update-baseline`, `arnilo__prism*` files only; the gate then stops at the known `tools-coding` compat failure):
      - `arnilo__prism.txt`: added `MAX_SESSION_LINK_ID_LENGTH`, `assertSessionLinkFilter`, `assertSessionLinks`, `createSessionIndex`, `summaryLinkFields`, `SESSION_LINKS_DATA_KEY`, `sessionLinksMatch`, `sessionLinksOf`, `sessionLinksOfEntry`; changed `STORE_CONFORMANCE_STEPS` (adds `session-links`). The new and changed types do not appear as baseline lines. No removals attributed to this task.
      - `arnilo__prism-store-sqlite.txt`: added `MIGRATION_010_SESSION_LINKS`. `arnilo__prism-store-postgres.txt`: added `buildMigration010Ddl`. `arnilo__prism-store-codecs.txt`: added `SESSION_LINK_COLUMN_NAMES`, `sessionLinkColumns`, `sessionLinkFilterColumns`, `sessionLinkSummaryFields`. `arnilo__prism-store-jsonl.txt`: unchanged.
    - Checks:
      - `bun run typecheck`: only the two known baseline failures (`tools-web`, `tools-coding`).
      - Stores: jsonl 42 pass; sqlite 37 pass, 1 fail (the known Bun-runtime import test); postgres 12 pass, 37 skipped (no `PRISM_POSTGRES_URL`, so the Postgres SQL in `append`, list, and search is typechecked and unit-tested for DDL only, **not run against a server**); codecs 6 pass.
      - Kernel `bun test src`: no failure beyond the baseline list. Two baseline failures now pass (the SQL-adapter docs check and the root export freeze, after updating the frozen value list and the docs `Schema version` strings).
    - Sweep: no name was retired. `createSessionIndex` had two internal callers, both moved.

- [x] Task 7: K5 — `external_state` entries and `run.state(key)`
  - Acceptance Criteria:
    - Functional: `SessionEntryKind` gains `"external_state"` with data `{ vendor, key, seq, data }`. `RunController.state(key)` returns `{ append(entries: readonly JsonValue[]): Promise<void>; load(): Promise<readonly JsonValue[]> }`, where `vendor` is the loop's name, and `seq` increases per key.
    - Functional: Entries are bounded by `external_state_limit` (Task 1 (h)); exceeding it rejects with `external_state_limit`. Data passes the redactor. `session.messages()` excludes them. `session.fork()` copies them. Deleting the session deletes them.
    - Functional: `storeConformance` gains an `external-state` leg; memory, JSONL, SQLite, and Postgres pass it. JSONL's kind switch accepts the kind.
    - Performance: `append` is one store write per call (entries batched in one record per call, within the limit). `load` reads the session branch once.
    - Code Quality: Follows the `package_state` precedent (`src/session/state.ts`); no new store method.
    - Security: Redaction runs before persistence. Data never appears in events or `inspect()`.
  - Amended by Task 1 (2026-10-10):
    - Explain in the task note why `package_state` with `op: "append"` (`src/session/state.ts`, `SessionLog`) is insufficient (messages exclusion, per-key count/byte caps). Add `MAX_EXTERNAL_STATE_ENTRIES` (10 000 per key) and a per-key byte cap (8 MiB) beside the 64 KiB per-entry cap. Every store rejects the unknown kind until updated (`isSessionEntryKind`); read the SQLite `kind` DDL before choosing the migration.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.12.9 K5; G9
      - `src/contracts-core/session.ts:10-31`; `src/session/state.ts`; `packages/stores/jsonl/src/jsonl-store.ts:496-548`; `src/testing/store-conformance.ts`
    - Options Considered:
      - Reuse `package_state`. Rejected: package state is last-value per key, while vendor archives are append-only logs with a sequence.
      - A side-car file per vendor. Rejected: G9 requires the state in Prism's store.
    - Chosen Approach:
      - A new entry kind with a small state handle on the controller, mirroring `package_state`.
    - API Notes and Examples:
      ```ts
      await run.state("transcript").append([{ line: 1, text: "…" }]);
      const archived = await run.state("transcript").load();
      ```
    - Files to Create/Edit:
      - `src/contracts-core/session.ts`, `src/loop/types.ts`, `src/loop/run-controller.ts`, `src/session/` (a new `external-state.ts` beside `state.ts`), the messages projection and fork path.
      - `src/testing/store-conformance.ts`: `external-state` leg.
      - `packages/stores/{jsonl,sqlite,postgres,codecs}/src/*` as needed, with tests.
      - baselines regenerated (`arnilo__prism`, any store baseline that changes); diff in the note.
      - `docs/next/loop.md`, `docs/next/agent.md`, `CHANGELOG.md`.
    - References:
      - plan 146 Task 6 (`package_state`)
  - Test Cases to Write:
    - `external_state_round_trip`: append, load, `seq` order.
    - `external_state_excluded_from_messages`.
    - `external_state_copied_on_fork_and_deleted_with_session`.
    - `external_state_limit_rejects`.
    - `external_state_redacted`: a secret string in `data` is masked in the stored entry.
    - `store_conformance_external_state` on all four stores.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new entry kind and primitive.
    - Docs pages to create/edit:
      - `docs/next/loop.md`: `run.state(key)`.
      - `docs/next/agent.md`: entry kinds list.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - What changed:
      - `SessionEntryKind` / `SESSION_ENTRY_KINDS` gain `external_state` (`src/contracts-core/session.ts`). New `src/session/external-state.ts`: `ExternalStateData` (`{ vendor, key, seq, data }`), `ExternalStateHandle`, `createExternalState`, `MAX_EXTERNAL_STATE_ENTRIES` (10 000), `MAX_EXTERNAL_STATE_BYTES` (8 MiB), `MAX_EXTERNAL_STATE_ENTRY_BYTES` (64 KiB, the `package_state` bound). `PackageLoadErrorCode` gains `external_state_limit`.
      - `RunController.state(key)` (`src/loop/types.ts`, `run-controller.ts`). `vendor` is the running loop's `name` (not the slot owner, which is `host` for a host-supplied loop). `RuntimeAgentSession.externalState(vendor, key)` does the write inside the session's append queue: it reads the branch, checks the caps, and appends one entry, so two overlapping appends cannot both pass the caps. `load()` reads the branch once.
      - One record per `append` call; `seq` counts records per key (1, 2, ...), `data` is the batch. The caps count entries and JSON bytes across the key's records. Each entry is redacted before it is measured, and `appendNow` redacts the whole entry again.
      - JSONL `validateSessionEntry` accepts the kind (object `data`). `storeConformance` gains the `external-state` leg (entries preserved in order, part of the branch path).
    - Why `package_state` with `op: "append"` is insufficient: that log is owned by a package, shares its kind with values that tools and the observational fold read, and has no per-key entry or byte cap. An archive needs its own caps and a kind no message projection or fold sees.
    - Findings that affect later tasks:
      - **No SQL migration.** SQLite and Postgres declare `kind TEXT NOT NULL` with no CHECK (`ddl.ts`), so both stores accept the kind unchanged. Task 7's "migration `011`" branch did not apply. The SQLite conformance run passes the new leg.
      - `fork()` copies the kind with no change, because it copies every branch entry except `suspended_run`. `messages()` ignores the kind because it projects `message` entries only.
      - `RunController` has a new key `state`; `run_controller_exposes_only_primitives` (two tests) now lists it. `SessionHost` gains `externalState`.
      - The constants are not re-exported from the root, so the frozen value list is unchanged; only the two types join `FROZEN_TYPE_EXPORTS`.
    - Baseline diff (`node scripts/release.mjs gate --update-baseline`; the gate then stops at the known `tools-coding` compat failure):
      - `arnilo__prism.txt` gains `ExternalStateData`, `ExternalStateHandle`, `createExternalState`, `MAX_EXTERNAL_STATE_BYTES`, `MAX_EXTERNAL_STATE_ENTRIES`, `MAX_EXTERNAL_STATE_ENTRY_BYTES`, and a changed `STORE_CONFORMANCE_STEPS` (adds `external-state`). The same regeneration rewrote many other lines in this file and in other `arnilo__prism-*` baselines (the tree carries about 2 500 uncommitted paths from earlier tasks); none of them is attributed to this task.
    - Checks:
      - `bun run typecheck`: only the two known baseline failures (`tools-web`, `tools-coding`).
      - New tests (`src/__tests__/external-state.test.ts`, 6 pass): `external_state_round_trip`, `external_state_excluded_from_messages`, `external_state_copied_on_fork_and_deleted_with_session`, `external_state_limit_rejects`, `external_state_redacted`, `external_state_rejects_non_json`.
      - Stores: jsonl 42 pass; sqlite 37 pass, 1 fail (the known Bun-runtime import test); postgres 12 pass, 37 skipped (no `PRISM_POSTGRES_URL`, so the Postgres leg was **not run against a server**).
      - Kernel suites: no new failure. Remaining failures are the baseline ones plus unrelated mid-migration docs checks (broken `docs/multi-agent-patterns.md` link, missing `packages/memory`, `core-boundaries` "workflow" in `src/contracts.ts`, and so on).
    - Sweep: no name was retired.

- [x] Task 8: K6 — the `terminal` host request and Part A close
  - Acceptance Criteria:
    - Functional: `HostUiTerminalRequest { kind: "terminal"; title: string; command: readonly string[]; env?: Readonly<Record<string, string>>; cwd?: string }` joins `HostUiRequest`; `HostUiAnswerMap.terminal` is `{ readonly exitCode: number }`. Responses are `answered`, `dismissed`, or `unavailable`. A package without the `host-ui` capability is refused, as for other kinds.
    - Functional: `createScriptedHostUi` scripts `terminal` (a value, `dismissed`, `unavailable`, or a function of the request) and records it in `requestsOf("terminal")`.
    - Functional: Every in-repo `HostUi` implementer (Task 1 (i)) handles `terminal`; each answers `unavailable` unless Task 1 (i) chose otherwise. `bun run typecheck` stays green.
    - Functional: The kernel and the requesting package never see the terminal's input or output: the answer type has only `exitCode`, and a test asserts no other field is forwarded even when a host returns extra fields.
    - Functional: Part A close: the task note lists each K1–K6 contract as shipped (signature, test names, doc section) for plan 164's entry check, and confirms `loopConformance` and `storeConformance` legs are green from the default loop and from a driver-shaped loop.
    - Performance: n/a — a new request kind; no cost unless requested.
    - Code Quality: One request interface and one answer-map entry; implementers use their existing `switch`.
    - Security: `env` values are documented as non-secret paths; the kernel rejects an `env` value that is a credential ref (`env:`/`keyring:` prefix) with `terminal_env_secret`. Command strings are untrusted package text that a host shows, not shell-interprets.
  - Amended by Task 1 (2026-10-10):
    - Only ACP (`host.ts:31`), MCP server (`host.ts:26`), and the lab TUI (`tui/index.ts:1128-1153`) implement `HostUi`; `approval` and coding `ask_user` only call it. The three implementers cast `request as HostUi["request"]`, so the typecheck will not flag a missing case: test `unavailable` at runtime for each. Drop the approval and coding adapters from the file list unless a `switch` on `kind` is found.
  - Approach:
    - Documentation Reviewed:
      - roadmap §2.3, §2.12.9 K6; G10
      - `src/host/types.ts:56-105`; `src/testing/host-ui.ts`; the implementers listed in Task 1
    - Options Considered:
      - Model sign-in as `open-url`. Rejected: vendor logins are interactive commands, and some print a device code in the terminal.
      - Return captured output. Rejected: the roadmap forbids the kernel seeing terminal I/O.
    - Chosen Approach:
      - Add the kind, the scripted support, and fail-closed answers in every implementer.
    - API Notes and Examples:
      ```ts
      const answer = await prism.host.ui.request({ kind: "terminal", title: "Sign in", command: ["vendor-cli", "login"], env: { VENDOR_HOME: profileDir } });
      if (answer.status !== "answered" || answer.value.exitCode !== 0) throw new Error("auth_required");
      ```
    - Files to Create/Edit:
      - `src/host/types.ts`, the kernel `host.ui` stamping path, `src/testing/host-ui.ts`.
      - `packages/hosts/acp/src/host.ts`, `packages/hosts/mcp-server/src/host.ts`, `packages/policy/approval/src/index.ts`, `packages/tools/coding/src/ask-user-host.ts`, `packages/prism-code/src/tui/index.ts` (and any implementer the Task 1 count adds).
      - export freeze tests; `arnilo__prism` and affected host baselines regenerated; diff in the note.
      - `docs/next/host.md`, `docs/next/testing.md`, `CHANGELOG.md`.
    - References:
      - plan 148 Task 2 (`HostUi` request kinds)
  - Test Cases to Write:
    - `terminal_request_round_trip`: scripted `{ exitCode: 0 }` reaches the package; `dismissed`/`unavailable` pass through.
    - `terminal_requires_host_ui_capability`.
    - `terminal_answer_forwards_only_exit_code`.
    - `terminal_env_rejects_credential_ref`.
    - one test per host implementer asserting `unavailable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new host request kind.
    - Docs pages to create/edit:
      - `docs/next/host.md`: `terminal` kind, responses, the no-I/O guarantee, `env` rule.
      - `docs/next/testing.md`: scripting `terminal`.
      - `packages/hosts/acp/README.md`, `packages/hosts/mcp-server/README.md`: `terminal` answers `unavailable`.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-10):
    - What changed:
      - `HostUiTerminalRequest` (`src/host/types.ts`) joins `HostUiRequest`; `HostUiAnswerMap.terminal` is `{ readonly exitCode: number }`; root type export added (`src/host/index.ts`, `src/index.ts`, frozen type list in `public-export-contract.test.ts`). `PackageLoadErrorCode` gains `terminal_env_secret`.
      - The `host.ui` wrapper in `src/packages/loader.ts` (`hostFor`) rejects an `env` value that is not a string or starts `env:`/`keyring:` with `terminal_env_secret` before the host is asked, and rebuilds an `answered` terminal response as `{ exitCode }` only (a non-integer or missing `exitCode` becomes `unavailable`). The `host-ui` capability check already ran first for every kind.
      - `createScriptedHostUi` needed no code change (a `{ exitCode }` value, `dismissed`, `unavailable`, or a function already work); it is documented.
      - Implementers: ACP gets an explicit `terminal` → `unavailable` (before this it would have fallen through to `bound.elicit` with an unknown kind); the MCP server already answered `unavailable` for anything but confirm/select/input; the lab TUI's fallthrough already answered `unavailable` (comment updated). `approval` and coding `ask_user` only call `HostUi` and have no `switch` on `kind`: no change (Task 1 amendment held).
      - Docs: `docs/next/host.md` (Terminal section), `docs/next/testing.md`, ACP and MCP-server READMEs, `CHANGELOG.md`.
    - Tests: `src/__tests__/host-ui.test.ts` (`terminal_request_round_trip`, `terminal_requires_host_ui_capability`, `terminal_answer_forwards_only_exit_code`, `terminal_env_rejects_credential_ref`; the kinds catalog test now lists seven kinds); `acp_host_terminal_answers_unavailable` (host.test.ts, bound elicitation-capable session, asserts elicit is never called); `mcp_host_routes_and_fails_closed` extended (unbound and bound session); TUI case added to the select test in `prism-code/src/__tests__/approval.test.ts`.
    - Baseline diff (`node scripts/release.mjs gate --update-baseline`): the gate stops at the known `tools-coding` compat failure; `HostUiTerminalRequest` is a type and adds no baseline line. No removals attributed to this task.
    - Checks: `bun run typecheck` shows only the two known baseline failures (`tools-web`, `tools-coding`). `host-ui`, `public-export-contract`, `agent-surface-freeze`, `package-conformance` pass (123); acp 41, mcp-server 23, approval 9 pass; prism-code `approval.test.ts` 9 pass. `docs.test.ts` fails 6 tests (broken links and old-docs checks; none touches host/terminal); `core-boundaries` has 1 failure ("provider resolver contract has no domain vocabulary"), both in the Task 1 baseline class.
    - Sweep: no name was retired.
    - **Part A close (for plan 164's entry check).** All of K1–K6 are shipped; docs are staged in `docs/next/`.
      - K1 (Task 5): `AgentConfig.model?`, `LoopStrategy.usesModel?: false` / `runModel?: "passthrough" | "none"`, `RunController.model`; errors `model_required`, `no_model`, `run_model_unsupported`, `invalid_run_model_mode`. Docs `docs/next/agent.md`, `docs/next/loop.md`.
      - K2 (Tasks 3–4): `emit(name, data)`, re-entrant `executeTools(calls, { concurrency?, origin? })` returning `ToolResult[]`, `observe(activity)`, `ask(request, { rewrite?, respond? })`, `steers()`, `end()` returning `{ continue, reason? }`; tests in `driver-primitives.test.ts`, `hook-invariants.test.ts`. Docs `docs/next/loop.md`, `docs/next/hooks.md`, `docs/next/events.md`.
      - K3 (Task 2): `EventOrigin` on `AgentEvent` and `ToolCallHookPayload`; `child` deleted; `event-origin.test.ts`. Docs `docs/next/events.md`.
      - K4 (Task 6): `SessionOptions.parent` / `actor`, summary link fields, list/search link filters, `createSessionIndex`; migration `010_session_links`; `session-links` conformance leg; `session-index.test.ts`. Docs `docs/next/agent.md`.
      - K5 (Task 7): `external_state` entries, `RunController.state(key)`, `external_state_limit`; `external-state.test.ts` (6 tests); `external-state` conformance leg. Docs `docs/next/loop.md`, `docs/next/agent.md`.
      - K6 (this task): the `terminal` request above. Docs `docs/next/host.md`, `docs/next/testing.md`.
      - Conformance: `storeConformance` (memory, JSONL, SQLite pass; Postgres typechecks and unit-tests DDL only, **not run against a server**) and `loopConformance`/`package-conformance` pass for the default loop and for the driver-shaped loops in `driver-primitives.test.ts` and `external-state.test.ts`. Re-run both in plan 164's entry check.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/hook-invariants.test.ts src/__tests__/hook-catalog-coverage.test.ts src/__tests__/conformance-helpers.test.ts src/__tests__/package-conformance.test.ts src/__tests__/ask-resolution.test.ts src/__tests__/host-ui.test.ts src/__tests__/session-index.test.ts`
- `bun test --timeout=0 src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/agent-surface-freeze.test.ts src/__tests__/packaging.test.ts src/__tests__/core-boundaries.test.ts`
- `cd packages/stores/jsonl && bun run typecheck && bun run test`
- `cd packages/stores/sqlite && bun run typecheck && bun run test`
- `cd packages/stores/postgres && bun run typecheck && bun run test` (and `bun run test:postgres:run` with `PRISM_POSTGRES_URL`, else recorded as skipped)
- `cd packages/hosts/acp && bun run test`; `cd packages/hosts/mcp-server && bun run test`; `cd packages/policy/approval && bun run test`; `cd packages/tools/coding && bun run test`
- `cd packages/prism-code && bun run build && bun run test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `node scripts/release.mjs gate`
- `rg -n 'ChildEventOrigin|\bchild\?: ' src packages scripts examples docs -g '!**/dist/**' -g '!**/node_modules/**' -g '!docs/history/**' -g '!docs/_evidence/**'` (no hits outside released `/docs`)

## Compromises Made

- Postgres SQL for K4/K5 (`append`, list, search, `external-state` leg) was never run against a server (`PRISM_POSTGRES_URL` unset); only DDL and typechecks ran.
- The gate's compat step stayed red for the whole plan because of the pre-existing `tools-coding`/`tools-web` failures; baselines were regenerated per task and only `arnilo__prism*` diffs were attributed.
- K6 ships no real terminal: ACP, MCP server, and the lab TUI answer `unavailable`.

## Further Actions

- Medium: run the Postgres legs with `PRISM_POSTGRES_URL` before release (K4 links, K5 `external_state`).
- Medium: fix the `tools-coding`/`tools-web` typecheck failures so `node scripts/release.mjs gate` can go green.
- Low: scoped `searchSessions` on SQL stores returns nothing for sessions written through `append` alone (session row `tenant_id`/`account_id`/`user_id` never filled); predates this plan.
- Low: Phase 12 reference host implements `terminal` (PTY) for the Prism Code TUI.
