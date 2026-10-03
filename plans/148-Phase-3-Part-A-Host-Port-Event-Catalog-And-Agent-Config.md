# Phase 3 Part A — Host port, event catalog, principal, and agent config

## Objectives

- Run the Phase 3 review for both parts. It inventories every host-facing contract §2.3 names against the code that landed in plans 144–147, and fixes the open decisions before any code changes.
- Finish the host port. `HostUi` carries the six §2.3 request kinds with their final fields. `unavailable` has one documented meaning and a test harness, so packages and the kernel ask path fail closed on it.
- Freeze the `AgentEvent` catalog under the §2.3 dotted names. Every observe hook name equals its event type, and every 0.12 snake_case event is renamed, folded, or removed with no alias.
- Replace `identity` with an opaque, optional `principal`. No kernel path synthesizes an identity.
- Reshape the `AgentConfig` tool and skill inputs and the `RunOptions` tool scope to §2.3: `tools.add`, `skills.{dirs, add, disclosure}`, and `RunOptions.tools.only`. Move the kernel skills catalog onto a named `kernel:context.build` registration.

## Expected Outcome

- `HostUiRequest` is the §2.3 union:
  - `confirm { title, detail? }`
  - `select { title, options, multiple? }`
  - `input { title, placeholder? }`
  - `secret { title, ref }`: the answer goes to the credentials slot and never back to the package
  - `open-url { title, url }`
  - `notify { level, message }`
- Every request is stamped with `{ package, sessionId? }` by the kernel.
- A host without `ui` answers `unavailable`. The kernel `ask` path suspends on `unavailable` and on a non-interactive run.
- `@arnilo/prism/testing` exports a scripted `HostUi` that can answer, dismiss, or return `unavailable` per request kind.
- `AgentEvent["type"]` is the frozen catalog. `src/__tests__/hook-catalog-freeze.test.ts` pins it, and `docs/next/events.md` documents it. No snake_case event type survives in `src/`, `packages/`, `examples/`, or `scripts/` outside the sweep exclusions.
- `AgentConfig.principal` and `RunOptions.principal` are an opaque `Principal`, and the kernel never reads one. `AgentConfig.identity`, `RunOptions.identity`, and the agent SDK's `"local-operator"` profile are deleted.
- `AgentConfig.tools` is `{ add?: ToolDefinition[] }` and `AgentConfig.skills` is `{ dirs?, add?, disclosure? }`. `RunOptions.tools` is `{ only?: string[] }`. The 0.12 `ToolRegistry`/`SkillRegistry` inputs, `skillsDisclosure`, `activateAllSkills`, and `RunOptions.toolNames` are deleted.
- `docs/next/host.md`, `docs/next/events.md`, and the config sections of `docs/next/agent.md` exist in the API page structure.

This plan is Part A of roadmap **Phase 3 — Agent, session, and host port**. Phases 0–2 are complete (plans 143–147), and the hook catalog, slot contracts, and `PackageAPI` are frozen. Task 1 is the phase review. It is required because this phase changes kernel contracts: the host API, the event catalog (which is also the observe-hook catalog), `AgentConfig`, `RunOptions`, `RunResult`, and the `Agent`/`Session` shape.

[Part B (plan 149)](149-Phase-3-Part-B-Agent-And-Session-Surface.md) reshapes `Agent` and `Session` (`agent.session()` over the store slot, `RunResult`, `session.resume(decisions)`, `agent.sessions`/`models`/`commands`/`subscribe`). It also makes `@arnilo/prism` the one import, stops feature work on `@arnilo/prism-agent-sdk`, and ships the three phase examples. Part A comes first because Part B's `run.*`, `decision.*`, and `session.*` events need the frozen catalog.

The phase is split because the two halves each sweep more than 150 caller files. The event rename touches about 80 files. `createSession(` appears in 181 files, `tools: [` in 173, and `store:` in 224.

`model` stays `ModelConfig` until Phase 5, which owns `ModelRef` and the model layer (§2.1 Models). Config fields owned by modules that later phases move out (`attentionCompiler`, `contextBudget`, `toolResultFold`, `costCatalog`, `runLedger`, `effectStore`, `ownership`, `runState`, and the rest) stay until the phase that moves the module. Task 1 records the owning phase for each one.

Lab impact (probe 12): no `packages/prism-code` module becomes deletable in this phase. Its callers migrate in each task. Its approval engine waits for Phase 7 (`@arnilo/prism-approval`), its session policy for Phase 6, and its headless assembler and OAuth/credential prompts for Phase 12, which answers `host.ui` from the TUI.

This plan does not ship a version bump, a publish, a `/docs` change, the manifest (Phase 4), or `ModelRef` (Phase 5).

## Tasks

