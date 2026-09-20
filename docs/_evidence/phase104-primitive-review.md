# Phase 104 — Primitive Review: Pack Durability, `ask` Suspension, Refusal Text, Subscriber Ownership

Plan: [104-Execution-Guardrail-Packs-Follow-Ups.md](../../plans/104-Execution-Guardrail-Packs-Follow-Ups.md) Task 1.
Date: 2026-09-20. Baseline: `0.9.0` working tree, HEAD `f6b1da81` (same baseline plan 102/103 Task 1 reviewed).
The tree carries the in-flight plan 102/103 edits (`src/agent-session/session.ts`, `provider-round.ts`,
`context-budget.ts`, `contracts-core/agent.ts`, `contracts-core/provider.ts`, `testing/*`, tests); no pack
code is touched by them, but they shift line numbers after the session constructor. Every span below was
verified in this tree, so a plan span that no longer matches is called out inline.
Scope: **read-only inventory**. This document is the gate for Tasks 2–7: every later task reuses a row
below as-is, extends one additively, or adds the named new surface. No task may open a seam this file
does not map.

Cite convention: `covers:` spans are `file:Lstart–Lend` verified in this tree. Every `reuse:` row names the
exact exported symbol (or the exact module-private seam the later task calls). Every `gap:` row names the
file that would have to change. Every `reject:` row names the task it would have affected.