- [x] Task 1: Phase 3 review — host-facing contracts against the code (read-only)
  - Acceptance Criteria:
    - Functional: The Notes inventory every contract Phase 3 touches, citing `roadmap.md` and the current code at `file:line`:
      - `createAgent` and `AgentConfig` (§2.3; `src/agent-session/create-agent.ts:26`, `src/contracts-core/agent.ts:53`)
      - `Agent` (`src/contracts-core/agent.ts:153`) against §2.3: `id`, `session()`, `sessions`, `commands`, `models`, `tools`, `skills`, `inspect()`, `subscribe()`, `dispose()`
      - `AgentSession` (`src/contracts-run-state.ts:429`) against §2.3 `Session`: `run`, `stream`, `steer`, `abort`, `resume`, `messages`, `fork`, `compact`, `close`
      - `RunOptions` (`src/contracts-protocol.ts:79`) and `AgentRunResult` (`src/contracts-run-state.ts:366`) against §2.3 `RunOptions`/`RunResult`
      - `HostPort`/`HostUi` (`src/host/types.ts`) against §2.3
      - `AgentEventPayload` (`src/contracts-protocol.ts:207`) and the observe catalog (`src/hooks/catalog.ts:8`) against the §2.3 Events list
      - suspension: `suspended_run` (`src/suspended-run.ts`), `resumeDurable` (`src/agent-session/session.ts:648`), and `resolveRunDecisions` (`src/agent-approval.ts:141`)
      - the store slot: `AgentConfig.store` is still the session store input (`src/agent-session/session.ts:450`), and the `store` slot default (`src/slots/defaults.ts:26`) is never resolved for sessions
      - limits: `RunLimits` (`src/contracts-core/run-limits.ts:11`) and the narrowing in `src/run-limits.ts`
      - identity: `AgentIdentity`/`Principal` (`src/identity.ts:4,15`), `resolveRunIdentity` (`src/identity.ts:264`) read at `src/agent-session/session/assemble.ts:659`, and the agent SDK's synthesis (`packages/agent-sdk/src/define-agent.ts:170`)
    - Functional: Classify each Phase 3 Scope bullet as *expressible with what exists* or *needs a kernel addition*. For each addition, record the kind, payload, result, error policy, and the primitive or lifecycle step that fires it.
    - Functional: Write the **event mapping table**: every current `AgentEventPayload["type"]` (the 45 in `src/hooks/catalog.ts:8-54`) → its §2.3 name, *folded into* a named catalog event (with the field that carries it), or *removed* (with the reason). The proposed defaults are in Task 3's approach. **Stop rule:** if an event has no §2.3 home and the kernel must keep emitting it, record it as a roadmap conflict and stop. Candidates are `retry_scheduled` (retry is kernel, §2.1 Models), `queue_updated` and `steer_rejected` (steer is kernel), `run_limit_exceeded` and `budget_exhausted` (the safety floor), and `event_subscriber_overflow`. Task 3 does not start until the user amends the §2.3 Events list or accepts a fold. Do not invent a catalog name inside Task 3.
    - Functional: Confirm or refute each of these assumptions:
      - (a) Stored `event` entries: the run ledger (`src/run-ledger.ts:36`) and session `event` entries persist `AgentEvent` objects, so renaming the types changes what readers see in old stores. Name every reader that switches on a persisted event type: Prism Code session resume, `examples/conversation-durable-replay.ts`, and run bundles. Decide between failing closed on an unknown stored type and skipping it, with no alias. The default is to skip it in projections and fail closed in the durable-resume path.
      - (b) Events from modules that later phases move out (`artifact_*`, `attention_compiled`, `guardrail_decision`, `delegated_agent_step`, `tool_narrowing_clamped`, `deterministic_turn`): decide for each whether it is removed now (its mechanism already retired in plans 144–147) or emitted as `package.event` under the owning module's name until its phase moves it. Cite the emit site of each.
      - (c) `HostUi` drift from §2.3 (`src/host/types.ts`): `secret` has no `ref`, `notify` has `title`/`detail` instead of `level`/`message`, `open-url` has no `title`, and `select` has no `multiple`. List every caller of each kind (`graft grep "kind: \"secret\""` and the others), including Prism Code `oauth.ts`/`credentials.ts`. Confirm that only `confirm` is used on a kernel path.
      - (d) §2.4 says an `ask` resolves inline only "if a `HostUi` is present and the run is interactive". `resolveAskDecisions` (`src/agent-session/session/assemble.ts:113-133`) checks for `ui` only. Name the signal that marks a run non-interactive. The default is `RunOptions.interactive?: false`, with `stream`/`run` interactive by default when `ui` exists. Confirm that a headless host (ACP, AG-UI, a server) can request suspension without dropping its `ui`.
      - (e) `secret` answers: the roadmap says the host stores the value through the credentials slot and it is never returned to the package. `HostUiAnswerMap.secret` is `string` (`src/host/types.ts:64`). Decide where the write happens. The default: the kernel's `host.ui` wrapper (`src/packages/loader.ts:333-344`) forwards the request and, on `answered`, stores the value through a `CredentialResolver` write seam (or refuses with `unavailable` when the resolved slot cannot store). It returns `{ status: "answered", value: undefined }` to the package. Record whether `CredentialResolver` (`src/contracts-core/resources.ts:42`) needs an optional `store(ref, value)` member, and who owns it (the credentials slot, §2.5).
      - (f) `identity` → `principal`: list every kernel read of `identity` (`assemble.ts:659,684`, `tool-round.ts:56,109,410,418`, `ownershipFromIdentity`), every package reader (`packages/prism-core` governance, workflows, evals), and `createSecureAgent` (`src/secure-agent.ts`). Confirm that the kernel can drop every read: ownership still comes from `AgentConfig.ownership` until the persistence phase moves it, and the `tool-round.ts` decision-scope identity becomes the opaque `principal.id`. Confirm that `createSecureAgent` can verify `SecureAgentOptions.identity` at creation and pass it on as `principal`, as a non-kernel module until Phase 9 moves it to `@arnilo/prism-governance`.
      - (g) `AgentConfig.tools`/`skills`: count the callers that pass a `ToolRegistry` or `SkillRegistry` rather than an array (`graft callers createToolRegistry --depth all`, and the same for `createSkillRegistry`). Confirm that `tools: { add }` and `skills: { add, dirs }` cover them. `skills.dirs` must reuse the `skills.addDir` reader (`src/agent-session/create-agent.ts:22`).
      - (h) Kernel skills catalog: the backlog item "Decide the kernel skills catalog's owner" deferred its move to Phase 3. Confirm that a `kernel:context.build` registration at the documented priority keeps the prefix-stability conformance (`src/testing/prefix-stability-conformance.ts`) byte-identical, or record the expected byte change.
      - (i) `RunOptions.toolNames` (30 files) → `tools.only`. Confirm that the `selectRunTools` resume intersection (`src/agent-session/session/assemble.ts:270`) and the checkpointed `toolNames` in `StoredAgentRunState` keep their semantics under the new name. Decide whether the stored field is renamed. The default is to rename it, since the suspended-run fingerprint already fails closed on drift.
      - (j) `agent-sdk` dependents: Prism Code imports `@arnilo/prism-agent-sdk` in 8 source files. Confirm that Part B's "stops receiving features" means the package keeps compiling against the reshaped kernel, its kernel-behavior tests move to `src/__tests__`, and it is not deleted until Phase 12 removes its last caller. List each test file in `packages/agent-sdk/src/__tests__/` with its destination (kernel suite, package suite, or stays).
      - (k) Part B inputs: for `RunResult`, decide whether `failed`/`aborted` runs return instead of throwing `AgentRunError` (24 files reference it), and map the current statuses (`succeeded | failed | aborted | suspended | denied`, `src/contracts-run-state.ts:27`) to §2.3 (`completed | stopped | suspended | failed | aborted`). For `Session`, decide which members outside §2.3 stay as documented kernel members and which are deleted: `prompt`, `clone`, `entries`, `checkout`, `contextMeter`, `subscribe`, `leafId`, and `guardrailPackRefs`, with Prism Code's usage (`checkout`, `contextMeter`) cited. For `Agent`, decide whether the public `config` member is removed (backlog "Move the remaining readers of `agent.config.tools` / `skills` onto the merged view"). For `agent.sessions`, list the store capabilities it needs: today `SessionStore` (`src/contracts-core/session.ts:58`) has no session list or delete. For `agent.models`, `AIProvider` has no `models()` discovery (`src/contracts-core/provider.ts:74`).
      - (l) `RunLimits` vs the §2.3 `Limits`: confirm that the narrow-only floor holds for `AgentConfig.limits` and `RunOptions.limits`, and record the name decision. The default keeps `RunLimits`, because Phase 11's export-surface review owns 1.0 naming and the rename would churn the released 0.12 surface for no behavior.
    - Functional: Record a verdict in the Notes. If a finding invalidates a later task in this plan or in plan 149, stop and re-cut. Never improvise a seam inside a later task.
    - Performance: n/a — read-only.
    - Code Quality: Every finding cites `file:line`, and every classification cites the roadmap section.
    - Security: List every place a host-facing value crosses a trust boundary: `host.ui` requests (package-set text shown to a person), `secret` answers, `principal` (host-supplied and opaque), events and stored event entries, `inspect()`, and `RunResult.error`. For each one, name the redaction or fail-closed check that Tasks 2–5 and plan 149 must test.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §1.4, §2.1, §2.3, §2.4 (the `ask` resolution), §2.5, §2.6, Phase 3, and Part 3 In-flight work
      - `PRODUCT.md`
      - plan 144 Task 1(h) (the event name table), plan 146 Task 1 Notes (corrected `session.*` names, A1 `SessionContext`), plan 147 Task 6 Notes (the `PackageAPI` freeze)
      - `plans/backlog.md` items naming Phase 3: the skills catalog owner, the `search_tools` gap, `session.opened` timing, and re-keying `inspect().hooks`
    - Options Considered:
      - Skip the review because Phases 1–2 froze the hook and package contracts. Rejected: the survey already found five facts that change later tasks. The store slot is never resolved for sessions. `HostUi` has drifted from §2.3. Eleven current events have no §2.3 home. Persisted event entries carry the old names. Prism Code still depends on the agent SDK.
    - Chosen Approach:
      - Run graft per contract (`graft ask`, `graft callers --depth all`, `graft grep` for each event literal), then write the inventory, the event mapping table, the classifications, and the verdict into this task's Notes.
    - API Notes and Examples:
      ```bash
      graft callers createSession --depth all
      graft grep "\"tool_execution_finished\""
      graft grep "kind: \"secret\""
      graft callers resolveRunIdentity --depth all
      ```
    - Files to Create/Edit:
      - `plans/148-Phase-3-Part-A-Host-Port-Event-Catalog-And-Agent-Config.md`: Notes only, plus any amendments to Tasks 2–5.
      - `plans/149-Phase-3-Part-B-Agent-And-Session-Surface.md`: amendments only, per findings (j)–(k).
    - References:
      - `src/contracts-core/agent.ts`, `src/contracts-run-state.ts`, `src/contracts-protocol.ts`, `src/host/types.ts`, `src/hooks/catalog.ts`, `src/agent-session/session.ts`, `src/identity.ts`
  - Test Cases to Write:
    - n/a — read-only. The review defines the tests that later tasks write.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — read-only.
    - Docs pages to create/edit: none — findings only.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):

    Read-only review. No code changed. Every count below is the graft/rg count on `12192d66`.

    #### 1. Inventory

    | Contract | Today | §2.3 target | Gap |
    | --- | --- | --- | --- |
    | `createAgent` | `src/agent-session/create-agent.ts:26` | `src/contracts-core/agent.ts:196` | `AgentConfig` is 51–141 |
    | `AgentConfig` | `src/contracts-core/agent.ts:51` | `tools.add`, `skills.{dirs,add,disclosure}`, `principal` | `tools?: ToolRegistry \| ToolDefinition[]` (57), `skills?: SkillRegistry \| Skill[]` (58), `skillsDisclosure` (62), `activateAllSkills` (60), `identity` (109) |
    | `Agent` | `src/contracts-core/agent.ts:183` | `id`, `session()`, `sessions`, `commands`, `models`, `tools`, `skills`, `inspect()`, `subscribe()`, `dispose()` | has `config`/`createSession()`; missing `id`, `sessions`, `models`, `tools`, `skills`, `subscribe()` |
    | `AgentSession` | `src/contracts-run-state.ts:429` | `run`, `stream`, `steer`, `abort`, `resume`, `messages`, `fork`, `compact`, `close` | no `resume`, no `messages`; `prompt`/`clone`/`entries`/`checkout`/`contextMeter`/`subscribe`/`leafId`/`guardrailPackRefs` are outside §2.3 — see (k) |
    | `RunOptions` | `src/contracts-protocol.ts:79` | `model`, `limits`, `tools.only`, `metadata`, `signal` | `toolNames` (110), `skills`/`activeSkills`/`skillsDisclosure`/`activateAllSkills` (102–107), `identity` (98) |
    | `AgentRunResult` | `src/contracts-run-state.ts:366` | `status`, `stopReason`, `pending`, `messages`, `usage`, `error` | `AgentRunStatus` is `succeeded \| failed \| aborted \| suspended \| denied` (27) and has no `stopped`; `pending` is `interruption` |
    | `HostPort`/`HostUi` | `src/host/types.ts:94`/`:81` | six kinds with §2.3 fields | see (c) |
    | `AgentEventPayload` | `src/contracts-protocol.ts:207` (45 types) | frozen 23-name catalog | see the mapping table below |
    | observe catalog | `src/hooks/catalog.ts:8-53` | keyed by `AgentEventPayload["type"]` | already structurally correct; the rename is the whole change |
    | suspension | `src/suspended-run.ts`, `resumeDurable` (`src/agent-session/session.ts:648`), `resolveRunDecisions` (`src/agent-approval.ts:141`) | `session.resume(decisions)` | resume is the free function `resumeAgentRun` (`src/agent-run-lifecycle.ts:149`); no session method |
    | store slot | `AgentConfig.store` → `src/agent-session/session.ts:450` | `agent.session()` over the store slot | `slots.resolve("store", …)` is called **nowhere**. Only `loop` (`src/agent-session/runtime-registry.ts:79`) and `compaction` (`src/agent-session/session.ts:1121`) are resolved. `store` is the single un-resolved slot |
    | limits | `RunLimits` (`src/contracts-core/run-limits.ts:11`), `resolveRunLimits(agent, run)` (`src/run-limits.ts:100`) | `Limits` | name only; the narrow-only floor already holds (min per axis) |
    | identity | `Principal` (`src/identity.ts:4`), `AgentIdentity` (`:15`), `resolveRunIdentity` (`:264`) | opaque `principal` | see (f) |

    #### 2. Scope-bullet classification

    - **`createAgent`/`Agent`/`Session`/`RunOptions`/`RunResult`** — *needs kernel additions*. New: `Agent.id`, `Agent.sessions`, `Agent.models`, `Agent.tools`, `Agent.skills`, `Agent.subscribe()`, `Agent.session()`, `Session.resume()`, `Session.messages()`, `RunResult.status: "stopped"`, `RunResult.pending`, `Session.fork(): Promise<Session>` (today sync, `leafId`→`at`).
    - **`HostPort`/`HostUi`, `unavailable`** — *needs kernel additions*: `secret.ref` + the storage path (e), `select.multiple`, the non-interactive signal (d). `unavailable` already exists on every kind (`src/host/types.ts:76`).
    - **Suspension and `session.resume(decisions)`** — *needs a kernel addition*. Today the host calls `resumeAgentRun(agent, state, runState, …)`; a session method does not exist.
    - **Freeze the catalog** — *expressible*. One union, one table, a rename.
    - **`agent.sessions` over store-slot capabilities** — *needs kernel additions*: `SessionStore` (`src/contracts-core/session.ts:58`) has `append`/`list`/`get?`/`readBranchPath?`/`searchSessions?` and **no list-sessions, no delete-session**. Plus the store slot is never resolved (row above).
    - **`agent.commands`** — *expressible*. `AgentCommands` exists (`src/contracts-core/agent.ts:177`).
    - **`agent.models`** — *needs a kernel addition*: `AIProvider` (`src/contracts-core/provider.ts:74`) is `{ id, generate }` with no `models()` discovery.
    - **Limits floor** — *expressible*. Already correct.
    - **`principal` opaque and optional** — *expressible*, but it collides with one kernel contract it does not name: `ToolEffectStore` (f).
    - **One import** — *expressible*.
    - **agent-sdk stops receiving features** — *expressible*. See (j).

    #### 3. Event mapping table (45 current types)

    **Renamed (12).** `agent_started`→`run.started` · `agent_suspended`→`run.suspended` · `turn_started`/`turn_finished`→`turn.started`/`turn.completed` · `message_delta`→`message.delta` · `message_finished`→`message.completed` · `tool_execution_started`/`_progress`/`_finished`→`tool.started`/`tool.progress`/`tool.completed` · `compaction_started`/`compaction_finished`→`compaction.started`/`compaction.completed`.

    **Folded (7).** `agent_finished`→`run.completed` (`status`, `usage`, `stopReason`) — **with a split**: a bare `succeeded` becomes `run.completed`; a `succeeded` carrying `finishReason` becomes `run.completed` with `status: "stopped"`, matching §2.3's `RunResult`. · `agent_denied`→`decision.resolved` then `run.completed` with `status: "stopped"`, `stopReason: "denied"` · `agent_resumed`→`run.started` with `resumed: true` · `provider_turn_started`/`provider_turn_finished`→`turn.started`/`turn.completed` (usage, budgets, `stopReason`, cache on the completed one) · `tool_execution_error`/`tool_execution_blocked`→`tool.completed` with `status` from `ToolExecutionMetadata.status` (already a field at `src/contracts-protocol.ts:159` — the fold is a field move, not new data) · `compaction_failed`→`compaction.completed` with `error` · `error`→`run.failed`.

    **Removed (7).** `message_started` (`message.delta` opens a message; 20 files, all of which also touch `message_delta`) · **`artifact_validation_started`, `artifact_validation_finished`, `artifact_revision_started`, `artifact_finished`, `artifact_failed` — these five have no emit site anywhere in the tree.** Their only readers are `packages/prism-core/src/governance/observability/timeline.ts:557-562`, two tests, and `docs/agent-events.md`. Remove now. · **`deterministic_turn` — no emit site either.** The plan-096 answering-middleware mechanism is gone; `src/__tests__/deterministic-turns.test.ts:43` constructs the event by hand. Remove now.

    **Module-owned, to `package.event` until the owning phase (b).** `guardrail_decision` (emits: `src/guardrails.ts:127`, `src/evidence-grounding.ts:81`; owning phase 9) · `steer_rejected` (`src/agent-session/session.ts`; owning phase 9 with guardrails) · `attention_compiled` (`src/agent-session/session/assemble.ts:349`; owning phase 8) · `delegated_agent_step` (`src/delegated-agent-step.ts:38`; owning phase 9) · `tool_narrowing_clamped` (`src/agent-session/session/assemble.ts:431`; owning phase 3 itself — keep the mechanism, re-home the event). Emit as `package.event { package: <module id>, name: "guardrail.decision" | "steer.rejected" | "attention.compiled" | "agent.step" | "tools.clamped", data }`. **Open question for the user:** these are kernel modules, so `package` would name a kernel module. `package.event` is the §2.3-sanctioned home and needs no new catalog name, but the `package` value needs a convention. Recommended: the registration id the module already owns on the bus (`bus.registrar("kernel")` gives `kernel:…`), i.e. `package: "kernel"`, `name: "<module>.<verb>"`. Confirm before Task 3.

    **Limits floor, folded (2).** `run_limit_exceeded`→`run.failed` carrying `limit: RunLimitBreach` · `budget_exhausted`→`run.failed` carrying `attribution` (the payload `AgentRunResult.attribution` already has, `src/contracts-run-state.ts:381`). Both fire only on a run that ends immediately after. **Blast radius is larger than Task 3 assumed:** `packages/prism-core/src/runtime/server/webhooks.ts`, `packages/prism-code/src/{headless.ts,tui/reducer.ts}`, `packages/ag-ui` handler tests, and `src/testing/agent-event-source-conformance.ts` all switch on these two. That conformance suite must keep covering them through the new shape.

    **Roadmap conflicts — the Task 1 stop rule fires on these two. Task 3 does not start until the user rules.**

    1. **`retry_scheduled`** (emit: `src/agent-session/session/provider-round.ts`). Retry/backoff is a **Phase 5** model concern (§2.1 Models). §2.3 has no home and the kernel must keep emitting it. Recommended fold that needs a §2.3 amendment: `turn.started` gains `attempt?: number` and `retry?: { delayMs, error }`, keeping `turn.started`/`turn.completed` paired per attempt. Alternative the user may prefer: add `run.retrying` to the §2.3 list.
    2. **`event_subscriber_overflow`** (emit: `src/agent-session/event-subscriber.ts:60`). It has no home because it is not a run event at all: under the default `close` policy it is spliced into the *overflowing subscriber's own queue* as that subscriber's last item (`src/agent-session/event-subscriber.ts:57-66`), then the subscriber closes. It is a per-subscriber terminal marker delivered on a private queue, not an observe-hook notification. Recommended: drop it from the catalog and make the overflow **reject the iterator** (`next()` throws a named `SubscriberOverflowError`), which is one line and strictly better for a host — its `for await` fails loudly instead of seeing a synthetic event mid-run. This changes observable `subscribe()`/`stream()` behaviour, so it needs the user's sign-off.

    **No home, no production consumer — removable without a roadmap amendment.** `queue_updated` (emit `src/agent-session/session.ts:641`; only consumers are `packages/prism-coding-tools/src/dev/ui/inspector.ts`, `packages/prism-core` timeline, and tests). Recommend remove; the steer queue is internal state.

    **Totals.** 12 renamed + 7 folded + 7 removed + 5 → `package.event` + 2 folded into `run.failed` + 2 conflicts + 1 removable = 37, plus the 8 already-dotted names (`hook.error`, `package.event`, `session.opened`, `session.closed`, `package.status`, `background.*`) that stay. Final catalog = 23 §2.3 names + `decision.pending` (Task 3) = 24, matching §2.3 exactly once the two conflicts are ruled on.

    #### 4. Assumptions

    **(a) Persisted event entries — refuted as stated.** Entries do persist `AgentEvent` objects (`SessionEntry.event?: AgentEvent`, `src/contracts-core/session.ts:48`; `AgentEventRecord.event`, `src/contracts-protocol.ts:718`), but **no production reader switches on a persisted event type.** Every reader found is type-agnostic or only checks that `type` is a string:

    - `src/node/session-store-jsonl.ts:275` `isAgentEvent` → `typeof value.type === "string"`, so an old stored name parses fine.
    - `src/agent-event-source.ts:417`, `packages/prism-core/src/sessions/{postgres,nats}/event-source.ts:707,361` → compare `record.type === record.event?.type`, never membership in the catalog.
    - `packages/memory/src/compaction/llm/tokens.ts:15`, `packages/memory/src/compaction/observational-memory/serialize.ts:8`, `packages/prism-core/src/sessions/codecs/index.ts:166` → size/encode, type-agnostic.

    The two readers the plan named are not readers: **Prism Code session replay** rebuilds from `message` entries and switches only on *live* stream events (`packages/prism-code/src/tui/reducer.ts:488-721`), and **`examples/conversation-durable-replay.ts` only counts records and checks `redacted === true`** (lines 39-45). `scripts/lib/prism-code-checks.mjs:130-132` does filter `message_finished`, but only over events it just produced.

    **And the durable-resume path cannot fail closed on an event type, because no event reaches it.** `StoredAgentRunState` (`src/agent-run-state.ts:40-110`) holds `pendingCalls`, `stickyDecisions`, counters, deadlines, `loopState`, `sessionState`, `toolNames` — no event field. `AgentRunStateError` on an unknown stored event type is unbuildable. **Decision: skip unknown stored event types in projections, no alias, and drop the durable-resume requirement from Task 3.** Prism Code's reducer must gain a default arm so an old persisted type cannot fall through its `switch`.

    **(b) Module-owned events — resolved.** Six named in the plan. `artifact_*` (5) and `deterministic_turn` have **no emit site at all** → remove now (see the table). `guardrail_decision`, `attention_compiled`, `delegated_agent_step`, `tool_narrowing_clamped` are emitted today → `package.event` under the owning module until its phase. Emit sites: `src/guardrails.ts:127`, `src/evidence-grounding.ts:81`, `src/agent-session/session/assemble.ts:349`, `src/delegated-agent-step.ts:38`, `src/agent-session/session/assemble.ts:431`. Decision is in the table above; the `package` naming convention is the one open question.

    **(c) `HostUi` drift — confirmed, and the blast radius is zero.** All four drifts are real (`src/host/types.ts`: `secret` has no `ref` at 35-39, `notify` is `title`/`detail` at 46-50, `open-url` has no `title` at 41-44, `select` has no `multiple` at 20-25). But:

    - `kind: "secret"` / `"notify"` / `"open-url"` / `"select"` / `"input"` appear **only in the type declarations**. `graft grep "kind: \"secret\""` returns one hit: the interface itself.
    - `ui.request(` has exactly **two** call sites: `src/agent-session/session/assemble.ts:121` and the package wrapper `src/packages/loader.ts:337-342`.
    - The kernel only ever sends `confirm`. **Confirmed.**
    - **No host in this repo implements `HostUi` at all.** `rg "HostUi"` outside `src/host/`, `src/index.ts` and the compat baseline returns only `src/__tests__/ask-resolution.test.ts:83` and `src/__tests__/package-loader.test.ts:369`. Prism Code, ACP and AG-UI attach no `host.ui`.
    - **Prism Code `oauth.ts`/`credentials.ts` are not callers and never touch `HostUi`.** They read `env:`/keyring refs (`packages/prism-code/src/credentials.ts:120,282-286`, `providers.ts:7`) and prompt through Prism Code's own path (`packages/prism-code/src/tools.ts:17`, `headless.ts:180`). Their prompts become a `host.ui` caller only in Phase 12, which owns the headless assembler.

    **Amends Task 2:** the file list drops `packages/prism-code`, `packages/ag-ui`, `packages/acp-agent` entirely. The reshape touches `src/host/types.ts`, the one emit site, and two test fixtures. Task 2's repo-wide "old fields" grep still runs, but it is expected to return zero.

    **(d) Non-interactive signal — confirmed absent, and no such signal exists anywhere.** `resolveAskDecisions` (`src/agent-session/session/assemble.ts:97-142`) checks `ctx.session.agent.config.host?.ui` at line 115 and nothing else. `rg interactive` over `src/ packages/` finds no run-level flag — the only hits are Prism Code's own legacy approval string (`packages/prism-code/src/tools.ts:17`) and an unrelated TTY note. So the signal must be added.

    **Decision: `RunOptions.interactive?: boolean`, default `true` when a `HostUi` is attached.** §2.4 requires both conditions, so both must be expressible; defaulting to `true` keeps every existing host on the inline path and makes the opt-out explicit, which is what a headless-with-UI host (ACP server session, AG-UI, an HTTP host) needs. `AgentConfig` does not need the field: §2.4 says *the run* is interactive, and `RunOptions` is the run's input.

    **(e) `secret` answers — decided, with one addition the plan missed.** The kernel wrapper `src/packages/loader.ts:333-345` already stamps `package`/`sessionId` and already returns `{ status: "unavailable" }` when no host UI exists. `loadPackages` has `slots` in scope (used at `loader.ts:474`), so the write is reachable there.

    **Decision:** `CredentialResolver` (`src/contracts-core/resources.ts:42`) gains an optional `store(ref, value)`. The wrapper stores on `answered` and returns `{ status: "answered", value: undefined }`. `createEnvRefCredentialResolver` (`src/slots/defaults.ts:8-19`) does not implement `store`, so the default slot answers `unavailable` — fail closed, which is what Task 2 already specified. Ownership stays with the credentials slot (§2.5); Phase 5's keyring package implements `store`.

    **Addition Task 2 must make:** push the stored value onto `secrets` (`src/packages/loader.ts:198`), the array the hook bus and redactor already use. Without that, a stored secret is not masked in the events and errors of the run that stored it — the exact failure §1.4 forbids.

    **(f) `identity` → `principal` — confirmed, but the plan's file list is materially short.** Kernel reads all match: `src/agent-session/session/assemble.ts:659` (`resolveRunIdentity`) and `:660` (`ownershipFromIdentity`), `:684` (`identityTelemetryAttributes` into run metadata), `src/agent-session/session/tool-round.ts:56, 109, 131` (`decisionIdentityRef` on the sticky-decision scope) and `:410, :418` (`ToolContext.identity`), `src/agent-approval.ts:342-343`, `src/tools.ts:264, 285-286, 405-410`, `src/secure-agent.ts`.

    Ownership does come from `AgentConfig.ownership` independently (`assemble.ts:658`), so ownership survives the removal. `decisionIdentityRef` becomes `principal?.id` as planned, **with a recorded weakening**: today the sticky-decision key is `${tenantId}:${principal.kind}:${principal.id}` (`src/agent-approval.ts:343`); `principal.id` alone is a coarser key, so two principals sharing an id across tenants share sticky decisions. Acceptable because a sticky decision is already keyed to the run's own tool name + arguments hash.

    **Three facts the plan does not record:**

    1. **`ToolEffectStore` is a kernel contract that requires an identity the kernel would no longer have.** `ToolEffectClaimInput.identity` is dereferenced without a guard at `src/tool-effects.ts:59` (`input.identity.principal.id`) and `:272` (`assertIdentityActive`), and it is the record key (`:369-373`, tenant + account + user). The kernel's only source is `session.activeIdentity` (`tool-round.ts:410,418`). Deleting the kernel read leaves this contract unsatisfiable. **Decision:** `ToolEffectStore` keys on `ownership` (`AgentConfig.ownership`, which survives to Phase 6) and its `identity` field is removed. `effectStore` is a deferred field whose owning phase is 6, so this is a Phase 6-shaped edit made now because Task 4 makes it unavoidable.
    2. **`createSecureAgent` can do what the plan says.** `SecureAgentOptions.identity` (`src/contracts-core/agent.ts:156`) is verified at creation against `ownership`; `createSecureAgent` (`src/secure-agent.ts:65`) already rebuilds a `ToolRegistry` from `options.tools`. It passes the verified identity on as `principal` and stays a non-kernel module until Phase 9. Confirmed.
    3. **The real sweep is the `createAgent`/`run` literals, not every `identity:` line.** `rg -l "identity:"` returns 128 files, but most are packages' *own* identity parameters (`packages/prism-work` connectors, `packages/prism-channels`, `packages/mcp` bindings, `packages/prism-core` governance) that do not touch `AgentConfig`. The files that actually pass `identity` into `createAgent`/`run` are 15: `packages/acp-agent/src/index.ts`, `packages/prism-code/src/acp.ts`, `packages/prism-core/src/runtime/supervisor/supervisor.ts`, `examples/{behavior-evaluation,execution-timeline,messaging-agent,messaging-outbox,model-router-aggregate-budgets}.ts`, `examples/agent-sdk-coding.ts`, and 8 `scripts/fixtures|phase*` files. Plus the agent SDK's own `identity: AgentIdentity | "local-operator"` (`packages/agent-sdk/src/define-agent.ts:106`, synthesized at `:170-186`) and its 5 test files. **`AgentIdentity` itself stays in the barrel** — 130 files reference the type, and packages own their uses; Task 4 deletes the two config *fields*, not the type.

    **(g) `tools`/`skills` reshape — confirmed, and registry-passing sites are few.** 15 non-test sites pass a `ToolRegistry`/`SkillRegistry` into `AgentConfig`: `src/secure-agent.ts:65`, `src/cli-runner.ts:513`, `src/testing/prefix-stability-conformance.ts:175`, `packages/agent-sdk/src/define-agent.ts:312`, `packages/agent-sdk/src/planes/skills.ts:107`, and 10 examples (`external-app-db-backed`, `custom-tools-skills-context`, `discover-skills`, `crew-hierarchy`, `host-step-loop-timeline`, plus test-adjacent ones). `tools: { add }` and `skills: { add }` cover all of them.

    **Two details Task 5 must preserve:** `src/secure-agent.ts:65` passes `{ duplicate: "error" }` to `createToolRegistry`, an option `tools.add` does not carry — the duplicate-name check must move onto `tools.add` or the secure path weakens. And `src/agent-session/runtime-registry.ts:92-95` (`agentToolList`) branches on `"list" in configured`; that becomes `agent.config.tools?.add`. `skills.dirs` reusing `skills.addDir` (`src/agent-session/create-agent.ts:22`) is unchanged and fine.

    **(h) Kernel skills catalog — the byte change is real and unavoidable.** The catalog is not a hook today: `buildProviderMessages` (`src/input.ts:139`) materializes skill messages inside the *input assembly*, and `src/loop/run-controller.ts:156-160` calls `assemble()` (which runs it) **before** `context.build`. The current provider view is `[stable, context, skills, declarations, dynamic]` (`src/input.ts:159-166`). A `kernel:context.build` registration writes into `ContextDraft`, whose `system[]` lands in the `stable` position — so skills move **ahead of** `context` blocks and `prefix_stability_holds_after_catalog_move` cannot be byte-identical. **Decision:** pin the new expected bytes in Task 5 and record the old layout in the test message, rather than pretending the conformance can stay byte-identical.

    **(i) `toolNames` → `tools.only` — the plan's stated default is wrong and unsafe.** `selectRunTools(listed, options.toolNames, resumed?.state?.toolNames)` (`src/agent-session/session/assemble.ts:270`) intersects the requested list with the **checkpointed** `StoredAgentRunState.toolNames` (`src/agent-run-state.ts:90`, written at `src/agent-session/session/persist.ts:33`).

    The plan says "the suspended-run fingerprint already fails closed on drift", so rename the stored field. **That premise is false.** The fingerprint is `agentFingerprint(agent, state.definitionRevision)` (`src/agent-run-state.ts:171, 351`), checked at `assemble.ts:638-639`. It covers the *agent definition* and a host-supplied revision string — **not** the stored field's name. An old store's `toolNames` would simply be absent under the new name, `parseAgentRunState` (`src/agent-run-state.ts:367`) validates an optional field, and the resumed run would come back with the **full** tool set: a silent fail-open that widens tool authority on every pre-rename store.

    **Decision: do not rename the stored field.** `toolNames` stays as the persisted wire name; only the public input `RunOptions.toolNames` → `tools.only` changes. This is an internal wire field, not host-facing config, so nothing in §2.3 is violated. The plan's other two questions are confirmed: the resume intersection keeps its semantics unchanged, and `tools.add`/`tools.only` collide fail-closed exactly as plan 146 did.

    Also: 46 files contain `toolNames`, but most are `Skill.toolNames` (a different concept in `src/skills.ts`, `packages/memory/src/wiki/skills.ts`, `packages/prism-work/src/skills/load.ts`). The sweep pattern must be `RunOptions`/`RunOptions`-shaped, not the bare word.

    **(j) `agent-sdk` dependents — confirmed, with a per-file destination.** 7 source files in `packages/prism-code` import `@arnilo/prism-agent-sdk` (`bin/prism-code.ts`, `doctor.ts`, `headless.ts`, `mcp.ts`, `prompt.ts`, `tui/index.ts`, `tui/commands.ts`) plus `src/__tests__/approval.test.ts` — the plan's "8 source files" is 7 source + 1 test. `examples/agent-sdk-coding.ts` is the only example. The package keeps compiling against the reshaped kernel and is not deleted before Phase 12 removes Prism Code's last caller. Test destinations:

    | File | Lines | Destination | Why |
    | --- | --- | --- | --- |
    | `config.test.ts` | 248 | **stays** | pure `parseAgentSdkConfig` JSON validation; SDK surface |
    | `tool-plane.test.ts` | 289 | **stays** | pure `resolveToolPlane` unit |
    | `planes.test.ts` | 312 | **stays** | skills/instructions plane composition |
    | `presets.test.ts` | 233 | **stays** | preset + `mergeAgentConfig` |
    | `mcp-plane.test.ts` | 351 | **stays** (or → `packages/mcp`) | MCP bridge, redaction, reconnect; the MCP package owns the bridge |
    | `capabilities.test.ts` | 209 | **stays** | capabilities/web-tools/wiki-command composition |
    | `define-agent.test.ts` | 653 | **split** | the kernel-behaviour cases move to `src/__tests__`: skills-dir discovery (Phase 3 Task 5's `skills.dirs`), compaction passthrough, and "MCP denied allow fails at defineAgent with no session created". The rest stays. |

    **(k) Part B inputs — decided.**

    - **`RunResult` returns, it does not throw.** There is exactly **one** throw site: `throw new AgentRunError(result, { cause: error })` at `src/agent-session/session/assemble.ts:779`. 23 files reference the type, 11 non-test. §2.3's `RunResult` has both `status` and `error?`, which only makes sense if failures return. **Decision: delete `AgentRunError`; `run()` resolves with `status: "failed" | "aborted"` and `error`.** Throwing stays reserved for contract violations (`TypeError`, `PackageLoadError`), which is the §1.4 split. Migrating callers: `packages/prism-code/src/headless.ts`, `packages/prism-channels/src/runtime-turn.ts`, `packages/prism-core/src/governance/evals/experiment.ts`, `packages/prism-core/src/runtime/supervisor/supervisor.ts`, `examples/model-router-aggregate-budgets.ts`.
    - **Status map.** `succeeded` (no `finishReason`) → `completed`; `succeeded` (with `finishReason`) → `stopped`; `failed` → `failed`; `aborted` → `aborted`; `suspended` → `suspended`; `denied` → `stopped` with `stopReason: "denied"`. That is the only 1→2 split, and it is what §2.3's `stopReason` exists for.
    - **`Session` members outside §2.3.** *Delete:* `prompt` (a bare alias for `run`; callers `packages/prism-code/src/observational-memory.ts:321`, `approval.ts`, `tui/index.ts` migrate to `run`) · `clone` (**zero** package callers) · `checkout` (**zero** package callers; only `src/rpc.ts` and the `docs.test.ts:3505` example pin). *Keep as documented kernel members:* `entries()` — Prism Code `tui/index.ts:334` and `observational-memory.ts:358`, plus AG-UI's transcript projection (`packages/ag-ui/src/projectors.ts:17`), all need entries rather than messages; `messages()` derives from it · `subscribe()` — `packages/prism-code/src/headless.ts:460` and `packages/ag-ui/src/handler.ts:632` both need a session-scoped live stream · `contextMeter()` — `packages/prism-code/src/tui/index.ts:502` and `tui/reducer.ts` · `leafId` — 22 reads in `src/agent-session/session.ts` alone, plus the store and RPC layers · `guardrailPackRefs` — one read (`src/run-bundle.ts`), and guardrail packs move in Phase 9.
    - **`Agent.config` stays.** The backlog wants `agent.config.tools`/`skills` readers moved, and they move in Part B — onto `agent.tools`/`agent.skills`. But `agent.config` cannot be removed: readers of `store` (`packages/prism-code/src/{headless.ts:418,tui/index.ts:294,678}`), `redactor` (`headless.ts:445`, `tui/index.ts:772`, `tui/commands.ts:1066,1144`), `id`/`name` (`packages/prism-coding-tools/src/dev/index.ts:201`) and a full config rebuild (`packages/prism-core/src/governance/evals/scenarios.ts:280-283`) have no §2.3 home. `store` moves in Phase 6; `redactor`/`id`/`name` are settled by Phase 11's export-surface review. **Decision: `Agent.config` remains a documented kernel member through Phase 11.**
    - **`agent.sessions` needs two new optional `SessionStore` members:** `listSessions?()` and `deleteSession?()`. `SessionStore` (`src/contracts-core/session.ts:58`) has neither. Stores that omit them answer the existing `SessionSearchUnsupportedError` (`src/contracts-core/session.ts:224`) — fail closed, matching the roadmap's own phrasing for `searchSessions?`. Phase 6 makes them part of the store-slot contract.
    - **`agent.models` needs `AIProvider.models?(): Promise<readonly ModelInfo[]>`.** `AIProvider` (`src/contracts-core/provider.ts:74`) is `{ id, generate }`. Until a provider implements it, `agent.models.list()` returns only the configured `AgentConfig.model` resolved to a `ModelInfo`. Phase 5 owns the full discovery contract.

    **(l) `RunLimits` vs `Limits` — the plan's default holds.** `resolveRunLimits(agent, run)` (`src/run-limits.ts:100`) narrows every policy axis by `min` with `null` = uncapped, so the floor law is already correct for both `AgentConfig.limits` and `RunOptions.limits`. **Keep the name `RunLimits`**; Phase 11's export-surface review owns 1.0 naming and a rename would churn the released 0.12 surface for no behaviour change. One note for `docs/next/agent.md`: `RunLimits.backgroundSettleMs` is agent-wide only — a per-run value is ignored (`src/contracts-core/run-limits.ts:29-33`).

    #### 5. Verdict

    **The plan stands; Tasks 2–5 are executable after the amendments below, with one user decision outstanding.** No finding invalidates a later task in this plan or in plan 149. The survey's five headline findings all reproduce, and four more were added:

    - the `store` slot is the one slot the runtime never resolves (`src/agent-session/session.ts:450` vs `src/slots/defaults.ts:26`);
    - `HostUi` has drifted, but **no host in the repo implements it** and only `confirm` is ever sent, so Task 2 is far smaller than planned;
    - eleven current events have no §2.3 home, but **seven of them (`artifact_*` ×5, `deterministic_turn`, and `queue_updated`) are dead or unconsumed** and need no roadmap amendment;
    - **persisted events do not carry a durable-resume risk at all** — no production reader switches on a stored event type and no event reaches a resume;
    - Prism Code still depends on the agent SDK, in 7 source files.

    New findings that change the plan:

    1. **The Task 1 stop rule fires.** Two events need a user ruling before Task 3: `retry_scheduled` and `event_subscriber_overflow`. Recommendations are in the table.
    2. **Task 2's caller list is wrong** — `packages/prism-code`, `packages/ag-ui`, `packages/acp-agent` are not callers of any changed kind. Drop them.
    3. **Task 2 must push a stored secret onto `secrets`** (`src/packages/loader.ts:198`) or it is unmasked in that run's own events and errors.
    4. **Task 4 must also fix `ToolEffectStore`** (`src/tool-effects.ts:59,272,369-373`), which requires an identity the kernel will no longer synthesize. Key it on `ownership`.
    5. **Task 5 must not rename the stored `toolNames` field** — that is a silent fail-open, not a fail-closed. The plan's stated reason does not hold.
    6. **Task 5's prefix-stability test cannot stay byte-identical** — pin the new bytes instead.
    7. **Task 5 must keep `createToolRegistry`'s `duplicate: "error"`** for `src/secure-agent.ts:65`.

    #### 6. Security — trust boundaries and the check each task must test

    | Boundary | Value | Owner | Required check |
    | --- | --- | --- | --- |
    | `host.ui` request text | package-authored `title`/`detail`/`options`, shown to a person | Task 2 | docs must say a host renders it as untrusted text; `package`/`sessionId` overwritten by the kernel (`loader.ts:340`) |
    | `secret` answer | the secret value | Task 2 | stored via the credentials slot, pushed onto `secrets` (`loader.ts:198`), `value: undefined` to the package; redactor + store scan find it nowhere |
    | `secret.ref` | package-authored ref naming a credential slot | Task 2 | must be `env:`/`keyring:` shaped before the host is asked; otherwise `PackageLoadError` |
    | `principal` | host-supplied, opaque | Task 4 | kernel never reads, verifies or defaults it; a run with no `principal` sees none anywhere, stored entries included |
    | `ToolEffectStore` key | ownership-derived after Task 4 | Task 4 + Phase 6 | the durable effect key must stay scoped by tenant; removing `identity` must not collapse it |
    | sticky-decision scope | `principal?.id` after Task 4 | Task 4 | recorded weakening: coarser than `tenant:kind:id`; keep the tool-name + args-hash component |
    | events | every `AgentEvent` | Task 3 | `tool.completed` for blocked/errored keeps the old redacted reason; `decision.pending` carries no raw arguments |
    | stored event entries | old type names in old stores | Task 3 | projections **skip** unknown stored types; Prism Code's reducer gets a default arm; no durable-resume check (see (a)) |
    | `inspect()` | packages, versions, tools, skills, hooks, status | Task 3 + Part B | keys are the new hook names; secret config fields show their ref |
    | `RunResult.error` / `stopDetail` | provider- and package-authored | Part B Task 4 | redacted, byte-capped (≤256 for `stopDetail`), returned not thrown |

    #### 7. Per-field owning phase (deferred `AgentConfig`/`RunOptions` fields)

    `model` → 5 · `attentionCompiler` → 8 · `contextBudget` → 8 · `toolResultFold` → 8 · `costCatalog` → 5 · `runLedger` → 6 · `effectStore` → 6 · `ownership` → 6 · `runState` → 6 · `store` → 6 · `resourceLoader` → 9 · `trust` → 9 · `redactor` → 11 · `validator` → 7 · `systemPrompt` → 8 · `compaction` → 8 · `retry` → 5 · `inputLayout` → 8 · `providerOptions` → 5 · `thinkingLevel` → 5 · `usageEstimation` → 5 · `toolsDisclosure`/`toolsSearch` → 7 · `allowHiddenToolCalls` → 7 · `idempotencyKey` → 6 · `hooks`/`slots`/`disable`/`packages`/`packageConfig`/`host`/`metadata`/`id`/`name`/`instructions` → stay (§2.3 already names them).

- [x] Task 2: Host port — the §2.3 request kinds and `unavailable` semantics
  - Acceptance Criteria:
    - Functional: `HostUiRequest` matches §2.3, with the Task 1(c) field changes:
      - `secret` carries a `ref`
      - `notify` carries `level` and `message`
      - `open-url` carries `title`
      - `select` carries `multiple?`, and a multiple select answers `readonly string[]`
      - `HostUiAnswerMap` follows each change
    - Functional: Every request reaching the host is stamped by the kernel with `{ package, sessionId? }`. A package-supplied `package` or `sessionId` is overwritten. This is already true in `src/packages/loader.ts:340` and is now tested for every kind.
    - Functional: A `secret` request with an answer is stored through the credentials slot at the request's `ref`, per Task 1(e). `CredentialResolver` (`src/contracts-core/resources.ts:42`) gains an optional `store(ref, value)`. The package receives `{ status: "answered", value: undefined }`. A `ref` that is not `env:`/`keyring:` shaped fails before the host is asked, with `PackageLoadError` code `invalid_secret_ref`. A slot with no `store` answers `unavailable`.
    - Functional: A stored secret value is pushed onto the loader's `secrets` array (`src/packages/loader.ts:198`) at the moment it is stored, so the hook bus, the redactor and every error raised by that run mask it. Without this the value is unmasked in the events and errors of the run that stored it.
    - Functional: With no `host.ui`, every request answers `{ status: "unavailable" }`. The kernel ask path suspends on `unavailable`, and on a run with `interactive: false`, without sending `confirm`. `dismissed` stays a deny.
    - Functional: `RunOptions.interactive?: boolean` exists, defaulting to `true` when a `HostUi` is attached. `resolveAskDecisions` checks it next to the existing `ui` check (`src/agent-session/session/assemble.ts:115`) and treats `false` as `unavailable`. Per Task 1(d), `AgentConfig` does **not** carry the field — §2.4 scopes interactivity to the run.
    - Functional: `@arnilo/prism/testing` exports `createScriptedHostUi(script)`, which answers, dismisses, or returns `unavailable` per kind and records every request. The package conformance suite (`src/testing/package-conformance.ts`) gains an `unavailable` pass: setup and every registered command run against a host that answers `unavailable`, and none may throw an untyped error or report an allow.
    - Functional: The only in-repo callers of a changed kind are the kernel `confirm` emit (`src/agent-session/session/assemble.ts:121`) and the two test fixtures (`src/__tests__/ask-resolution.test.ts:83`, `src/__tests__/package-loader.test.ts:369`). Per Task 1(c), **no host in this repo implements `HostUi`** and Prism Code `oauth.ts`/`credentials.ts` never call it, so there is nothing else to migrate. The repo-wide grep for the old fields still runs (expecting zero hits) as the proof.
    - Performance: No extra allocation per `ask`. The non-interactive check is a field read.
    - Code Quality: The types stay in `src/host/types.ts`, the kernel module for the host port (§2.2). No alias for the old fields, and no second request type.
    - Security: A secret value never appears in an event, `inspect()`, an error, a log line, or a persisted entry. The test asserts this through the redactor and a store scan. A package cannot read back a secret it asked for. Host-supplied `title`/`detail` text is the package's, so the docs say a host must render it as untrusted text.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 Host port, §2.4 (how an `ask` is resolved), §2.5 `credentials` slot, and §1.4 "Secrets stay at the edge"
      - `src/host/types.ts`, `src/packages/loader.ts:333-344`, `src/agent-session/session/assemble.ts:113-133`, `src/slots/defaults.ts:8-19`
      - Task 1 findings (c), (d), and (e)
    - Options Considered:
      - Return the secret to the package and trust it to store the value. Rejected: §2.3 says the value is "never returned to the package", and §1.4 keeps secrets at the edge.
      - Leave `interactive` implicit (UI present means interactive). Rejected: §2.4 names both conditions, and ACP/AG-UI hosts need to suspend with a UI attached.
    - Chosen Approach:
      - Reshape the union in place, store secrets through the credentials slot inside the kernel wrapper, add the non-interactive signal Task 1 names, and ship the scripted UI in `/testing` so every package can test the `unavailable` path.
    - API Notes and Examples:
      ```ts
      const res = await prism.host.ui.request({ kind: "secret", title: "Brave API key", ref: "keyring:brave" });
      if (res.status !== "answered") { prism.status.note("warn", "web search needs a key"); return; } // fail closed
      // the key is now resolvable as "keyring:brave" through the credentials slot; res carries no value
      ```
    - Files to Create/Edit:
      - `src/host/types.ts`: request and answer shapes.
      - `src/packages/loader.ts`: wrapper stamping, the secret store path, and the `secrets` push.
      - `src/contracts-core/resources.ts`: the `CredentialResolver` `store` member (confirmed by Task 1(e)).
      - `src/slots/defaults.ts`: the env resolver does not implement `store`, so it answers `unavailable`.
      - `src/agent-session/session/assemble.ts`: the non-interactive check.
      - `src/contracts-protocol.ts`: the `RunOptions.interactive` field (confirmed by Task 1(d)).
      - `src/testing/host-ui.ts`: new. `src/testing/index.ts` and `src/testing/package-conformance.ts`: export and the `unavailable` pass.
      - `src/__tests__/host-ui.test.ts`: new — all seven test cases live here. The two existing fixtures (`ask-resolution.test.ts`, `package-loader.test.ts`) needed no change: both only use `confirm`, whose shape is unchanged.
      - `src/__tests__/public-export-contract.test.ts`: deliberate update — **none needed**; the check does not enumerate the `/testing` subpath, and the compat baseline pins the new exports.
      - `scripts/compat-baseline/arnilo__prism.txt` and the baseline of each touched workspace: regenerate with `node scripts/release.mjs gate --update-baseline`. Put the diff and its attribution in the task note.
      - `docs/next/host.md`: new. `CHANGELOG.md`: Unreleased entry.
    - References:
      - plan 144 Task 5 (the `ask` path), plan 146 Task 6 (`host` capability wrapper)
  - Test Cases to Write:
    - `host_ui_request_kinds_match_the_catalog`: a type-level and runtime check of the six kinds. It fails if a field is renamed.
    - `kernel_stamps_package_and_session_on_every_kind`: a package-supplied `package` is overwritten.
    - `secret_answer_is_stored_by_ref_and_never_returned`: the package sees no value. The redactor and a store scan find the value nowhere.
    - `secret_request_with_literal_ref_fails_before_the_host_is_asked`
    - `no_ui_answers_unavailable_for_every_kind`
    - `ask_suspends_when_run_is_non_interactive_even_with_ui`: `RunOptions.interactive: false` with a `HostUi` attached, from the default loop and a custom loop.
    - `package_conformance_runs_setup_and_commands_against_unavailable`: a fixture package that treats `unavailable` as allow fails conformance.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `HostUi` request shapes, `unavailable` semantics, and secret storage.
    - Docs pages to create/edit:
      - `docs/next/host.md`: new, API page structure. It covers `HostPort`, `HostUi`, the request table, the response statuses, the fail-closed rule for packages, the non-interactive rule, and secret storage.
      - `docs/next/testing.md`: `createScriptedHostUi` and the conformance `unavailable` pass.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-10-02):

    #### What changed

    | File | Change |
    | --- | --- |
    | `src/host/types.ts` | `secret.ref`, `notify.level` + `notify.message` (was `title`/`detail`), `open-url.title`, `select.multiple?`. `HostUiAnswerMap`: `select: string \| readonly string[]`, `secret: string \| undefined`. Untrusted-text rule documented on `HostUiRequestBase`. |
    | `src/contracts-core/resources.ts` | `CredentialResolver.store?(ref, value)`, optional and documented. |
    | `src/slots/defaults.ts` | The `env:` resolver deliberately has no `store`, with the reason inline, so it answers `unavailable`. |
    | `src/packages/loader.ts` | `askSecret` in the `hostFor` wrapper: validate `ref` → check host → check `store` → ask → store → push onto `secrets` → return `{ answered, undefined }`. |
    | `src/packages/errors.ts` | New `PackageLoadErrorCode` `invalid_secret_ref`. |
    | `src/contracts-protocol.ts` | `RunOptions.interactive?: boolean`, default `true`. |
    | `src/agent-session/session/assemble.ts` | `resolveAskDecisions` reads `ctx.options.interactive ?? true` next to the `ui` check; `false` stages the ask for suspension without sending `confirm`. |
    | `src/testing/host-ui.ts` (new) | `createScriptedHostUi(script)` → `{ ui, requests, requestsOf(kind) }`; unscripted kinds answer `unavailable`. |
    | `src/testing/index.ts` | Exports `createScriptedHostUi`, `ScriptedAnswer`, `ScriptedHostUi`. |
    | `src/testing/package-conformance.ts` | New `unavailable_fails_closed` check and a `host`-aware `agentConfig`. |
    | `docs/next/host.md` (new), `docs/next/testing.md`, `CHANGELOG.md` | API page, the `/testing` page, Unreleased entry. |

    #### Decisions taken during execution

    - **`secret: string | undefined` in `HostUiAnswerMap`, not a second response type.** The host captures the value and the kernel drops it on the way to the package. Two surfaces (host returns `string`, package sees `undefined`) cannot both be expressed by one `HostUiResponse`, so the answer map admits `undefined` and the kernel wrapper documents the drop. One `as unknown as HostUiResponse<K>` sits in the generic wrapper; the security test, not the type, is the guarantee.
    - **The `credentials` capability is not required to store a secret.** The `store` call happens *inside* `hostFor`'s `request`, after `requireCapability(..., "host-ui", ...)`, so a package still needs `host-ui` to reach it. Adding a second capability would fail every package that prompts for a key without also declaring `credentials`, which the plan does not ask for. Noted in case Phase 5 wants it.
    - **`input.detail?` and `input.value?` stay.** Task 1(c) named four field changes; `detail` on `select`/`input` was not among them, and `confirm` already uses it.

    #### Deviations from the plan text

    - **`package_conformance_runs_setup_and_commands_against_unavailable` does not detect "treats `unavailable` as allow".** A package that reads `res.value` unconditionally on an `unavailable` answer gets `undefined` and *proceeds*; there is no observable kernel signal for that. What is detectable — and what the check does — is the realistic failure: an **untyped throw** from setup, the mock session, or a registered command. A named error (`code` present) passes as a package failing closed. The plan's "report an allow" half is not implementable without a per-package instrumentation hook, which is out of scope.
    - **`host.ui` is not gated by `interactive`.** `RunOptions.interactive` guards the kernel ask path only. A package calling `host.ui.request` itself during a non-interactive run still reaches the host, because `hostFor` is bound per owner/session in the loader (`src/packages/loader.ts:333`) and never sees the run. The acceptance criterion asked only for the ask path, so this is in-scope-complete — see the finding below.

    #### Findings for later tasks

    - **`RunOptions.interactive` cannot reach a package's own `host.ui.request` today.** Threading it needs the run to reach `hostFor`, which today takes only `(owner, sessionId?)` from `runCommand`'s `context.session`. Part B Task 4 (`session.resume`) is the natural place: the resume decision is the only §2.4 caller that must present a queued ask later.
    - **`secret` short-circuits before the host when the slot cannot store.** `askSecret` checks `resolver.store` *before* calling the host, so a default-`slots` agent never shows a secret prompt. This is the fail-closed order the plan wanted ("a slot with no `store` answers `unavailable`"), but it means Phase 5's keyring resolver is a visible behaviour change for every package that prompts today.
    - **`PackageLoadError` from `askSecret` propagates out of `host.ui.request`, not into a status note.** The loader's `report`/`note` paths wrap `setup` and `onDispose`, not a package's async host call, so a bad `ref` surfaces as an unhandled rejection in package code. Phase 12's callers must branch on it.

    #### Baseline and sweep

    - `node scripts/release.mjs gate --update-baseline` → `{"updated": true, "packages": 14}`. This task's own contribution to `scripts/compat-baseline/arnilo__prism.txt` is three lines (`createScriptedHostUi`, `type ScriptedAnswer`, `type ScriptedHostUi`). `invalid_secret_ref` is a `PackageLoadErrorCode` union member, so it appears inside the `PackageLoadErrorCode` line rather than as its own entry. The remaining baseline diff is the uncommitted Phase 1/2 work in the tree, not this task.
    - Repo-wide sweep over `src/ packages/ examples/ scripts/ docs/` (excluding `dist/`, `plans/`, `node_modules/`) for the retired shapes — a `notify` with `title`, a `secret` without `ref`, an `open-url` without `title`, a `select` without `multiple` — returns **zero hits**. Per Task 1(c), the only in-repo request construction is the kernel `confirm` at `src/agent-session/session/assemble.ts:121` plus this task's tests.

    #### Verification

    - `npx tsc -p tsconfig.json --noEmit`: clean.
    - `node scripts/release.mjs gate`: `{"updated": false, "packages": 14}`.
    - `bun test src/` : 5845 pass, 233 skip, **99 fail / 60 errors**, a failure set `diff`-identical to the run captured before this task's edits. All 99 are pre-existing in the working tree from earlier phases; none is in a file this task touched.
    - `bun test` on `host-ui`, `ask-resolution`, `package-loader`, `package-conformance`, `package-contributions`, `public-export-contract`: all pass.
    - `bun test` on the four packages with a `packageConformance` test (`prism-coding-tools/impeccable`, `memory` ×3, `integrations/hooks-json`): all pass against the new `unavailable_fails_closed` check.
    - **Pre-existing, not from this task:** `bun run typecheck` (the workspace-wide variant) fails in `packages/prism-providers` — fourteen `*.test.ts` files import `type AuthMethod` from `@arnilo/prism`, which neither HEAD nor this branch exports. `git show HEAD:packages/prism-providers/src/openai/__tests__/openai.test.ts` line 3 carries the same import, so it predates Phase 3.

- [x] Task 3: Freeze the `AgentEvent` catalog; observe hook names equal event types
  - Acceptance Criteria:
    - Functional: `AgentEventPayload["type"]` is exactly the catalog Task 1 fixed. The §2.3 names are:
      - `session.opened`, `session.closed`
      - `run.started`, `run.completed`, `run.failed`, `run.suspended`
      - `turn.started`, `turn.completed` (with usage)
      - `message.delta`, `message.completed`
      - `tool.started`, `tool.progress`, `tool.completed`
      - `decision.pending`, `decision.resolved`
      - `compaction.started`, `compaction.completed`
      - `background.started`, `background.completed`, `background.failed`
      - `hook.error`, `package.status`, `package.event`

      The catalog also holds any addition the user approved at Task 1's stop rule. **Task 3 does not start until the user rules on `retry_scheduled` and `event_subscriber_overflow` (Task 1 Notes, conflicts 1 and 2).** The catalog Task 1 fixed is: the 23 §2.3 names above, `decision.pending`, and `run.failed` carrying `limit?`/`attribution?` in place of `run_limit_exceeded` and `budget_exhausted`.
    - Functional: Each 0.12 type is renamed, folded, or removed per the Task 1 mapping table, with no alias and no dual emission. `OBSERVE_HOOKS` (`src/hooks/catalog.ts:8`) stays keyed by `AgentEventPayload["type"]`, so the rename and the observe catalog cannot drift.
    - Functional: `decision.pending` fires when an `ask` is staged for suspension, and `decision.resolved` fires when an inline confirm or a later resume settles it. Both carry the tool call id and the decision, never the arguments unredacted. Part B Task 4 adds the resume-side emit, and this task adds the types and the staged-ask emit.
    - Functional: Every consumer migrates in this task. The survey counts about 75 files for `agent_started`, 53 for `agent_finished`, 63 for `message_delta`, and 41 for `tool_execution_finished`. They include:
      - `packages/ag-ui` (the AG-UI and ACP event mapping)
      - `packages/acp-agent`
      - `packages/prism-code` (TUI reducer, headless print/json, session replay)
      - `packages/prism-core` (observability, evals, workflows, supervisor)
      - `packages/memory`, `packages/prism-channels`, `packages/mcp`, `packages/integrations/hooks-json` (the event names in its `hooks.json` mapping)
      - `examples/`, `scripts/` (`e2e-full-surface.test.mjs`)
      - every `src/__tests__` assertion
    - Functional: Persisted event types are handled per Task 1(a). **The durable-resume requirement is withdrawn:** no event reaches a resume (`StoredAgentRunState` has no event field) and no production reader switches on a stored event type. A projection reading an old stored type skips it, and `packages/prism-code/src/tui/reducer.ts` gains a default arm so an old persisted name cannot fall through its `switch`. A test covers the skip path.
    - Functional: `run_limit_exceeded` and `budget_exhausted` fold into `run.failed` with `limit: RunLimitBreach` and `attribution`. Every switch on the old names migrates, including `packages/prism-core/src/runtime/server/webhooks.ts`, `packages/prism-code/src/{headless.ts,tui/reducer.ts}`, and `src/testing/agent-event-source-conformance.ts`, which must keep covering the limit path through the new shape.
    - Functional: The five `artifact_*` types and `deterministic_turn` are removed outright — Task 1 confirmed neither has an emit site anywhere in the tree. Their only readers are `packages/prism-core/src/governance/observability/timeline.ts:301,557-569`, `packages/prism-coding-tools/src/dev/ui/inspector.ts`, two tests, and `docs/agent-events.md`. `queue_updated` goes with them (Task 1: no production consumer). No `package.event` re-homing is needed for any of these.
    - Functional: `guardrail_decision`, `steer_rejected`, `attention_compiled`, `delegated_agent_step`, and `tool_narrowing_clamped` are emitted as `package.event` with the `package`/`name` values Task 1's Notes record, until their owning phases (9, 9, 8, 9, and 3 respectively). The `package` value convention is the one open question in Task 1 and must be settled before this task.
    - Functional: `agent.inspect().hooks` is re-keyed by the new names (backlog "Re-key `agent.inspect().hooks`"). `AgentInspection.hooks` is already `Record<string, InspectedHook[]>` (`src/agent/inspect.ts:43`), so the re-key is automatic; what changes is the tests, `docs/next/packages.md`, and `examples/define-package.ts`.
    - Functional: A repo-wide grep over `src/ packages/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs` pages, and historical `CHANGELOG` sections) finds no retired type literal. The full pattern list is generated from the Task 1 mapping table and recorded in the task note.
    - Performance: `message.delta` observers stay synchronous and the hot path allocates nothing new. The fold fields (for example a `status` on `tool.completed`) add no extra event per call. The event count per run either stays the same or drops, and the task note records it for the mock-provider fixture run.
    - Code Quality: One union and one table. No string-mapping shim between old and new names anywhere in the repo.
    - Security: Folded events keep their redaction. A test asserts that `tool.completed` for a blocked or errored call carries the same redacted reason the old `tool_execution_blocked`/`tool_execution_error` did, and that `decision.pending` holds no raw arguments.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 Events, §2.4 ("every `AgentEvent` type" is an observe hook; `message.delta` is synchronous)
      - plan 144 Task 1(h), plan 146 Task 1 (the dotted-name rule for new events), `src/hooks/catalog.ts`, `src/contracts-protocol.ts:207-516`
      - Task 1 mapping table and findings (a) and (b)
    - Options Considered:
      - Keep the snake_case names and add dotted aliases. Rejected: §1.4 forbids compatibility aliases, and two names for one observe hook break `disable.hooks` ids.
      - Rename in several tasks, one event group at a time. Rejected: `AgentEventPayload` is one union, so a partial rename leaves either the typecheck or the catalog test red between tasks.
      - Proposed mapping, which Task 1 confirms or amends:
        - renamed:
          - `agent_started` → `run.started`
          - `agent_suspended` → `run.suspended`
          - `turn_started` / `turn_finished` → `turn.started` / `turn.completed`
          - `message_delta` → `message.delta`
          - `message_finished` → `message.completed`
          - `tool_execution_started` / `progress` / `finished` → `tool.started` / `tool.progress` / `tool.completed`
          - `compaction_started` / `compaction_finished` → `compaction.started` / `compaction.completed`
        - folded:
          - `agent_finished` → `run.completed` with `status`, or `run.failed`
          - `agent_resumed` → `run.started` with `resumed: true`
          - `agent_denied` → `decision.resolved` followed by `run.completed`
          - `provider_turn_*` → `turn.*` (usage and budgets on `turn.completed`)
          - `tool_execution_error` / `tool_execution_blocked` → `tool.completed` with `status`
          - `compaction_failed` → `compaction.completed` with `error`
          - `error` → `run.failed`
        - removed:
          - `message_started`: `message.delta` opens a message
          - `artifact_validation_started`, `artifact_validation_finished`, `artifact_revision_started`, `artifact_finished`, `artifact_failed`: no emit site in the tree (Task 1)
          - `deterministic_turn`: no emit site in the tree; the plan-096 answering-middleware mechanism is gone (Task 1)
          - `queue_updated`: no production consumer; the steer queue is internal state (Task 1)
        - into `package.event` until their owning phase (Task 1): `guardrail_decision`, `steer_rejected`, `attention_compiled`, `delegated_agent_step`, `tool_narrowing_clamped`
        - folded into `run.failed` with `limit?`/`attribution?` (Task 1): `run_limit_exceeded`, `budget_exhausted`
        - **stopped at Task 1's stop rule, awaiting the user:** `retry_scheduled` and `event_subscriber_overflow`. Task 3 must not invent a name for either.
    - Chosen Approach:
      - One atomic rename of the union and every consumer, driven by the Task 1 table. Then the freeze test pins the catalog, and `docs/next/events.md` documents each event's payload.
    - API Notes and Examples:
      ```ts
      for await (const event of session.stream("hi")) {
        if (event.type === "message.delta") process.stdout.write(event.delta);
        if (event.type === "tool.completed" && event.status !== "ok") console.warn(event.name, event.status);
      }
      hooks.on("turn.completed", (e) => record(e.usage)); // observe hook name = event type
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: the union. `src/hooks/catalog.ts` and `src/hooks/types.ts`: the catalog.
      - Every emit site: `src/agent-session/session.ts`, `src/agent-session/session/*.ts`, `src/loop/run-controller.ts`, `src/run-limits.ts`, `src/compaction.ts`, `src/agent-run-lifecycle.ts`, `src/event-multiplexer.ts`, `src/agent-event-source.ts`, and the module emitters Task 1(b) lists.
      - Consumers in `packages/`, `examples/`, and `scripts/` from the Task 1 caller list.
      - `src/agent/inspect.ts` and its tests.
      - `src/__tests__/hook-catalog-freeze.test.ts`: the new pinned list, with a failure message naming `docs/next/events.md`.
      - `src/__tests__/core-boundaries.test.ts:133`: the anchored block still parses.
      - `src/__tests__/public-export-contract.test.ts` if exported event type names change.
      - `scripts/compat-baseline/*.txt` for every workspace whose `.d.ts` names an event type: regenerate with `node scripts/release.mjs gate --update-baseline`, with the diff and attribution in the task note.
      - `docs/next/events.md`: new. `docs/next/hooks.md`: the observe rows. `docs/next/packages.md`: renamed hooks in examples. `examples/define-package.ts`.
      - `CHANGELOG.md`: a breaking rename entry with the full mapping table.
    - References:
      - `src/hooks/catalog.ts`, `plans/backlog.md` "Re-key `agent.inspect().hooks`"
  - Test Cases to Write:
    - `event_catalog_is_frozen`: the exact list. It fails on any addition, removal, or rename.
    - `every_event_type_is_an_observe_hook`: compile-time through the `Record`, plus a runtime check.
    - `catalog_events_fire_from_default_and_custom_loop`: each run, turn, message, tool, and decision event fires from both loops, reusing `loopConformance`.
    - `tool_completed_carries_status_for_error_and_blocked`
    - `decision_pending_fires_on_staged_ask_without_raw_args`
    - `stored_unknown_event_type_is_skipped_in_projection`
    - `prism_code_reducer_ignores_a_retired_stored_event_type`
    - `inspect_hooks_are_keyed_by_catalog_names`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — every event and observe hook name.
    - Docs pages to create/edit:
      - `docs/next/events.md`: new, API page structure, one row per event with its payload, when it fires, and which primitive fires it.
      - `docs/next/hooks.md`, `docs/next/packages.md`: names.
      - `packages/integrations/hooks-json/README.md`: if its event mapping names changed.
      - `CHANGELOG.md`: Unreleased.
      - Released `/docs` pages stay on 0.12.1.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-02):

    #### Decisions taken at the start (the three open questions, plus one Task 1 did not raise)

    Task 1's stop rule asked for user rulings before this task. Executed on the recorded
    recommendations; each is reversible in one edit if the user prefers otherwise.

    1. **`retry_scheduled` → `turn.started` with `attempt` + `retry: { delayMs, error }`.** The catalog stays exactly 23 names, so no roadmap amendment is needed. A retry re-emits `turn.started` for the attempt; the redacted cause rides `retry`.
    2. **`event_subscriber_overflow` → removed; the iterator is rejected.** `EventSubscriber.push` under the default `close` policy now sets an overflow error, drains the queue, rejects every parked waiter, and rejects `next()`. New exported `SubscriberOverflowError` (`ERR_PRISM_SUBSCRIBER_OVERFLOW`) carries `sessionId`, `droppedEvents`, and `maxQueuedEvents`. A host's `for await` fails loudly instead of seeing a synthetic event mid-run.
    3. **`package.event` from a kernel module uses `package: "kernel"`.** Names are `guardrail.decision`, `steer.rejected`, `attention.compiled`, `agent.step`, `tools.clamped`.
    4. **Not in Task 1's list: `turn.started`/`turn.completed` are emitted once per provider attempt, by the provider round only.** Task 1's mapping folded both the loop's `turn_started`/`turn_finished` and the provider's `provider_turn_started`/`provider_turn_finished` onto the same two names, which would have emitted two pairs per turn with different payloads — unreadable for a host and wrong for a frozen catalog. The loop's pair was redundant bookkeeping (the provider attempt carries the turn number *and* the usage §2.3's "turn.completed (with usage)" implies). `RunController` now calls a new `internals.onTurnStart(turn)` instead of emitting, so `session.activeLoopTurn` still tracks the loop's counter. `turn.started`/`turn.completed` therefore carry **required** `metadata`.

    #### What changed

    | Area | Change |
    | --- | --- |
    | `src/contracts-protocol.ts` | `AgentEventPayload` rewritten: 45 members → the 23 §2.3 names. Folds add fields (`run.completed.status`, `tool.completed.status/reason/error`, `turn.*.metadata/usage/error`, `run.failed.limit/attribution`, `compaction.completed.error`, `run.started.resumed/restore`, `turn.started.attempt/retry`). `DelegatedAgentStep` → `DelegatedAgentStepData`. |
    | `src/hooks/catalog.ts` | `OBSERVE_HOOKS` re-keyed to the 23 names. |
    | `src/agent-session/session/assemble.ts` | `run.started` carries `resumed`/`restore`; the failure path emits one `run.failed` with `limit`+`attribution` (the `onExceeded` callback now only aborts); `attention.compiled` and `tools.clamped` go out as `package.event`; `resolveAskDecisions` emits `decision.resolved` inline. |
    | `src/agent-session/session/tool-round.ts` | `stageAskDecisions` emits `decision.pending`. |
    | `src/agent-session/session/provider-round.ts` | `turn.started`/`turn.completed` own the turn; `retry_scheduled` folded; `message_started` emissions deleted. |
    | `src/agent-session/session/persist.ts` | `run.completed` carries `status` (`completed`/`stopped`) and `stopReason`. |
    | `src/agent-session/session.ts` | `queue_updated` and `steer_rejected` removed (the latter re-homed); `agent_denied` → `decision.resolved` (`via: "resume"`); `compaction_failed` folded; `resumeDurable` emits the resume-side `decision.resolved`. |
    | `src/agent-session/event-subscriber.ts` | Overflow rejects the iterator; `SubscriberOverflowError` added. |
    | `src/loop/run-controller.ts` | The loop's turn pair removed; `onTurnStart` added. |
    | `src/tools.ts` | All three tool outcome sites emit `tool.completed` with `status`. |
    | `src/guardrails.ts`, `src/evidence-grounding.ts`, `src/delegated-agent-step.ts` | Emit `package.event`. `createDelegatedAgentStep` returns the envelope and validates the same bounded payload as `data`. |
    | `src/agent-event-source.ts` | `isTerminalAgentEventType` is `run.completed \|\| run.failed`. |
    | `src/index.ts` | Exports `EventSubscriber` and `SubscriberOverflowError`. |
    | `packages/prism-core` | `timeline.ts`, `instrumentation.ts`, `webhooks.ts`, `supervisor.ts`, `curate.ts` migrated; the timeline opens its turn step lazily from the provider attempt and closes it on the next turn or run end; `createDeterministicTurnScorer` retired. |
    | `packages/ag-ui`, `packages/prism-code`, `packages/prism-coding-tools`, `packages/prism-channels`, `packages/memory` | Every consumer migrated (mappers, TUI reducer, dev inspector, supervisor bridge, runtime preview, tests). |
    | Docs | `docs/next/events.md` new (one row per event); `docs/next/hooks.md` observe section; `CHANGELOG.md` carries the full mapping table. |

    #### Verification

    - `npx tsc -p tsconfig.json --noEmit`: clean.
    - `node scripts/release.mjs gate`: `{"updated": false, "packages": 14}` after `--update-baseline` (28 baseline files changed, `arnilo__prism.txt` +299/-232, the rest package `.d.ts` name churn).
    - `bun test --path-ignore-patterns='dist/**' src/`: **19 unique failures, 18 of them the identical pre-existing set** measured before this task began. The 19th is `packed-install host-composition compatibility`, which expects the fixture name `policy-chain-snapshot` while the workspace has `hook-chain-snapshot` — a prior-phase rename, unrelated to events.
    - Retired-literal sweep over `src/ packages/ examples/ scripts/ docs/next/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`, released `/docs` pages, `CHANGELOG` history, and `scripts/compat-baseline/`) returns no retired name except: the released-page pins in `src/__tests__/docs.test.ts` (deliberate — those pages document 0.12.1), the historical `scripts/plan-review-gate.test.mjs` evidence strings, and `examples/autonomous-coding-loop.ts`'s local error code `"budget_exhausted"` (not an event).

    #### Deviations and amendments

    - **`createDeterministicTurnScorer` retired.** It counted timeline steps of kind `deterministic`, which only the removed event produced. A no-model turn is no longer distinguishable in the timeline (a `model.call` hook that answers without the adapter still goes through the provider round, which reports *estimated* usage), so the scorer had no honest signal left. `DeterministicTurnScorerOptions`, `createDeterministicTurnScorer`, their export, and their two tests are deleted. Recorded for Phase 11's export review.
    - **`docs/agent-events.md` and the other released `/docs` pages keep the 0.12 names**, per the plan. Two `docs.test.ts` pins over them were reverted to the old literals when the rename script had changed them; the pins over `examples/neuralwatt-agent-run.ts` (a live example) keep the new names.
    - **`tool.completed.toolCallId` and `.name` are optional.** `result.toolCallId`/`result.name` already carry them, and requiring both would have forced ~50 test fixtures to repeat them. `status` is required.
    - **`packages/prism-providers` needed an unrelated fix to build**: fourteen `*.test.ts` files imported `type AuthMethod` from `@arnilo/prism`, which neither HEAD nor this branch exports. The unused import was removed so `bun run build` could reach the packages that Task 3 does touch.

    #### Findings for later tasks

    - **Prism Code's source still has pre-existing type errors** (`@arnilo/prism-agent-sdk` exports no `Agent`; `@arnilo/prism-coding-tools/agent` exports no `TodoContinuationHandler`/`registerTodoContinuation`; `AgentSdkDefinition.session`; `AgentSdkConfig.contextSources`). They predate Task 3 and are Part B's (`plan 149`). Its *tests* pass.
    - **`host-step-loop-timeline` and the other examples resolve `@arnilo/prism-core` from `dist/`.** A kernel-only rebuild is not enough: `bun run --filter @arnilo/prism-core build` (and the sibling packages) must run before the example tests, or they see the previous event shapes.
    - **`bun test src/` collects `dist/**/*.test.js` once any package has been built.** Use `--path-ignore-patterns='dist/**'` (as the package test scripts already do) or the run more than triples and gets killed.

- [x] Task 4: `principal` replaces `identity`; no kernel path synthesizes an identity
  - Acceptance Criteria:
    - Functional: `AgentConfig.principal?: Principal` and `RunOptions.principal?: Principal` are opaque to the kernel. The kernel passes them through to `SessionContext.principal`, hook payloads, and tool contexts, and never reads, verifies, or defaults them.
    - Functional: `AgentConfig.identity` and `RunOptions.identity` are deleted, with no alias. So are `resolveRunIdentity` and every other kernel read of identity from Task 1(f). The `tool-round.ts` decision scope uses `principal?.id`.
    - Functional: `ToolEffectStore` stops requiring a kernel-synthesized identity. `ToolEffectKey.identity` is dereferenced unguarded (`src/tool-effects.ts:59`, `:272`) and is the record key (`:369-373`); once the kernel read is gone it is unsatisfiable. The claim keys on `ownership` instead and its `identity` field is removed. `effectStore` is a deferred field whose owning phase is 6, but this task makes the edit unavoidable.
    - Functional: The agent SDK's required `identity` and its `"local-operator"` profile (`packages/agent-sdk/src/define-agent.ts:102-187`) are deleted. `defineAgent` takes an optional `principal`. Prism Code's `flags.test.ts`, `examples/agent-sdk-coding.ts`, and the agent SDK tests migrate.
    - Functional: `createSecureAgent` keeps its identity verification at creation, per Task 1(f), and passes its verified `identity.principal` object on as `principal` (the existing `Principal` shape, not the full `AgentIdentity`). `src/identity.ts` leaves the root kernel barrel if Task 1 finds no kernel caller left. In that case it stays reachable from the secure-agent path until Phase 9 moves it to `@arnilo/prism-governance`. Record this under Further Actions.
    - Functional: The repo-wide grep over `src/ packages/ scripts/ examples/ docs/` (exclusions as in Task 3) for `local-operator`, `resolveRunIdentity`, and `identity:` inside `createAgent`/`RunOptions` literals returns only `createSecureAgent`, `packages/prism-core` governance, and released `/docs`. Each remaining hit is listed in the task note. Per Task 1(f) the sweep covers **15 sites**, not every `identity:` line: `packages/acp-agent/src/index.ts`, `packages/prism-code/src/acp.ts`, `packages/prism-core/src/runtime/supervisor/supervisor.ts`, `examples/{agent-sdk-coding,behavior-evaluation,execution-timeline,messaging-agent,messaging-outbox,model-router-aggregate-budgets}.ts`, and 8 `scripts/fixtures|phase*` files, plus the agent SDK's own `identity` field and its 5 test files. `AgentIdentity` the *type* stays in the barrel — 130 files reference it and packages own their uses.
    - Performance: n/a — removes a per-run resolution.
    - Code Quality: `Principal` is the existing type (`src/identity.ts:4`), moved to the kernel module that owns agent config if `identity.ts` leaves the barrel. No new identity type.
    - Security: The kernel performs no identity check, which is the §2.1 safety-floor boundary. Packages that need a verified identity enforce it. A test proves that a run with no `principal` never sees a synthesized one, in `SessionContext`, tool contexts, events, or stored entries.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 3 ("`principal` is opaque and optional"; Done: "No kernel path synthesizes an identity"), §2.3, §2.9 (`governance` owns identity verification), and Part 3 (plan 142's `"local-operator"` becomes an opaque `principal`)
      - `src/identity.ts`, `src/agent-session/session/assemble.ts:659,684`, `src/agent-session/session/tool-round.ts:56-131,410-418`, `src/secure-agent.ts`, `packages/agent-sdk/src/define-agent.ts:102-187`
    - Options Considered:
      - Move `identity.ts` into a governance package now. Rejected: Phase 9 creates `@arnilo/prism-governance`, and moving it now would create the package ahead of its phase.
      - Keep `identity` as a kernel field and add `principal` beside it. Rejected: two identity inputs, one of them verified by the kernel, contradicts the Done criterion.
    - Chosen Approach:
      - Delete the kernel reads, thread `principal` through untouched, and keep verification in the existing non-kernel secure-agent path until Phase 9.
    - API Notes and Examples:
      ```ts
      await createAgent({ model, principal: { kind: "user", id: req.user.id } }); // opaque; packages enforce
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-protocol.ts`: fields.
      - `src/identity.ts`, `src/agent-session/session/assemble.ts`, `src/agent-session/session/tool-round.ts`, `src/agent-session/session/types.ts`, `src/secure-agent.ts`, `src/delegated-agent-step.ts`: reads.
      - `src/tool-effects.ts`: the `ToolEffectStore` claim key moves from `identity` to `ownership`.
      - `src/hooks/types.ts` / `SessionContext`: `principal`.
      - `packages/agent-sdk/src/define-agent.ts` and its tests. `packages/prism-code/src/__tests__/flags.test.ts`. `examples/agent-sdk-coding.ts`.
      - `packages/prism-core` governance and workflow readers from Task 1(f).
      - `src/__tests__/docs.test.ts`: the `local-operator` pins, if any remain.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/arnilo__prism.txt`, `arnilo__prism-agent-sdk.txt`, `arnilo__prism-code.txt`, `arnilo__prism-core.txt`: regenerate, with the diff and attribution in the task note.
      - `docs/next/agent.md`: new, with the `principal` section. `CHANGELOG.md`.
    - References:
      - plan 142 Task 5 (`"local-operator"`), plan 146 Task 1 A1 (`principal` left to Phase 3)
  - Test Cases to Write:
    - `no_kernel_path_synthesizes_an_identity`: a run without `principal` exposes none anywhere, including the stored entries.
    - `tool_effect_claims_stay_scoped_by_tenant_after_identity_is_removed`
    - `principal_passes_through_to_session_context_and_tool_context_unchanged`
    - `run_principal_overrides_agent_principal`
    - `define_agent_rejects_unknown_identity_profile_field`: a config error, because the field is gone.
    - `secure_agent_still_verifies_identity_and_forwards_principal`
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — removes `identity` and adds `principal`.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: new, API page structure. It starts with `AgentConfig` and `principal`. Task 5 and plan 149 extend it.
      - `packages/agent-sdk/README.md`: remove `"local-operator"`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-03):

    #### Implementation

    - `AgentConfig`, `RunOptions`, `DispatchToolCallOptions`, and `ToolExecutionContext` now carry optional `principal: Principal`. No identity alias remains. `activePrincipal` selects the run value before the agent default, without verification, ownership inference, or identity telemetry. Cleanup clears it. Cached `SessionContext` views expose a getter so each run's override is visible to hooks, predicates, commands, and package tools without stale references.
    - Deleted `resolveRunIdentity` and its root export. `decisionPrincipalRef` replaces `decisionIdentityRef` and returns only `principal?.id`. The persisted decision-scope field remains `identity`; its value is now the opaque id, not `tenant:kind:id`. Existing tool/arguments/effect constraints still apply. Legacy sticky scopes fail to match rather than widening approval.
    - `ToolEffectKey` no longer requires identity. Derived keys and memory-store partitions use explicit tenant/account/user ownership. Ownership is bounded even for optional/tool-managed effects without a store; required ownership/store checks, claim tokens, CAS versions, result caps, and unknown-outcome reconciliation remain. The conformance helper no longer synthesizes a test identity.
    - Migrated PostgreSQL effects, forge, MCP Apps, supervisor/workflow runs, MCP dispatch, channels, ACP, Prism Code, examples, and live script fixtures. Local ACP/Prism Code hosts now explicitly supply tenant `local` in ownership and an opaque user principal, instead of fabricating a verified identity. Package-owned identities and verifiers remain package-owned.
    - `defineAgent` takes optional `principal`, forwards it unchanged, and rejects the retired `identity` field before assembly. Deleted its required identity/profile resolver and migrated its fixtures. `createSecureAgent` still verifies identity and ownership at creation, then forwards the same `identity.principal` reference. `HostCompositionOptions.identity` supplies verified identity explicitly for opt-in host-composition checks, rather than reading it from ordinary `AgentConfig`.
    - Added `docs/next/agent.md`, updated the SDK README and Unreleased changelog, and regenerated compat baselines.

    #### Amendments and safety boundaries

    - **Type correction:** the plan said to forward the entire verified identity as `Principal`. `AgentIdentity` has no top-level `kind`/`id`, so it does not implement the existing `Principal`. Forward `identity.principal`, after verifying the entire identity. No new type or cast is needed; the secure-agent regression pins reference equality.
    - **Verification stays at package boundaries.** Channels check authorized identity against the selected agent's ownership before running; secure agents retain their fixed ownership. Forge and MCP Apps explicitly verify identity before effects because the shared effect store no longer does that for them. MCP and supervisor keep their existing authorization checks. MCP Apps cannot infer verification from an opaque tool principal, so an effect store requires explicit verified `effectContext`; absence fails closed. This is documented and covered by expiry/no-dispatch regressions.
    - **PostgreSQL schema not rebuilt ahead of Phase 6.** Its existing non-null `principal_id` column uses a fixed empty partition. A valid legacy principal cannot be empty. Before a new claim, the adapter rejects an old identity-partitioned row for the same owner/session/run/tool-call, preventing silent replay after key derivation changes. Maintenance cleanup uses the empty partition too. Stop old writers and reconcile outstanding legacy effects before upgrading affected runs; never run both writer generations concurrently. Offline tests cover legacy rejection before INSERT and decoding the new partition; live PostgreSQL tests were skipped without `PRISM_TEST_POSTGRES_URL`.
    - **Identity barrel retained for packages/opt-in governance.** `AgentIdentity` and verification/narrowing helpers still have public package callers; deleting them now would prevent packages from enforcing the boundary. Only the kernel run resolver is deleted. Phase 9 owns moving `identity.ts`, secure-agent, and host-composition governance out of the root.
    - **Small prerequisite:** removed a duplicate `run.failed` comparison in Prism Code headless left by Task 3. It was the final unrelated typecheck blocker; removing the redundant comparison changes no behavior and makes the full workspace typecheck green.

    #### Tests and verification

    - Tests written first in `src/__tests__/principal.test.ts`: no synthesized identity in hooks/tools/events/store; reference-identical principal pass-through; run override; cached session views across successive runs; tenant/account/user effect isolation and invalid ownership rejection. The initial red run demonstrated missing principal contracts and identity-required effects.
    - Secure-agent and SDK tests pin verified-principal forwarding, optional principal, and rejection of the retired profile field. PostgreSQL, MCP Apps, and forge regressions pin the package verification and persistence boundaries.
    - Final focused run: **446 pass / 0 fail across 15 files**, including principal, identity, effect store/conformance, secure-agent, host-composition, approvals/ask/durable resume, public exports, PostgreSQL offline store tests, supervisor, channel runtime, MCP Apps, and forge.
    - `bun run typecheck`: **exit 0**, including all workspace builds/typechecks and examples. Kernel `npx tsc -p tsconfig.json --noEmit` also passes.
    - `node scripts/release.mjs gate`: **exit 0**, `{"updated": false, "packages": 14}` after regeneration. Task-specific surface changes: remove `resolveRunIdentity` and `decisionIdentityRef`; add `decisionPrincipalRef`; replace config/tool identity fields with principal; remove effect-key/conformance identity; add explicit host-composition identity. SDK loses its required identity profile union. Whole working-tree baseline diffs include earlier uncommitted phases and must not be attributed wholly to this task.
    - Additional host suites: **53 pass / 3 fail**; the three failures are the already-recorded ACP spawned-bin SDK/stdio tests (`ACP connection closed` / timeout), not direct ACP calls, editor-FS dispatch, restart, flags, headless, or offline editing. SDK suite: **85 pass / 1 fail**, the previously recorded hooks-json registration-order case. No assertions were weakened to hide those failures.
    - Full `bun test --path-ignore-patterns='dist/**' src/` was attempted but **timed out at 350 seconds**, dominated by existing packaging/benchmark failures. It has no completion summary; no full-suite green claim is made.
    - `bun examples/distributed-events-and-tool-effects.ts`: exit 0 (completed replay, unknown outcome, operator reconciliation). `node --check` passes for all six edited live script files. PostgreSQL integration suite: **6 skip**, no live database configured.

    #### Retirement sweep

    - AST sweep of direct `createAgent`, `defineAgent`, `dispatchToolCall`, and key-derivation inputs finds no live retired `identity` field. Remaining direct inputs: `createSecureAgent` in `src/__tests__/host-composition.test.ts`, two `packages/prism-channels/src/__tests__/runtime.test.ts` fixtures, and `scripts/fixtures/e2e-070-host-completeness-journey.mjs`; plus the intentional rejected-field fixture in `packages/agent-sdk/src/__tests__/define-agent.test.ts`.
    - `resolveRunIdentity` has no source definition/caller/export. Its staged docs mention is migration guidance. `local-operator` survives only in the new absence assertion and released-page pins at `src/__tests__/docs.test.ts:4792,4825,4841`. Historical freeze manifests retain `decisionIdentityRef` as release evidence. Package-owned identity APIs (governance, credentials, connectors, channel authorization, delegation) are not kernel config aliases.