Source of the work: plan 092 `Compromises Made` + `Further Actions`
([092-Execution-Guardrail-Packs.md](../../plans/092-Execution-Guardrail-Packs.md)), plus the current
contracts in `docs/guardrails.md`, `docs/durable-runs.md`, `docs/agent-session-runtime.md`,
`docs/agent-events.md`, `docs/options-index.md`.

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Task 2 — pack durability (refs + observed state ride the checkpoint)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/guardrails.ts:L146–L160` | `compileGuardrailPacks(refs, registry?)` | One call compiles refs to `Guardrails \| undefined`; the per-pack `state` object is created at `:L155` and captured by the closures (`ruleGuardrail`, `observeGuardrail`). It is never returned, so it is unreachable outside the compile. Task 2 extends this with an internal `compileGuardrailPacksWithState` that returns `{ guardrails, state }` and keeps this signature. |
| `src/guardrails.ts:L29–L30` | `MAX_GUARDRAIL_PACKS` (8), `MAX_GUARDRAIL_PACK_RULES` (64) | Existing compile-side config bounds; the durable restore bound must match `MAX_GUARDRAIL_PACKS`. |
| `src/guardrails.ts:L184–L234` | `resolveGuardrailPacks` (module-private) | Validates ref shape, duplicate pack ids, unknown id against the installed registry, version positivity, rule count/dupes, and calls `definition.build(Object.freeze({...input.options}))`. The restore path reuses exactly this to recompile. |
| `src/guardrails.ts:L236–L291` | `resolveRule` (module-private) | Compiles patterns once; `:L245` currently rejects any action other than `deny`/`tripwire` — the exact line Task 3 changes. |
| `src/guardrails.ts:L293–L313` | `ruleGuardrail` (module-private) | The `tool_input` evaluator; emits `metadata: { pack, rule, version }` on a match (`:L308–L310`) while the guardrail name stays `pack:<pack>/<rule>`. Task 3's rule identity should mirror this shape, not invent a second one. |
| `src/guardrails.ts:L315–L329` | `observeGuardrail` (module-private) | The `tool_output` recorder: `observe(state, result, context)`, never denies. This is the only writer of pack state. |
| `src/guardrails.ts:L119–L124`, `:L163–L174` | `GuardrailPackRow`, `describeGuardrailPacks(refs, registry?)` | Stable identity rows (`pack:<pack>/<rule>`, stage, `pack@version`) for run bundles. Reused as-is by Task 2 (restored refs must feed it) and Task 7 (walkthrough prints rows). |
| `src/guardrail-packs/types.ts:L5–L18` | `GuardrailPackRules.observe` (and `rules`), `GuardrailPackDefinition` (`id`, `version`, `description`, pure `build`) | The type Task 2 extends with an optional pack-owned state codec. |
| `src/guardrail-packs/validation-respect.ts:L34–L55` | `validationRespectPack` | The one built-in with real state: `observe` writes `state.validationFailed` at `:L44`, the rule denies on `context.state.validationFailed !== undefined` at `:L51`. Task 2 is the only pack that needs a codec; the other three are stateless. |
| `src/guardrail-packs/index.ts:L8–L20` | `BUILT_IN_GUARDRAIL_PACKS`, `BUILT_IN_GUARDRAIL_PACK_IDS` | The installed registry Task 2 validates `id`/`version` against. |
| `src/agent-run-state.ts:L72–L84` | `StoredAgentRunState.sessionState` | The opt-in bag: `loadedSkillNames`, `loadedSkillBodies`, `activatedToolNames`, `attentionSticky`, `attentionFold`. Task 2 adds `guardrailPacks` here. (The plan cites `63–80`; the bag starts at `:L72` in this tree.) |
| `src/agent-run-state.ts:L458–L505` | `validateSessionState` (module-private, called by `boundState` at `:L433`) | Fail-closed load/save validation for each key. Task 2 bounds every new field the same way, and must reject a pack-state envelope before it reaches a resumed run. (The plan cites `:407`; actual `:L458`.) |
| `src/agent-run-state.ts:L35–L36` | `DEFAULT_MAX_AGENT_RUN_STATE_BYTES` (256 KiB), `HARD_MAX_AGENT_RUN_STATE_BYTES` (1 MiB) | The two byte ceilings the pack state must respect; a lowered `maxStateBytes` refuses on write (`validateRunStateOptions` `:L190`) and the load bound is the hard cap (`:L432`). |
| `src/agent-session/session.ts:L248–L249` | constructor pack compile | `this.packGuardrails = compileGuardrailPacks(config.guardrailPacks)`; `this.guardrailPackRefs = config.guardrailPacks`. (The plan cites `:233`; actual `:L248` after the plan 103 meter cache.) |
| `src/agent-session/session.ts:L120`, `:L122` | `readonly packGuardrails?: Guardrails`, private `guardrailPackRefs` | The session's compiled packs and its retained refs. Task 2 needs a read path for both (refs are private today; `fork()`/`clone()` are the only readers). |
| `src/agent-session/session/persist.ts:L20–L66` | `persistDurable(session, state)` | Builds `sessionState` from the session and writes it through `saveAgentRunState` (which redacts at the boundary and enforces `maxStateBytes`). Task 2 adds the pack key inside the `persistSessionState` branch. (The plan cites `14–58`; actual `:L20`.) |
| `src/agent-session/session.ts:L210–L214` | `restoreLoadedSkillBodies` / `restoreLoadedSkills` precedent | The existing "validated at load, restored before the first turn" session hooks Task 2's `restoreGuardrailPacks(refs, state)` mirrors. |
| `src/agent-run-lifecycle.ts:L262` | `new RuntimeAgentSession({ agent, id, leafId })` | The resume rebuild — no `config`, so no `guardrailPacks`. Confirmed hole #1 below. (The plan cites `:219`; actual `:L262`.) |
| `src/agent-run-lifecycle.ts:L264–L296` | resume restore block | The ordered restore hooks (`loadedSkillNames` `:L267`, `activatedToolNames` `:L271`, `attentionSticky` `:L277`, `attentionFold` `:L285`, `loadedSkillBodies` `:L295`) that run **before** the pending-decision resolution at `:L305`/`:L307`. Task 2 inserts the pack restore at the top of this block, before any provider/tool turn. |
| `docs/agent-session-runtime.md:L208` | the authoritative `persistSessionState` paragraph | Documents the key set, `maxStateBytes`, and the fingerprint input list. Task 2 extends it with the pack keys and their bounds; it is also the reference for **G3** (fingerprint excludes session packs). |
| `docs/durable-runs.md:L26–L29`, `:L75` | checkpoint contents / option table | `persistSessionState`, `maxStateBytes`, and "each turn checkpoint carries … with `persistSessionState` — the loaded-skill catalog plus sticky attention frontier". Task 2 adds one per-pack cost line here. |

### 1.2 Task 3 — `ask`: selective durable suspension from a pack rule

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-core/guardrail-packs.ts:L8` | `GuardrailRuleAction = "deny" \| "tripwire"` | The type Task 3 widens. The doc comment on `GuardrailRule.action` (`:L31`) and `docs/guardrails.md:L103` both state `"ask"` has no deterministic seam and must be rewritten together. |
| `src/contracts-core/guardrail-packs.ts:L21–L46` | `GuardrailRule`, `GuardrailPackInput`, `GuardrailPackRef` | Rule vocabulary (`tool`, `pattern`/`deny`, `argPath`, `action`, `reason`) and the ref shape a pack `ask` rule arrives through. No new field is needed for matching. |
| `src/agent-session/session/tool-round.ts:L282–L300` | `bindChargeToolRound(ctx)` | The gate Task 3 extends: it charges `maxToolRounds`, then — only when `durable.options.interruptBeforeTool` — walks the calls, skips `matchStickyDecision` hits, and pre-binds a `{ entry, decision }` into `session.activeGatedRound`. This is data-only (no provider turn, no persisted predicate), and a matched `ask` rule adds one map entry on the same seam. |
| `src/agent-session/session/tool-round.ts:L87–L117` | `buildPendingDecision(session, call, approvalId, registry, runId, metadata, signal)` | Builds `scope` from the call (name, args hash, effect kind, identity) and a generic reason (`:L114`). Task 3 threads the matched rule identity/`reason` in here; the args hash means a decision can never apply to different arguments. |
| `src/agent-session/session/tool-round.ts:L51–L85` | `matchStickyDecision(session, call, registry)` | Exact-scope sticky match (`toolName`, `identity`, `argumentsHash`, `effectKind`, `actionConstraints`); `allow_for_run` therefore sticks without a second suspension. Reused as-is by Task 3. |
| `src/agent-session/session/tool-round.ts:L321–L429` | `bindDispatchToolCall(ctx)` | Dispatch prep: `reject_for_run` → refusal-shaped result; gated round → `approvalPending`; `beforeExecute` re-checks `matchStickyDecision` and suspends via `suspendDurable` with a single pending decision (`:L400–L432`). Task 3's non-durable block path belongs here or directly at the charge seam. |
| `src/contracts-run-state.ts:L27` | `AgentRunInterruptionKind = "input_guardrail" \| "tool_approval" \| "elicitation"` | The interruption vocabulary; an `ask` suspension reuses `tool_approval` rather than adding a kind. No change required — Task 3 keeps it closed. |
| `src/contracts-run-state.ts:L34–L68` | `DecisionScope`, `PendingDecision`, `AgentRunInterruption` | The redacted approval shapes. `PendingDecision.reason` is `string` and bounded/redacted; `DecisionScope` is where a bounded machine-readable rule identity would be added if the review shows the `pack:<pack>/<rule>` reason string is not enough for scoring. |
| `src/guardrails.ts:L42–L56` | `GuardrailError` (`ERR_PRISM_GUARDRAIL_BLOCKED` / `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`) | The current fail-closed outcome for a `tool_input` `interrupt`; Task 3 must not route pack `ask` through it (see **R3**). |
| `src/agent-session/session/assemble.ts:L263–L274` | input-stage interrupt suspension | The existing, working suspension precedent: `input` + `interrupt` + durable → `AgentRunSuspended` with an `input_guardrail` interruption; `approvedByResume` stops a re-suspend. Pack `ask` suspension should rewrite/route through the same `suspendDurable` shape at the tool stage. |
| `src/guardrails.ts:L104–L116` | `runGuardrails` emit loop | Every evaluated rule already emits a redacted `guardrail_decision` event with its `GuardrailRecord`. An `ask` match evaluated by the same compiler gets auditability for free; `recordGuardrailDecision` (`packages/prism-core/src/governance/policy/record.ts:L25`) is the standalone recorder the Task 3 eval leg reuses. |