- [x] Task 5: `AgentConfig.tools`/`skills` and `RunOptions.tools` reshape; the kernel skills catalog as `kernel:context.build`
  - Acceptance Criteria:
    - Functional: `AgentConfig.tools` is `{ add?: readonly ToolDefinition[] }` and `AgentConfig.skills` is `{ dirs?: readonly string[]; add?: readonly Skill[]; disclosure?: "progressive" | "eager" }`. `disclosure` defaults to progressive and registers `load_skill`. `skills.dirs` reads through the same reader as `PackageAPI.skills.addDir`.
    - Functional: `RunOptions.tools` is `{ only?: readonly string[] }`. An unknown name fails closed, as `toolNames` did. The resume intersection keeps its semantics, and **the stored field keeps its name** — per Task 1(i), `StoredAgentRunState.toolNames` (`src/agent-run-state.ts:90`) stays `toolNames`. Renaming it is a silent fail-open: the durable fingerprint (`agentFingerprint`, checked at `src/agent-session/session/assemble.ts:638`) covers the agent definition and a host revision string, not stored field names, so an old store's grant would silently vanish and the resumed run would come back with the full tool set.
    - Functional: These are deleted with no alias:
      - `AgentConfig.tools` as a `ToolRegistry` or array
      - `AgentConfig.skills` as a `SkillRegistry` or array
      - `AgentConfig.skillsDisclosure`, `AgentConfig.activateAllSkills`
      - `RunOptions.toolNames`, `RunOptions.skillsDisclosure`, `RunOptions.activateAllSkills`
      - `RunOptions.skills` and `RunOptions.activeSkills`, if Task 1(g) finds them covered
    - Functional: The kernel skills catalog is a `kernel:context.build` registration (backlog "Decide the kernel skills catalog's owner"). It appears in `inspect().hooks`, and `disable.hooks` can name it. Per Task 1(h), `prefix_stability_holds_after_catalog_move` **cannot stay byte-identical**: `buildProviderMessages` (`src/input.ts:139`) runs inside `assemble()`, before `context.build` (`src/loop/run-controller.ts:156-160`), and the current view is `[stable, context, skills, declarations, dynamic]`. A `ContextDraft` write lands in the `stable` position, so skills move ahead of `context` blocks. **Pin the new expected bytes and record the old layout in the test's failure message.**
    - Functional: `tools.add` carries the duplicate-name check `src/secure-agent.ts:65` gets from `createToolRegistry(…, { duplicate: "error" })`, or the secure path weakens. `src/agent-session/runtime-registry.ts:92-95` (`agentToolList`) branches on `"list" in configured`, which becomes `agent.config.tools?.add`.
    - Functional: The `limits` floor is tested from both config levels: `AgentConfig.limits` is the floor, and `RunOptions.limits` only narrows it. Per Task 1(l) the name stays `RunLimits` — Phase 11's export-surface review owns 1.0 naming, and `resolveRunLimits` (`src/run-limits.ts:100`) already narrows every axis by `min`. `docs/next/agent.md` must note that `backgroundSettleMs` is agent-wide only: a per-run value is ignored (`src/contracts-core/run-limits.ts:29-33`).
    - Functional: Every caller migrates in this task: `createAgent` configs passing a `ToolRegistry`/`SkillRegistry`, and `RunOptions` users of `toolNames`. Per Task 1(g) there are **15 non-test registry-passing sites** — `src/secure-agent.ts:65`, `src/cli-runner.ts:513`, `src/testing/prefix-stability-conformance.ts:175`, `packages/agent-sdk/src/define-agent.ts:312`, `packages/agent-sdk/src/planes/skills.ts:107`, and 10 examples — so a codemod plus that list covers them. Then a repo-wide grep runs, with exclusions as in Task 3. **The `toolNames` pattern must be scoped to `RunOptions` literals, not the bare word:** 46 files contain `toolNames`, and most are the unrelated `Skill.toolNames` (`src/skills.ts`, `packages/memory/src/wiki/skills.ts`, `packages/prism-work/src/skills/load.ts`).
    - Performance: Tool and skill resolution stay per-agent and are not rebuilt per run. The `kernel:context.build` registration adds one handler call per turn, and nothing else.
    - Code Quality: One input shape per contribution kind. `ToolRegistry`/`SkillRegistry` stay internal to the kernel and are dropped from the public `AgentConfig`. If Task 1 finds no external caller, they also leave the root barrel.
    - Security: The tool-name collision between `tools.add` and package tools fails closed, as in plan 146. `skills.dirs` paths are host-supplied and read with the same containment as `addDir`.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.3 `AgentConfig.tools`/`skills` and `RunOptions.tools`, and §2.1 Skills
      - `src/contracts-core/agent.ts:53-80`, `src/contracts-protocol.ts:79-130`, `src/agent-session/session/assemble.ts:270,446`, `src/skill-disclosure.ts`, `src/testing/prefix-stability-conformance.ts`
      - plan 146 Task 3 (owner seam), Task 1 findings (g), (h), (i), and (l)
    - Options Considered:
      - Accept both the array and `{ add }` during the train. Rejected: §1.4 forbids aliases.
      - Defer the skills catalog move again. Rejected: the backlog item names this reshape as the trigger, and leaving it unnamed keeps it invisible to `disable.hooks`.
    - Chosen Approach:
      - Reshape in place with a codemod, then move the catalog onto the owner seam plan 146 built.
    - API Notes and Examples:
      ```ts
      await createAgent({
        model,
        tools: { add: [weatherTool] },
        skills: { dirs: [".agents/skills"], disclosure: "progressive" },
      });
      await session.run("go", { tools: { only: ["read", "grep"] } });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-protocol.ts`: shapes.
      - `src/agent-session/create-agent.ts`, `src/agent-session/session/assemble.ts`, `src/skill-disclosure.ts`, `src/skill-load.ts`, `src/tool-search.ts`: resolution.
      - `src/packages/loader.ts`: merged tool/skill view takes the host `add` lists.
      - `src/agent/inspect.ts`: host tools from `tools.add`.
      - Callers in every workspace and `examples/` per Task 1(g).
      - `src/testing/prefix-stability-conformance.ts`: only if Task 1(h) pins a byte change.
      - `src/__tests__/public-export-contract.test.ts`, and `scripts/compat-baseline/*.txt` for each touched workspace: regenerate, with the diff and attribution in the task note.
      - `docs/next/agent.md`: config sections. `docs/next/tools.md`: `tools.add` and `tools.only`. `CHANGELOG.md`.
      - `plans/backlog.md`: mark "Decide the kernel skills catalog's owner" delivered (at plan end).
    - References:
      - plan 146 Task 3 Notes, `plans/backlog.md:321-325`
  - Test Cases to Write:
    - `tools_add_registers_host_tools_and_collides_fail_closed_with_package_tools`
    - `skills_dirs_and_add_load_and_disclosure_defaults_to_progressive`
    - `run_tools_only_narrows_and_unknown_name_fails_closed`
    - `resume_intersects_tools_only_with_stored_grant`
    - `skills_catalog_is_a_named_kernel_context_build_registration`, which `disable.hooks` can remove.
    - `run_limits_only_narrow_the_agent_floor`
    - `prefix_stability_pins_the_new_skills_catalog_bytes` (the old layout appears in the failure message)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentConfig` and `RunOptions` fields.
    - Docs pages to create/edit:
      - `docs/next/agent.md`: `AgentConfig` field table (the fields this plan reshapes, plus the deferred fields with their owning phase).
      - `docs/next/tools.md`: `tools.add` and `tools.only`.
      - `CHANGELOG.md`: Unreleased.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

  - Notes (executed 2026-10-03):

    **Shape.** `AgentConfig.tools` is `{ add?: readonly ToolDefinition[] }`; `AgentConfig.skills` is `{ dirs?: readonly string[]; add?: readonly Skill[]; disclosure?: "progressive" | "eager" }`; `RunOptions.tools` is `{ only?: readonly string[] }`. Deleted with no alias: `AgentConfig.activateAllSkills`, `AgentConfig.skillsDisclosure`, `RunOptions.toolNames`, `RunOptions.skills`, `RunOptions.activeSkills`, `RunOptions.activateAllSkills`, `RunOptions.skillsDisclosure`. `ToolRegistry`/`SkillRegistry` stay exported (external callers remain: agent-sdk, prism-code, examples) but no longer appear in `AgentConfig`.

    **Resolution.** `agentToolList`/`agentSkillSource`/`activeTools`/`agentFingerprint`/`run-bundle` read the `add` arrays. `createAgentWith` resolves `skills.dirs` once per agent through the same reader as `PackageAPI.skills.addDir`, producing an effective config (only when `dirs` is set, so existing configs are unchanged). `loadPackages` validates `tools.add`/`skills.add` duplicates with `createToolRegistry`/`createSkillRegistry(…, { duplicate: "error" })`; `createSecureAgent` now passes `{ add: options.tools }` and relies on that check. New `resolveAllActiveSkills` validates every configured skill's `toolNames` against the run's tools without rebuilding a registry.

    **Skills catalog.** New `src/skills-catalog.ts` registers `kernel:context.build` via `hooks.registrar("kernel")`. `assembleProviderInput` renders skills into a per-request `WeakMap` keyed on the request (`deferSkillsCatalog`) instead of into messages; `draftFromRequest` carries that state on the draft via a symbol, and the handler renders the catalog at the stable-prefix boundary. The registration appears in `inspect().hooks` and `disable.hooks: ["kernel:context.build"]` removes it; `createAgent`'s `dispose` calls `hooks.removeOwner("kernel")`. Progressive disclosure registers `load_skill` during assembly (`createLoadSkillTool` over the run's active skills); the registry is built with `{ duplicate: "error" }` so a host tool named `load_skill`/`search_tools` fails the run closed. The SDK's own `load_skill` bridge was removed (kernel owns it) and it keeps a live `tools.add` array so MCP `reconnect` swaps are still visible.

    **Turn-ordering / bytes.** Skills now render ahead of context blocks: `[stable, skills, context, declarations, dynamic]` (was `[stable, context, skills, declarations, dynamic]`). `src/testing/prefix-stability-conformance.ts` gained `skillsDisclosure`, and `src/__tests__/prefix-stability-conformance.test.ts` passes it; no byte-identical claim is made.

    **Tests.** New `src/__tests__/agent-config-shapes.test.ts` (7 pass): `tools_add_registers_host_tools_and_collides_fail_closed_with_package_tools`, `skills_dirs_and_add_load_and_disclosure_defaults_to_progressive`, `skills_catalog_is_a_named_kernel_context_build_registration`, `run_tools_only_narrows_and_unknown_name_fails_closed`, `host_load_skill_collision_fails_closed_under_progressive_disclosure`, `resume_intersects_tools_only_with_stored_grant`, `run_limits_only_narrow_the_agent_floor`.

    **Deviations / findings for later tasks.**
    - `RunOptions.skills`/`activeSkills` are deleted (Task 1(g) covered them); per-run skill narrowing has no 1.0 replacement. Callers migrated: `cli-runner`, `packages/memory` wiki ingest (the host now activates `wiki-maintainer` on the agent it starts), `packages/prism-code` TUI/observational-memory, and 4 examples.
    - `RunBundleSnapshot.activeSkills` now lists the effective skill names (no per-run narrowing to report); its golden digest was re-pinned. `agentHookIds` now includes `kernel:context.build`, so the durable fingerprint covers the catalog registration. `run-bundle`/`ask-resolution`/`package-loader`/`package-contributions`/`agent-hooks`/`create-agent-async` pins were updated for the extra registration.
    - Fixed a Task 3 regression found while verifying examples: `packages/prism-core`'s `tool.completed` timeline fold checked only top-level `event.error`, so a tool that *returned* an error result scored `succeeded` (0.12 checked `result.error`). Now `Boolean(event.error) || Boolean(event.result?.error)`. This also unblocked the `denyTools`/`unknownEffect` eval scenarios and `examples/behavior-evaluation.ts`.
    - `docs/next/agent.md` gained the `tools`/`skills` fields and the limits/`backgroundSettleMs` note; `docs/next/tools.md` gained the host-tools + `RunOptions.tools.only` section. `CHANGELOG.md` has a leading breaking-change entry.
    - Compat baselines regenerated (`{"updated": true, "packages": 14}`, 20 files; `arnilo__prism.txt` +239/−67) and the gate re-run clean (`{"updated": false, "packages": 14}`).

    **Verification.** Kernel `npx tsc -p tsconfig.json --noEmit` clean; `bun run typecheck` clean across every workspace and `examples/`; `bun run build` exit 0. Kernel-only `bun test src/__tests__/*.test.ts`: 2210 pass / 15 fail, all pre-existing (5 docs, field-policy microbenchmark, 3 optional-package setup, 3 packaging guard, packed-install, `resolveAgentBundle` missing-tool, install-smoke npm-pack flake). Package suites: agent-sdk/memory 160 pass / 1 pre-existing; ag-ui/prism-core/prism-coding-tools/prism-channels/acp-agent/prism-work/web-tools 11 fail, all pre-existing (bin-spawn/stdio, `createDocumentReader`, `createPrismHandler` old `message_delta` assertion, inspector/timeline fixtures, sqlite-under-node). 14 touched examples run to completion.

### Task 5 failed attempt and verified recovery (2026-10-03 — recovery record; task later completed)

- **Assistant-authored codemod was faulty:** `/tmp/task5-codemod.cjs` used `edits.sort((a,b)=>b-a)` on tuple arrays rather than sorting numeric start offsets. It changed 108 files; shifted offsets overwrote adjacent source and produced 753 kernel diagnostics. The attempted Task 5 implementation was not completed.
- **Recovery completed, without resetting the working tree.** Reconstructed source in `/tmp/prism-task5-recovery/replay/` from an isolated copy of the existing stash plus chronological source edits/transformation scripts recorded in Pi session history. All 107 replayed codemod targets matched their pre-task SHA-256 in the preserved graft extraction cache. The remaining `host-ui.test.ts` had one intact shaped-property edit; reversing that edit also matched its pre-task SHA-256 exactly.
- Restored all 108 codemod targets and reversed the 13 earlier partial kernel edits: **121 existing files now match pre-task SHA-256 byte-for-byte**, retaining completed Tasks 1–4 and earlier uncommitted phases. Preserved the two new Task 5 files (`agent-config-shapes.test.ts`, `skills-catalog.ts`) outside the repository before removing them. Compared the rest of the recovery archive: **2,325 other files unchanged, zero unexpected changes**. This is a full rollback of the failed Task 5 attempt, not a claim that Task 5 shipped.
- Verification: kernel `npx tsc -p tsconfig.json --noEmit` passes; full `bun run typecheck` passes across all workspaces/examples; focused identity/effects/tool-narrowing/host suites **92 pass / 0 fail**; affected agent/durable/package/approval/prefix/export suites **424 pass / 0 fail**; `node scripts/release.mjs gate` returns `{ "updated": false, "packages": 14 }`.
- Evidence/scripts preserved under `/tmp/prism-task5-recovery/`: `restoration-manifest.json` records restored hashes; `verification.json` records the unchanged-file audit; `before-restoration/` and `working-files.tar.gz` preserve damaged/partial source; replay scripts and check logs document recovery. Before retrying Task 5, save exact per-file originals and edit metadata, sort by `b[0] - a[0]`, reject overlaps, and verify each small batch. Do not use a whole-tree reset/checkout/stash on this uncommitted refactor.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run build && bun run --workspaces --if-present test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun test --timeout=0 src/__tests__/hook-catalog-freeze.test.ts src/__tests__/package-api-freeze.test.ts src/__tests__/kernel-imports-no-package.test.ts src/__tests__/public-export-contract.test.ts src/__tests__/packaging.test.ts`
- `bun examples/define-package.ts && bun examples/custom-loop.ts`
- The Task 3 and Task 4 `rg` sweeps, which return only the listed residue.
- `node scripts/release.mjs gate`

## Compromises Made

- Task 1 is read-only, as scoped. The two events with no §2.3 home (`retry_scheduled`, `event_subscriber_overflow`) are **not resolved** — they are recorded as roadmap conflicts with a recommended fold each, and Task 3 is explicitly blocked on the user's ruling rather than proceeding on an invented name. Same for the `package.event` `package` naming convention for kernel-owned module events.
- Task 4 edits `ToolEffectStore`, which is a deferred field owned by Phase 6. It has to move now because the kernel loses the only identity it could key on; the alternative is a contract that nothing can satisfy.
- Task 5 keeps the persisted `StoredAgentRunState.toolNames` wire name. This is a deliberate deviation from the plan's stated default, because the default's justification (a fingerprint that fails closed on drift) does not hold: the fingerprint never covered stored field names.
- Task 5 removes `RunOptions.skills`/`activeSkills` with no 1.0 replacement: roadmap §2.3 has no per-run skill narrowing. `RunBundleSnapshot.activeSkills` now reports the effective skill names rather than a run-narrowed set.
- Task 5 also fixed a Task 3 regression it exposed: the prism-core `tool.completed` timeline fold read only top-level `event.error`, so a tool that *returned* an error result scored `succeeded`. It now also reads `event.result?.error`, matching 0.12.
- Two Task 3 migration misses remain outside Task 5's scope and keep the tree not fully green: package tests still assert retired event names (`packages/prism-core/src/runtime/server/__tests__/server.test.ts` `message_delta`, `packages/prism-code/src/__tests__/reducer.test.ts`, `packages/ag-ui/src/__tests__/acp-lifecycle.test.ts`, provider tests), and `packages/prism-coding-tools/src/dev/__tests__/ui.test.ts`'s malformed-payload assertion expects a note from a payload that returns early.

## Further Actions

- Task 4 / Phase 9: move `identity.ts`, `secure-agent.ts`, and host-composition governance into the governance package; public identity helpers remain necessary for existing package verifiers until then.
- Task 4 / Phase 6: retire PostgreSQL effects' reserved empty `principal_id` partition with the store schema work. Preserve the legacy-claim fail-closed guard and reconcile old claims before switching writers.

- **Resolved during execution, no user ruling needed:** Task 3 shipped on the recorded recommendations — `retry_scheduled` folds into `turn.started` (`attempt` + `retry`), `event_subscriber_overflow` is removed (the iterator rejects with `SubscriberOverflowError`), and kernel-owned module events use `package: "kernel"` with namespaced names. The two stale "User decision needed before Task 3" bullets are cleared.
- Task 5 / later: move the remaining agent-sdk kernel-behavior tests to `src/__tests__` per Task 1(j) (skills-dir discovery, compaction passthrough, MCP denied-allow fail-closed).
- Task 5 / Task 3 leftovers: migrate the package tests still asserting retired event names, and re-examine the prism-coding-tools malformed-payload timeline assertion.
- Phase 6 owns `AgentConfig.store` reaching the store slot. Today it is the one slot the runtime never resolves (`src/agent-session/session.ts:450` against `src/slots/defaults.ts:26`), so a package that claims `store` is silently ignored by `createSession`. Part B Task 2 fixes the session path; the slot contract itself is Phase 6's.
- Phase 5 owns `AIProvider.models()` and the `CredentialResolver.store` implementation. Until then `agent.models.list()` is effectively a single entry and the default credentials slot answers `unavailable` to a `secret` request — both fail closed, both are visible in `docs/next/`.
- Phase 12 turns Prism Code's OAuth and credential prompts into `host.ui` callers. Today they never touch `HostUi` (`packages/prism-code/src/credentials.ts`, `providers.ts:7`), so Task 2 has nothing to migrate there.
- Phase 9 owns the `package.event` re-homed module events (`guardrail_decision`, `steer_rejected`, `delegated_agent_step`) moving to their owning packages.