### 1.3 Task 4 — refusal text naming the rule

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/tools.ts:L575–L598` | `blocked(call, context, reason, error, options, startedAt)` (module-private) | Emits `tool_execution_blocked` (reason code + `ErrorInfo`), appends the blocked tool-call record, returns `{ toolCallId, name, error }`. The one helper both stages route through — Task 4 derives the message here or at the call sites from the terminal record; no signature shape change beyond the derivation input. |
| `src/tools.ts:L211–L227` | `tool_input` stage | `runGuardrails` result; a terminal `block` calls `blocked(..., "guardrail_blocked", { message: "Tool call blocked by guardrail" }, ...)` at `:L227`. The terminal `GuardrailRecord` (`guardrail`, `reason`, `metadata`) is in scope one line above. |
| `src/tools.ts:L314–L331` | `tool_output` stage | Same shape at `:L331` for a blocked result (after `finishUnknownEffect` handling). |
| `src/contracts-core/run-limits.ts:L124–L130` | `GuardrailRecord` | `{ guardrail, stage, action, reason?, metadata? }` — `guardrail` is already the bounded `pack:<pack>/<rule>` name, `reason` is 4 KiB-bounded and redacted in `record()` (`src/guardrails.ts:L465–L480`), `metadata` is 16 KiB-bounded. Task 4's helper reads this record; it does not need the raw `GuardrailDecision`. |
| `src/tools.ts:L575–L598`, `:L596` | `appendToolCallRecord(options, "blocked", call, startedAt, { reason, finishedAt, result })` | The ledger/tool-call record keeps the machine code (`reason`) and the result — Task 4 must not put free text into the code path. |
| `src/redaction.ts` (`SecretRedactor`), `src/guardrails.ts:L475` | redaction at record creation | Reasons and error text are already redacted where records are built; Task 4 must keep the same redactor at the result/event boundary. |
| `docs/guardrails.md:L31`, `:L35`, `:L53` | refusal semantics | Documents that a tool `block` returns a redacted blocked `ToolResult`, that reasons are capped at 4 KiB, and that tool-output checks discard blocked raw output. Task 4's bounded identity line must fit under that cap. |

### 1.4 Task 5 — subscriber ownership (opt-in across-run subscriptions)

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/contracts-core/agent.ts:L216–L221` | `SubscribeOptions` (`maxQueuedEvents` default 1024, `overflow` default `"close"`) | The surface Task 5 extends with `acrossRuns?: boolean` (default `false`, additive). |
| `src/agent-session/session.ts:L322–L326` | `subscribe(options)` | Creates an `EventSubscriber` with a self-unregister callback and adds it to the session's private `Set`. The flag is consumed here. (The plan cites `:275–278`; actual `:L322`.) |
| `src/agent-session/event-subscriber.ts:L4–L71` | `EventSubscriber` | The whole queue implementation: array + waiter list, bounded by `maxQueuedEvents`, overflow `close`/`drop_oldest`/`drop_newest`, self-unregistering `return()` (`:L33–L37`) and `close()` (`:L67–L70`). No timer, no background task, no durable queue. Reused as-is; Task 5 only reads the flag. |
| `src/agent-session/session.ts:L592–L595` | `closeSubscribers()` | Closes and clears **every** subscriber; keeps its all-subscribers meaning (Task 5 adds a narrowly named `closeRunSubscribers()` for run end). (The plan cites `:543–546`; actual `:L592`.) |
| `src/agent-session/session/persist.ts:L237–L302` | `cleanupRun(...)` | Run teardown; calls `session.closeSubscribers()` in its `finally` at `:L300`. Task 5 switches this call to the run-scoped close. |
| `src/agent-session/session.ts:L370–L388`, `:L390–L408` | `recordDurableResumption`, `recordDurableDenial` | The other two run-end closes (`:L386`, `:L406`) — both must switch to the run-scoped close so a default subscription still ends at a suspension/denial while an across-run one survives. |
| `src/agent-session/session.ts:L418–L441` | `stream(input, options)` | Subscribes first (`:L420`), yields only that run's events, aborts on early return, and hands termination to the run-end close today. Task 5 makes it close its own subscription in `finally`; it currently holds the `AsyncIterable` view of `subscribe()`, so an internal subscriber-returning accessor (or a typed narrowing) is the small seam needed. |
| `docs/agent-session-runtime.md:L67`, `docs/agent-events.md:L13` | the long-lived `subscribe()` claim | Both already document `subscribe()` as long-lived across runs and `stream()` as single-run; today's run-end `closeSubscribers()` contradicts the former. Task 5 reconciles the docs and states the per-subscriber buffer cost (measured in §6). |

### 1.5 Task 6 — decision-time revalidation includes session pack rules

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/agent-approval.ts:L140–L212` | `resolveRunDecisions({ agent, state, decisions, signal })` | Validates a decision batch atomically, calls `validateModifiedArguments` for edits (`:L179`), builds sticky decisions (dropping `argumentsHash` for modified arguments at `:L195`). Task 6 threads an optional `guardrails` list in here. (The plan cites `:138`; actual `:L140`.) |
| `src/agent-approval.ts:L215–L255` | `validateModifiedArguments(...)` (module-private) | Bounded-JSON check, optional schema validator, then `runGuardrails({ stage: "tool_input", guardrails: agent.config.guardrails, ... })` at `:L235–L252`; a terminal record throws `ERR_PRISM_DECISION_INVALID` with a static message (`:L254`). Task 6 adds the session's compiled list; `runGuardrails` is already the merge point. (The plan cites `:213–259`; actual `:L215–L255`.) |
| `src/agent-run-lifecycle.ts:L305`, `:L307` | the two `resolveRunDecisions` call sites | Both run inside `prepareAgentRunResume` **after** the restore block, so once Task 2 restores packs the resumed session's compiled guardrails are available to pass here. |
| `docs/agent-session-runtime.md:L208` | "Prism CAS-claims approval before work, rechecks normal guardrail/permission/validation/limit paths" | The documented recheck list; Task 6 adds session pack rules to the decision-time path and `docs/durable-runs.md` to the approve-with-edits section. |

### 1.6 Task 7 — runnable guardrail-pack walkthrough

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `examples/README.md:L17–L86` | "Run a demo by hand" block (67 `node examples/…` rows) | The runnable list Task 7 appends one row to; Node 24 type-stripping is the documented runner, so a network-free example needs no new harness. |
| `docs/index.md:L236` | the `examples/` enumeration bullet | Where the new example is named. (The plan cites `:219`; actual `:L236`.) |
| `examples/behavior-evaluation.ts`, `examples/durable-loops-and-approvals.ts` | scripted provider + in-memory checkpoints | The two existing patterns the example reuses: `createMockProvider`/scripted turns for a network-free run, and `createMemoryCheckpointStore` with `resumeAgentRun` for the durable leg. |
| `packages/prism-core/src/governance/evals/trajectory.ts:L445–L500` | `createGuardrailPackScorer`, `DEFAULT_PACK_RULE_PREFIX` (`"pack:"`) | The eval scorer Task 7 grades with; it reads the `guardrail_decision` records the compile already emits. |

---

## 2. Gap rows (what no current seam does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | `compileGuardrailPacks` returns only `Guardrails`; the per-pack `state` object created at `src/guardrails.ts:L155` is unreachable, has no codec, and cannot round-trip. No pack declares how to snapshot/parse its own state. | `src/guardrails.ts`, `src/guardrail-packs/types.ts`, `src/guardrail-packs/validation-respect.ts` | 2 |
| G2 | Resume rebuilds the session with `new RuntimeAgentSession({ agent, id, leafId })` (`src/agent-run-lifecycle.ts:L262`) — no `AgentSessionConfig`, so `packGuardrails` and `guardrailPackRefs` are both `undefined`. Nothing in the restore block (`:L264–L296`) touches packs. **Confirmed runnable, §5.** | `src/agent-run-lifecycle.ts`, `src/agent-session/session.ts` | 2 |
| G3 | `agentFingerprint` (`src/agent-run-state.ts:L143–L180`) hashes `agent.config.guardrails` rows (`name`/`stage`/`revision`, `:L172`) only. Session-scoped `guardrailPacks` are not an input (they are not part of `AgentConfig`), so a resume cannot detect a changed pack set from the fingerprint — pack identity/version validation must be the new key's job. **Confirmed runnable, §5.** | `src/agent-run-state.ts` (documented non-change), `src/guardrail-packs/*` (validation) | 2 |
| G4 | No `sessionState.guardrailPacks` type, no bounds in `validateSessionState` (`src/agent-run-state.ts:L458`), no parse. `persistDurable` (`src/agent-session/session/persist.ts:L20`) writes no pack key even with `persistSessionState: true`. **Confirmed runnable, §5.** | `src/agent-run-state.ts`, `src/agent-session/session/persist.ts` | 2 |
| G5 | The session exposes no refs read path (`guardrailPackRefs` is private, `src/agent-session/session.ts:L122`) and no state snapshot/restore entry points, so a resumed session cannot report or restore what it enforces. | `src/agent-session/session.ts` | 2 |
| G6 | A resumed run's **recorded identity** is caller-supplied: `snapshotRunBundle` rows come from `describeGuardrailPacks(input.config?.guardrailPacks)` (`src/run-bundle.ts:L125`) and no runtime path calls `snapshotRunBundle` on resume. A host snapshotting a resumed session with its original `AgentSessionConfig` would claim rules the resumed session is not enforcing; the resumed session's host-visible `runState.sessionState` carries no pack rows either. Task 2 must restore refs so the bundle can be derived from the session (or the doc must state the identity is caller-supplied). | `src/run-bundle.ts`, `src/agent-session/session.ts`, docs | 2 |
| G7 | `GuardrailRuleAction` is `"deny" \| "tripwire"` and `resolveRule` rejects everything else with the message `"ask" has no deterministic seam` (`src/guardrails.ts:L245`); `docs/guardrails.md:L103` and the `GuardrailRule.action` doc comment repeat the rejection. | `src/contracts-core/guardrail-packs.ts`, `src/guardrails.ts`, `docs/guardrails.md` | 3 |
| G8 | `bindChargeToolRound` gates only under `durable.options.interruptBeforeTool` (`src/agent-session/session/tool-round.ts:L285–L286`) and `buildPendingDecision` has no rule-identity input; `PendingDecision`/`AgentRunInterruption` (`src/contracts-run-state.ts:L46–L69`) carry no machine-readable rule field. | `src/agent-session/session/tool-round.ts`, `src/contracts-run-state.ts` (if the review keeps the reason string only, no contract change) | 3 |
| G9 | In a non-durable run a `tool_input` `interrupt` fails the run with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` (`src/guardrails.ts:L48–L53`, thrown at `src/tools.ts:L226`). **Confirmed runnable:** `dispatchToolCall` with a `tool_input` `interrupt` guardrail throws `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`. Nothing blocks the call and continues, which is the only non-destructive outcome for an `ask` in a run that cannot suspend. | `src/agent-session/session/tool-round.ts` (gate path), not core guardrail semantics | 3 |
| G10 | Both guardrail call sites pass a static `{ message: "Tool call blocked by guardrail" }` / `"Tool result blocked by guardrail"` into `blocked()` (`src/tools.ts:L227`, `:L331`) even though the terminal `GuardrailRecord` — with `guardrail: pack:<pack>/<rule>`, the bounded `reason`, and `metadata.pack/rule` — is in scope. The model retries the same blocked call. | `src/tools.ts` (+ `docs/guardrails.md`) | 4 |
| G11 | `SubscribeOptions` has no lifetime flag; run end calls `closeSubscribers()` (`src/agent-session/session/persist.ts:L300`, `src/agent-session/session.ts:L386`, `:L406`), which closes every subscriber including a host's across-run one; `stream()` (`src/agent-session/session.ts:L418`) never closes its own subscription, so its termination depends on that run-end close. | `src/contracts-core/agent.ts`, `src/agent-session/session.ts`, `src/agent-session/session/persist.ts` | 5 |
| G12 | `validateModifiedArguments` evaluates only `agent.config.guardrails` (`src/agent-approval.ts:L242`); `resolveRunDecisions` takes no guardrail list and its call sites pass none, so an edit into a pack-violating state is accepted at decision time and only stopped at dispatch. | `src/agent-approval.ts`, `src/agent-run-lifecycle.ts` | 6 |
| G13 | No `examples/guardrail-packs.ts`; the examples enumeration (`docs/index.md:L236`) and runnable list (`examples/README.md:L17–L86`) have no row for one. | new `examples/guardrail-packs.ts`, `examples/README.md`, `docs/index.md` | 7 |

---

## 3. Per-task decision (reuse as-is / extend / add new)

| Task | Decision | Named seams |
| --- | --- | --- |
| 2 | **Extend** (no public export removed): add an internal `compileGuardrailPacksWithState(refs, registry, initial?)` → `{ guardrails, state }` beside `compileGuardrailPacks`; add an optional state codec to `GuardrailPackRules`; add `sessionState.guardrailPacks` + `validateSessionState` bounds; add session ref/state accessors; insert a restore call at the top of the resume restore block. | §1.1 rows; G1–G6 |
| 3 | **Extend**: widen `GuardrailRuleAction`; keep the boolean `interruptBeforeTool` meaning; add matched-call gating in `bindChargeToolRound` through the existing `activeGatedRound` map; thread rule identity into `buildPendingDecision`; add a non-durable block path that returns a refusal-shaped result (never `GuardrailError`); reuse `matchStickyDecision` for sticky scope and the existing `guardrail_decision` emission for audit. | §1.2 rows; G7–G9 |
| 4 | **Extend**: one bounded, redacted identity-line helper derived from the terminal `GuardrailRecord`, used at both `blocked()` call sites; `reason` code and `appendToolCallRecord` unchanged. | §1.3 rows; G10 |
| 5 | **Extend**: `SubscribeOptions.acrossRuns` (additive); `EventSubscriber` reads the flag; run end calls a narrowly named `closeRunSubscribers()`; `closeSubscribers()` keeps its all-subscribers meaning; `stream()` closes its own subscription in `finally`. | §1.4 rows; G11 |
| 6 | **Extend**: one optional `guardrails` parameter through `resolveRunDecisions`, merged inside the existing `runGuardrails` call in `validateModifiedArguments`; both resume call sites pass the restored session's list. No second revalidation function, no `agent.config` mutation. | §1.5 rows; G12 |
| 7 | **Add new** (example file only) + **extend** two index lists. No primitive added. | §1.6 rows; G13 |

---

## 4. Rejected alternatives (frozen)

None may reappear as an implementation without a new review row.

| # | Rejected | Task | Reason |
| --- | --- | --- | --- |
| R1 | A **predicate function** on `runState.interruptBeforeTool` | 3 | Durable options are persisted and fingerprinted as data (`src/agent-run-state.ts:L57`, `docs/agent-session-runtime.md:L208`); a closure cannot round-trip, so the gate must stay data. |
| R2 | `interruptBeforeToolTools: string[]` (a tool-name list) instead of rules | 3 | Pack rules match argument patterns (`rm -rf`, `--force`, `^/etc/`); a name list cannot express them and would duplicate the rule compiler. |
| R3 | Make `tool_input` `interrupt` universally suspend-or-block | 3 | Changes core guardrail semantics for hand-written guardrails, which today fail closed with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` (`src/guardrails.ts:L48–L53`, confirmed runnable in G9). If ever chosen, the change must be scoped to pack-compiled rules and the hand-written behavior pinned by a test. |
| R4 | A separate `guardrailAskRules` list on the session | 3 | Viable but a second rule compiler and a second match path beside the compiled `Guardrails`; the review rejects it in favor of extending the existing gated-round map (the plan itself requires the review to pick and record which seam each alternative touches). |
| R5 | Emitting `agent_suspended` for an `ask` match in a non-durable run | 3 | Nothing can resume it; blocking the call keeps the run alive and is the only non-destructive outcome. |
| R6 | A pack-id-only message that names only the pack id | 4 | A host debugging which rule fired needs the rule id, and `pack:<pack>/<rule>` is already bounded (≤128 bytes, `src/guardrails.ts:L34`). |
| R7 | Passing the full `GuardrailDecision`/`GuardrailRecord` into the tool result | 4 | `record.reason` is free text and the raw record carries more than the model needs; the bounded identity line is the contract. |
| R8 | **Leave the message unchanged** and rely on the timeline | 4 | The model keeps retrying the same blocked call, which is the failure mode this item exists to fix. |
| R9 | Change the default so `closeSubscribers()` **spares all subscribers** | 5 | `stream()` and every example rely on the run-end close to terminate (`examples/discover-skills.ts:L57`); the opt-in is the compatible direction. |
| R10 | Keep `stream()` relying on the run-end close and only add the flag for `subscribe()` | 5 | `stream()`'s correctness would still depend on a close it does not own; closing its own subscription is the smaller, more honest change. |
| R11 | A separate `subscribeLongLived()` method | 5 | A second entry point for one flag; it would need the same `SubscribeOptions` bounds anyway. |
| R12 | A **durable queue** for across-run subscribers | 5 | Out of scope: live subscribers stay in-memory and bounded; durable replay is the ledger/`AgentEventSource` path (`docs/agent-events.md:L15`). |
| R13 | Leave decision-time revalidation as-is and rely on dispatch | 6 | The host gets a success-shaped decision, the run only dies at dispatch, and the audit trail shows an accepted approval the pack refused. |
| R14 | Merge packs into `agent.config.guardrails` upstream | 6 | That widens enforcement to every session of that agent, exactly what session-scoped packs must not do. |
| R15 | Compile packs into the checkpoint and evaluate them directly in `agent-approval.ts` | 6 | Duplicate compile + a second enforcement path; the resumed session already holds the compiled guardrails after Task 2. |
| R16 | Require the host to re-pass `guardrailPacks` on resume (`AgentRunResumeOptions`) as the primary mechanism | 2 | Enforcement becomes host discipline; a host that forgets resumes into an un-enforced session. The checkpoint is the only party that knows what the suspended run enforced. |
| R17 | Persist only the state and recompile refs from the live agent config | 2 | Packs are session-scoped, not agent config; there is nothing to recompile from (see G3). |
| R18 | Persist state lazily at suspension only | 2 | The same rebuild path serves `continue` crash recovery, which must enforce identically. |
| R19 | Drop malformed state entry-by-entry (the `attentionSticky` precedent) | 2 | A dropped `validation-respect` state re-allows a mutation the pack exists to deny; envelope problems fail closed. |
| R20 | **Per-pack state codec** supplied by hosts | 2 | State is pack-owned; a host-supplied codec for a built-in pack is a second source of truth. |
| R21 | A **second module-level pack registry** for durable restore | 2 | Pack identity and version must be validated against the installed registry (`BUILT_IN_GUARDRAIL_PACKS`, `src/guardrail-packs/index.ts:L15`), not a parallel table. |
| R22 | A docs snippet inside `docs/guardrails.md` instead of an example file | 7 | The page already carries the API; a runnable file is what a host can copy and check. |
| R23 | Extending `examples/behavior-evaluation.ts` | 7 | That file is a host-journey demo with a different focus; a new file keeps both readable. |
| R24 | Adding a CLI `prism eval` surface | 7 | Out of scope (plan 092 Task 1 confirmed no such CLI). |
| R25 | Persist the refs but drop `options`, recompiling every pack from registry defaults | 2 | A `coding-standard` roots override, a `validation-respect.validationTools` override, or any host option would silently change enforcement after a resume. Options are host configuration already held by the checkpoint's owner and must round-trip with the refs (see §7). |

---

## 5. Enforcement-hole confirmation (runnable observation)

Method: a throwaway probe (`/tmp/phase104-probe.mjs`, not committed) run with
`node --expose-gc` against `dist/` built from this working tree, `aerynos`, Node v24.19.0, 2026-09-20.
It scripts a two-tool model (`run_tests` fails; `write` is a mutation), runs with
`{ checkpoints, definitionRevision: "1", interruptBeforeTool: true, persistSessionState: true }` and a
session configured with `guardrailPacks: ["validation-respect"]`, then resumes twice with `allow_once`.

```
run1: status=suspended pending=c-validate executed=[]
resume1: status=suspended pending=c-write executed=[run_tests]
checkpoint sessionState keys after resume1: [loadedSkillNames]
resume2: status=succeeded executed=[run_tests,write]
resumed session packGuardrails === undefined: true,true
resumed session guardrailPackRefs === undefined: true,true
HOLE 1 (resume drops packs): CONFIRMED
HOLE 2 (state lost, mutation executes after resume): CONFIRMED — executed=[run_tests,write]
```

- **Hole #1 CONFIRMED — a resumed session has `packGuardrails === undefined`.** Both resumed sessions
  (one per `resumeAgentRun` call, observed through `onSession`) carry no compiled packs and no refs, because
  `prepareAgentRunResume` constructs `new RuntimeAgentSession({ agent, id, leafId })`
  (`src/agent-run-lifecycle.ts:L262`) with no config. The `write` call that the pack set out to deny after a
  failed validation executes. The checkpoint's `sessionState` at that point carries `loadedSkillNames` only
  — no pack key exists (`src/agent-session/session/persist.ts:L20–L66`).
- **Hole #2 CONFIRMED — pack state is per-compile closure state and resets on any recompile.** Isolated from
  hole #1 with two `compileGuardrailPacks(["validation-respect"])` calls: after one compiled instance
  observes a failed validation, a `write` call is blocked
  (`pack:validation-respect/no-mutation-after-failed-validation`); a **fresh** compile — exactly what a
  resumed session performs — allows the same call. The state object created at `src/guardrails.ts:L155` is
  captured only by that compile's closures and returned by nothing.
- **Fingerprint: REFUTED that `agentFingerprint` covers session-scoped packs.** It hashes
  `agent.config.guardrails` rows only (`name`/`stage`/`revision`, `src/agent-run-state.ts:L172`); session
  `guardrailPacks` are not an `AgentConfig` input, so two agents that differ only in a session's packs
  produce the same digest, and the probe's resume passes the fingerprint check while enforcing nothing.
  Task 2 therefore cannot lean on the fingerprint for pack identity/version — the restore pass validates
  against the installed registry itself.
- **Recorded identity today: caller-supplied, and stale after resume.** `describeGuardrailPacks` rows reach a
  bundle only through `snapshotRunBundle({ agent, config })` at `src/run-bundle.ts:L125`; no runtime path
  calls it on resume, and the resumed session exposes no refs (G5). A host reusing its original
  `AgentSessionConfig` would record `pack:validation-respect/no-mutation-after-failed-validation` for a run
  that is not enforcing it. The resumed run's host-visible `runState.sessionState` currently carries no pack
  rows, so the bundle is the only place that could claim them. Task 2 must either restore the refs so the
  bundle rows come from the session or state plainly that resume-time identity is caller-supplied.

---

## 6. Measured costs (numbers, not claims)

Method as in §5; medians over 1,001–2,001 runs after warmup. These are regression baselines only — the
shipping suites named per task assert bounds; the harness is not committed.

| Path | Measured | Consequence for the task |
| --- | --- | --- |
| `compileGuardrailPacks()` once over all 4 built-in packs / 9 rules | **12.5 µs** median | Compile stays once per session; a resumed session pays one restore-registry validation + one compile (≈12.5 µs) and no per-call cost change. |
| `compileGuardrailPacks(["validation-respect"])` alone | **2.2 µs** median | The `validation-respect` restore path's compile share. |
| One `runGuardrails(tool_input)` pass over the 9 built-in rules — the per-decision scan `bindChargeToolRound` performs for a matched `ask` rule — non-matching `shell` call / matching `rm -rf` call | **7.1 µs** / **6.8 µs** median | Task 3's gate adds ≈7 µs per tool call over the 9 built-in rules; `bindChargeToolRound` itself only does a map insert. No second regex compile, no provider turn. |
| Default durable checkpoint (suspended, no `persistSessionState`) | **1,190 B** total state | The default stays byte-identical: a run without the opt-in has `sessionState === undefined` (observed). |
| Same run with `persistSessionState: true` | **1,229 B** (`{"loadedSkillNames":[]}` = 39 B) | The new key rides the same opt-in. |
| Pack refs only: `{ packs: [{ id, version }] }` for 4 packs / a single ref | **186 B** / **27 B** | ≤8 packs ⇒ ≤ ~190 B of refs. |
| Built-in pack state envelopes (`id → codec snapshot`): `validation-respect` (only real state: `{ validationFailed: "run_tests" }`), `coding-standard` (options echo), `destructive-commands`, `secrets-hygiene` | **55 B**, **65 B**, **27 B**, **22 B** | Stateless packs contribute an empty/absent entry; `validation-respect` contributes ≤ ~64 B. |
| Refs + all 4 measured states (worst case measured) | **342 B** | ≈0.13 % of the 256 KiB `maxStateBytes` default; a store's per-turn checkpoint grows by ≤ ~350 B once `persistSessionState` is on. |
| One across-run subscriber queue at the default `maxQueuedEvents: 1024` | JSON payload **204,714 B ≈ 200 KiB**; retained-heap slope 512→1024 **199,512 B** | A full across-run queue holds ≈200 KiB per subscriber for the session's lifetime (vs one run today). `EventSubscriber` has no timer, background task, or durable queue (`src/agent-session/event-subscriber.ts:L4–L71`), so this is the whole cost. |

---

## 7. Security confirmations and hard rejections

- **No tool arguments, paths, or command text in persisted pack state.** The per-field inventory:
  - `packs[].id` — a registry-validated pack id (≤96 bytes, `src/guardrails.ts:L33`), never a tool name or free text;
  - `packs[].version` — an integer;
  - `packs[].options` — the pack's bounded options object replayed **verbatim from `AgentSessionConfig`** (e.g. `validation-respect.validationTools`, `coding-standard.roots`). This is host configuration already present in the session that wrote the checkpoint, not model output and not a tool argument; it is the only way a recompile enforces exactly what the suspended run enforced (see R25). It is redacted and bounded at the same checkpoint boundary as every other state field, and each pack's own reader already caps it (`readRoots` ≤16 entries, `readValidationTools` ≤16);
  - `state` — only what the pack's own `observe` wrote. For the only stateful built-in that is a **tool name** (`validationFailed: "run_tests"`, `src/guardrail-packs/validation-respect.ts:L44`), a value from the tool registry, not from arguments. The other three packs are stateless.
  No `GuardrailRecord.reason` (free text), no excerpted argument string, no command text, and no matched pattern is persisted.
- **Redaction stays at the boundary.** The pack key rides the same `persistDurable` → `saveAgentRunState`
  redaction path (`src/agent-run-state.ts:L271`) as every other `sessionState` entry; it is bounded by
  `maxStateBytes` on save and the 1 MiB hard cap on load.
- **Fail closed on restore.** Unknown pack id, version mismatch, >`MAX_GUARDRAIL_PACKS` (8) entries, or a
  malformed/oversized state envelope must throw `AgentRunStateError` before the first provider/tool turn. A
  lowered `maxStateBytes` refuses rather than truncates (`validateRunStateOptions`, `src/agent-run-state.ts:L190`).
  A checkpoint written by plan 092 (no key) resumes with no packs and no error, exactly as today — this is the
  deliberate legacy path, not a fail-open: it only applies when the checkpoint itself proves no packs were
  configured.
- **Envelope problems are not dropped entry-by-entry** (R19): the `attentionSticky` precedent is explicitly
  rejected for pack state because a dropped `validation-respect` state re-allows a mutation the pack exists to
  deny.
- **Fingerprint is not the pack boundary** (G3): session packs are outside `agentFingerprint`, so identity and
  version are validated against `BUILT_IN_GUARDRAIL_PACKS` in the restore pass, never inferred from the
  fingerprint.
- **Rule identity in the model-visible refusal is bounded and redacted.** Task 4's line is derived from the
  terminal `GuardrailRecord` (`guardrail` ≤128 bytes, `reason` ≤4 KiB and already redacted at record
  creation, `src/guardrails.ts:L465–L480`), capped again at the result boundary (target cap 200 bytes
  asserted by a test), and never carries arguments. A hand-written guardrail with no `pack:` identity keeps a
  neutral message rather than a fabricated id. `tool_execution_blocked.reason` keeps the machine code
  (`guardrail_blocked`) and the ledger keeps the code, not the free text.
- **Approvals cannot widen packs.** Task 3 reuses the existing args-hash/effect/identity scope
  (`buildPendingDecision`, `matchStickyDecision`), so one decision cannot apply to different arguments; an
  `ask` approval still denies when the same call re-trips a `deny` rule at dispatch, and Task 6 re-checks pack
  rules at decision time so an edit cannot be laundered through `allow_for_run` (the sticky scope drops
  `argumentsHash` for modified arguments, `src/agent-approval.ts:L195`).
- **Across-run subscribers stay session-scoped and bounded.** They observe the same session-scoped
  broadcaster, redacted per event; an across-run subscriber holds its bounded in-memory queue
  (`maxQueuedEvents`, default 1024; ≈200 KiB measured) for the session's lifetime, with the same overflow
  policies, no background work, and no state surviving `session.closeSubscribers()` or session teardown
  (R12).

---

## 8. Evidence-artifact scope

Read-only for the tree: this file adds no code, no test, no docs navigation. `docs/index.md` is not touched
(evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`). Tasks 2–7
must cite a row from §1/§2; any new primitive they need that is absent here is a review gap and must be added
to §2 before implementation. The two enforcement holes in the plan header are confirmed runnable, and the
plan's line citations for the session constructor (`:233`), the resume rebuild (`:219`), `validateSessionState`
(`:407`), `persistDurable` (`:14`), `subscribe()` (`:275`), `closeSubscribers()` (`:543`),
`recordDurableResumption` (`:321`), `validateModifiedArguments` (`:213`) and `docs/index.md` (`:219`) are
stale in this tree; the §1 spans are the authoritative ones.