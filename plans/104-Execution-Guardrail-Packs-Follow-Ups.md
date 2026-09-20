# Execution Guardrail Packs Follow-Ups: Durable Enforcement, Selective Suspension, and Subscriber Ownership

Release: 0.9.x follow-up to plan 092, recorded from that plan's Further Actions. Not part of plan 099's 0.9.0 cut unless a host pulls it forward first. Two items here are enforcement holes in shipped behavior rather than feature gaps: plan 092's packs are compiled from `AgentSessionConfig` in the session constructor (`src/agent-session/session.ts:233`), while a durable resume rebuilds the session as `new RuntimeAgentSession({ agent, id, leafId })` (`src/agent-run-lifecycle.ts:219`) with no config — so **pack enforcement silently stops after the first suspension** — and pack-local state is a closure created per compile (`src/guardrails.ts`, `compileGuardrailPacks`), so `validation-respect` forgets a failed validation across a resume. Task 1 confirms both with spans and a failing observation before anything changes.

## Objectives
- Make pack enforcement survive suspension: the session's pack refs and the bounded observed state ride the checkpoint under the existing `persistSessionState` opt-in, recompile on resume, and fail closed on unknown pack id, version mismatch, or malformed state.
- Give `ask` a deterministic seam: a pack rule can suspend a durable run before a specific tool call (rule identity on the pending decision), instead of plan 092's deny-only vocabulary.
- Let the model see which rule refused a call — bounded, redacted, rule identity instead of today's generic `Tool call blocked by guardrail`.
- Make `session.subscribe()`'s documented long-lived contract real through an explicit opt-in, without changing the default run-scoped close that `stream()` and every example depend on.
- Re-check session pack rules when a host approves a call **with modified arguments**, so an edited argument that newly trips a pack rule is rejected at decision time instead of only at dispatch.
- Ship one runnable, network-free walkthrough and state the sizing trade-offs of the new durable bytes and the opt-in subscriber in the owning docs pages.

## Expected Outcome
- A durable run that suspends after a failed validation still denies a mutation after `resumeAgentRun()`; a resumed session with a checkpoint written by a different pack version refuses to resume (`AgentRunStateError`) instead of continuing with changed enforcement. Default checkpoints (no `persistSessionState`) stay byte-identical.
- An `ask` rule in a durable run suspends before dispatch with a pending decision whose reason names `pack:<pack>/<rule>`; `allow_once` dispatches exactly once, `allow_for_run` sticks by the existing scope match, `reject_*` yields a refusal-shaped result and no side effect. In a non-durable run the same call never executes and the run keeps going (no `GuardrailError` run failure). The decision is on the timeline as a `guardrail_decision` with the rule identity, so `createGuardrailPackScorer()` grades it.
- A pack-blocked tool result carries `ToolResult.error.message` naming the rule (bounded, redacted, never tool arguments); `tool_execution_blocked.reason` keeps its machine code.
- `session.subscribe({ acrossRuns: true })` observes several runs of one session and stays open until the host closes it; a default subscription still closes at run end; `session.stream()` terminates on its own subscription instead of relying on that close. `docs/agent-events.md` and `docs/agent-session-runtime.md` state the buffer cost per across-run subscriber.
- `examples/guardrail-packs.ts` runs network-free: a session with two packs blocks a call, the eval scenario grades it with the rule named, and (after Task 3) a durable `ask` suspension is approved.

## Tasks

- [x] Task 1: Primitive review — durability, suspension, refusal text, and subscriber ownership seams
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase104-primitive-review.md` exists with three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every Rejected item below).
    - Functional: the review states, per later task, whether it reuses a seam as-is, extends it, or adds a new one — Task 2 (`compileGuardrailPacks` in `src/guardrails.ts`, `GuardrailPackRules.observe` in `src/guardrail-packs/types.ts`, `StoredAgentRunState.sessionState` at `src/agent-run-state.ts:63-80`, `persistDurable` at `src/agent-session/session/persist.ts:14-58`, `validateSessionState` at `src/agent-run-state.ts:407`, the resume restore block at `src/agent-run-lifecycle.ts:224-257`), Task 3 (`bindChargeToolRound` at `src/agent-session/session/tool-round.ts:282-300`, `buildPendingDecision` at `:302-345`, `matchStickyDecision` and `bindDispatchToolCall` at `:321-429`, `PendingDecision` at `src/contracts-run-state.ts:44-56`, `AgentRunInterruptionKind` at `:25`), Task 4 (`blocked()` at `src/tools.ts:575-598` and its two call sites at `:218-228` / `:331`), Task 5 (`subscribe()` at `src/agent-session/session.ts:275-278`, `EventSubscriber`, `closeSubscribers()` at `:543-546`, `cleanupRun` at `src/agent-session/session/persist.ts:229-294`, `recordDurableResumption`/`recordDurableDenial` at `src/agent-session/session.ts:321-359`, `stream()` at `:369-392`), Task 6 (`validateModifiedArguments` at `src/agent-approval.ts:213-259`, its call site at `:179`, `resolveRunDecisions` at `:138`), Task 7 (`examples/README.md` runnable list, `docs/index.md:219`).
    - Functional: the review confirms or refutes, with a runnable observation, the two enforcement holes named in this plan's header — that a resumed session has `packGuardrails === undefined` and that pack state resets across a suspension — and records the exact spans, plus whether the agent fingerprint (`agentFingerprint`) covers session-scoped packs (it currently hashes agent-configured guardrail name/stage/revision, `docs/agent-session-runtime.md:208`).
    - Functional: the review records what a resumed run's *recorded* identity shows today — `describeGuardrailPacks()` rows come from `AgentSessionConfig` (`src/run-bundle.ts`), so a resumed run's bundle must not claim packs it is not enforcing, or must be shown to be unaffected.
    - Performance: the review records measured numbers, not claims — bytes added to a checkpoint by pack refs and by each built-in pack's state, one `compileGuardrailPacks()` pass, one `bindChargeToolRound` decision cost over the 9 built-in rules, and the per-subscriber queue cost of an across-run subscriber.
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the task it would have affected. It also adds the matching `PLAN_104_TASK_1` block to `scripts/plan-review-gate.test.mjs` (plan path, evidence path, required tokens, rejected tokens) so the review cannot silently drift.
    - Security: the review explicitly rejects the designs in the Rejected list below and states, for each persisted pack field, why it contains no tool arguments, paths, or command text.
  - Approach:
    - Documentation Reviewed:
      - Plan 092 `Compromises Made` + `Further Actions` (the source of every task here); `docs/guardrails.md` (packs, stages, actions), `docs/durable-runs.md` (checkpoint contents, resume semantics), `docs/agent-session-runtime.md:67` (`subscribe()` long-lived claim) and `:208` (fingerprint + checkpoint bounds), `docs/agent-events.md:13,296` (subscriber contract and overflow), `docs/options-index.md` (`AgentSessionConfig`).
    - Options Considered:
      - Predicate function on `runState.interruptBeforeTool` — rejected: durable options are persisted, fingerprinted, and compared on resume (`src/agent-run-state.ts:57`, `docs/agent-session-runtime.md:208`); a closure cannot round-trip, so the gate must stay data.
      - A tool-name list (`interruptBeforeToolTools: string[]`) instead of rules — rejected: pack rules match argument patterns (`rm -rf`, `--force`), a name list cannot express them and would duplicate the rule compiler.
      - Making `tool_input` `interrupt` universally suspend-or-block — rejected: changes core guardrail semantics for hand-written guardrails, which today fail closed with `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` (`src/guardrails.ts:49-53`).
      - Changing the default so `closeSubscribers()` spares all subscribers — rejected: `stream()` and every example rely on the run-end close to terminate (`examples/discover-skills.ts:57`); the opt-in is the compatible direction.
      - Per-pack state codecs supplied by hosts — rejected: state is pack-owned; a host-supplied codec for a built-in pack is a second source of truth.
      - A second module-level pack registry for durable restore — rejected: pack identity and version must be validated against the installed registry, not a parallel table.
    - Chosen Approach: one evidence file mapping every 092 Further Action to an existing primitive or a named gap, with spans, a runnable confirmation of the two enforcement holes, and measured costs, before any task touches code.
    - API Notes and Examples:
      ```text
      reuse: src/guardrails.ts                    compileGuardrailPacks()        → Task 2 (extend: initial state in, snapshot out)
      reuse: src/agent-run-state.ts:63-80         sessionState bag               → Task 2 (new key, validated on load)
      reuse: src/agent-session/session/tool-round.ts:282-300  bindChargeToolRound → Task 3 (extend: rule-driven gating)
      reuse: src/tools.ts:575-598                 blocked()                      → Task 4 (bounded reason in, refusal out)
      reuse: src/agent-session/session.ts:275-278 subscribe() / EventSubscriber → Task 5 (opt-in across-run ownership)
      reuse: src/agent-approval.ts:213-259        validateModifiedArguments       → Task 6 (extra guardrail list in)
      gap:   src/agent-run-lifecycle.ts:219       resume rebuilds a session without its packs → Task 2
      gap:   src/agent-session/session.ts:233     pack state is per-compile closure state       → Task 2
      gap:   src/guardrail-packs/types.ts:9       no state codec on the pack definition         → Task 2
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase104-primitive-review.md` (new).
      - `scripts/plan-review-gate.test.mjs`: `PLAN_104_TASK_1` block.
      - Result: both enforcement holes confirmed runnable (resumed `packGuardrails === undefined`; state is per-compile closure and resets), and `agentFingerprint` refuted as a pack boundary. Gate test refactored to one shared `assertPrimitiveReview(spec)` helper plus the `PLAN_104_TASK_1` spec (plan/evidence paths, required and rejected tokens, `completeTask` regex). The plan's own line citations for the session constructor, resume rebuild, `validateSessionState`, `persistDurable`, `subscribe()`, `closeSubscribers()`, `recordDurableResumption`, `validateModifiedArguments`, and `docs/index.md` are stale in this tree; §1 of the review carries the authoritative spans.
    - References:
      - `scripts/plan-review-gate.test.mjs` (evidence gate shape), `docs/_evidence/phase102-primitive-review.md` and `phase103-primitive-review.md` (the artifact shape planned by 102/103), `docs/_evidence/phase26-primitive-review.md` (span-citation expectation), plan 092 Task 1 findings (the seam inventory this review extends).
  - Test Cases to Write:
    - None (evidence artifact); the check is `node --test scripts/plan-review-gate.test.mjs` plus every later task's Approach citing a row from this file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal evidence).
    - Docs pages to create/edit: none (evidence file lives under `docs/_evidence/`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (evidence files are not navigation targets).

- [x] Task 2: Pack durability — refs and observed state ride the checkpoint, recompile on resume (P1)
  - Acceptance Criteria:
    - Functional: `persistSessionState: true` writes a new bounded `sessionState.guardrailPacks` entry: `{ packs: [{ id, version, options? }], state?: { <packId>: <pack state> } }`, derived from the session's configured refs (`session.guardrailPackRefs`) and the compiled closures. A run without `persistSessionState` writes no such key and keeps today's checkpoint bytes.
    - Functional: `prepareAgentRunResume` restores the refs before the first provider/tool turn, recompiles them with `compileGuardrailPacks`, restores pack state into the compiled closures, and the resumed run enforces exactly what the suspended run enforced — asserted by a `validation-respect` suspend/resume test where the mutation after resume is still denied, and by a `destructive-commands` resume test where a `rm -rf` call is still blocked.
    - Functional: restore fails closed with an `AgentRunStateError` on unknown pack id, `state.guardrailPacks` version mismatch against the installed pack definition, more than `MAX_GUARDRAIL_PACKS` entries, or malformed/oversized state — never a silently un-enforced session. A checkpoint written by plan 092 (no such key) resumes with no packs and no error, exactly as today. The repo-wide search for the new error message/code covers `scripts/`, `examples/`, and every workspace, not just `packages/`.
    - Functional: a resumed run's run bundle reports the restored pack rows (`describeGuardrailPacks`), so recorded identity matches enforced rules — and a session that could not restore its packs never reports them.
    - Performance: compile stays once per session; a resumed session pays one restore pass, no per-call cost change. The durable delta is bounded (≤8 packs; state ≤ the pack codec's cap, and the whole state still bounded by `runState.maxStateBytes`, default 256 KB) — the review's measured byte counts are quoted in the task's result, and `docs/durable-runs.md` states the per-pack cost line.
    - Code Quality: state serialization is declared by the pack definition (`GuardrailPackRules` gains an optional `state` codec with `snapshot`/`parse`), not by the session; `compileGuardrailPacks` keeps its current signature and return type, with an internal entry (e.g. `compileGuardrailPacksWithState`) returning `{ guardrails, state }` so no public export is removed and `scripts/compat-baseline/` needs no regeneration; `validateSessionState` (`src/agent-run-state.ts:407`) bounds every new field the way it bounds `attentionSticky` today.
    - Security: the persisted state contains counts, tool names, and pack/rule ids only — never tool arguments, paths, command text, or reasons; it is redacted at the checkpoint boundary like all state; a lowered `maxStateBytes` refuses rather than truncates; a version mismatch is a hard failure, not a warning.
  - Approach:
    - Documentation Reviewed:
      - `docs/durable-runs.md` (checkpoint contents, `persistSessionState`, `maxStateBytes`), `docs/agent-session-runtime.md:208` (the authoritative session-state persistence paragraph to extend), `docs/guardrails.md` (pack semantics), plan 086 T3's `attentionFold` key as the precedent for a pack-owned durable key with its own bounds.
    - Options Considered:
      - Require the host to re-pass `guardrailPacks` on resume (`AgentRunResumeOptions`) — rejected as the primary mechanism: enforcement becomes host-discipline, and a host that forgets resumes into an un-enforced session; the checkpoint is the only party that knows what the suspended run was enforcing.
      - Persist only the state and recompile refs from the live agent config — rejected: packs are session-scoped, not agent config, so there is nothing to recompile from.
      - Persist state lazily at suspension only — rejected: the same rebuild path serves `continue` crash recovery, which must enforce identically.
      - Drop malformed state entry-by-entry (the `attentionSticky` precedent) — rejected: a dropped `validation-respect` state re-allows a mutation the pack exists to deny; envelope problems fail closed.
    - Chosen Approach: the checkpoint carries the refs plus a pack-owned state snapshot; resume recompiles, re-validates identity/version, and restores state before any turn.
    - API Notes and Examples:
      ```ts
      // pack definition owns its state codec (internal type, not SDK surface)
      build: () => ({
        rules: [...],
        observe: (state, result, context) => { state.validationFailed = resultFailed(result) ? context.toolName : undefined; },
        state: { snapshot: (s) => (s.validationFailed ? { validationFailed: s.validationFailed } : undefined),
                 parse: (json) => ({ validationFailed: typeof json?.validationFailed === "string" ? json.validationFailed : undefined }) },
      })

      // checkpoint sessionState (only with persistSessionState: true)
      { guardrailPacks: { packs: [{ id: "validation-respect", version: 1, options: { validationTools: ["shell"] } }],
                          state: { "validation-respect": { validationFailed: "shell" } } } }
      ```
    - Files to Create/Edit:
      - `src/guardrail-packs/types.ts`: optional state codec on `GuardrailPackRules`.
      - `src/guardrail-packs/validation-respect.ts`: codec for its state; other built-ins declare none (stateless).
      - `src/guardrails.ts`: internal `compileGuardrailPacksWithState(refs, registry, initial?)` returning `{ guardrails, state }`; `compileGuardrailPacks` becomes the thin wrapper; expose a state snapshot for the session.
      - `src/agent-run-state.ts`: `sessionState.guardrailPacks` type + `validateSessionState` bounds + parse.
      - `src/agent-session/session.ts`: keep refs + expose `serializedGuardrailPackState()` and `restoreGuardrailPacks(refs, state)`.
      - `src/agent-session/session/persist.ts`: write the key in `persistDurable`.
      - `src/agent-run-lifecycle.ts`: restore refs/state in `prepareAgentRunResume` (before the pending-decision resolution block) and fail closed on mismatch.
      - `docs/durable-runs.md`, `docs/agent-session-runtime.md`, `docs/guardrails.md` (one sizing line each where the key is described).
      - Result: shipped as reviewed, with three deltas. (1) `compileGuardrailPacksWithState(refs, registry, initial?)` returns `{ guardrails, packs, snapshotState }` — `snapshotState` replaces a raw `state` map so each pack's own codec, not the session, decides what is serialized (and the row carries the resolved version plus verbatim host options, per review R25). (2) `AgentSession.guardrailPackRefs` is public (the returned rows feed `snapshotRunBundle({ packs })`) and on resume the key's presence is the opt-in — a checkpoint that carries `sessionState.guardrailPacks` restores it without the host re-passing `persistSessionState`, so a dropped flag cannot unenforce a resumed run. (3) `compileGuardrailPacksWithState` plus `PersistedGuardrailPacks` are the only new src exports (the codec, row, compile-result, and per-pack caps stay module-internal); `scripts/budgets.json` rebaselines `@arnilo/prism` 1448 → 1450 with the reason entry, and the non-null-assertion budget stays at its recorded counts.
      - Result (measured): a `persistSessionState` checkpoint is 656 B with no packs, 841 B with all four built-in pack rows (+185 B, ≈ 46 B/pack), and one `validation-respect` row with non-default options plus live state adds ≈ 169 B total — quoted in `docs/durable-runs.md`. Fail-closed rows proven by test: unknown pack id, `version` mismatch (99 vs installed 1), >8 packs, a pack with persisted state but no codec, non-object state, state naming an absent pack, and per-pack state over 8 KiB; a lowered `maxStateBytes` refuses the save (never truncates), and a checkpoint with no key resumes with no packs and no error; an inline-rule pack refuses to persist at all (its rules are closures, so replaying one would restore a different policy).
      - Result (repo sweep): the new messages (`Cannot restore guardrail packs`, `Persisted guardrail pack`, `persisted at version`) appear only in `src/guardrails.ts`, `src/agent-run-state.ts`, `src/agent-session/session.ts`, and the new test — no stale doc, script, or workspace fixture. `docs/_evidence/phase54-package-map.md` was regenerated (it was already stale from the plan 102 working tree) and `npm test` is green in all six stages, including the lint, export-budget, and non-null gates.
    - References:
      - Plan 086 T3 (`attentionFold`) and plan 015 Task 4 (`loadedSkillNames`) as the two precedents for a `sessionState` key; `src/agent-session/session/persist.ts:14-58`; `src/run-bundle.ts` `describeGuardrailPacks` rows; `src/__tests__/guardrail-packs.test.ts` (existing fork/clone persistence test to extend for resume).
  - Test Cases to Write:
    - `validation-respect` durable suspend/resume: a failed `shell` validation, suspension on a mutation, resume → the mutation is still denied and named on the timeline.
    - `destructive-commands` durable crash-recovery (`decision: "continue"` with `checkpointPolicy: "every-turn"`): the resumed run still blocks `rm -rf`; the checkpoint without `persistSessionState` resumes with no packs and no error.
    - Fail-closed rows: unknown pack id, version mismatch, >8 packs, malformed state, and a lowered `maxStateBytes` each refuse the resume with `AgentRunStateError` and the run does not dispatch.
    - Byte-shape row: a default durable run's checkpoint is byte-identical to a pre-plan-104 checkpoint (no new key); with `persistSessionState: true` the key appears with the documented bounds.
    - Repo sweep: the new error code/message appears in no stale doc, script, or workspace test fixture.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — durable checkpoint shape (opt-in) and resumed enforcement semantics.
    - Docs pages to create/edit:
      - `docs/durable-runs.md`: `sessionState.guardrailPacks` contents, bounds, fail-closed cases, and the per-pack byte cost line.
      - `docs/agent-session-runtime.md`: extend the `persistSessionState` paragraph with the pack keys.
      - `docs/guardrails.md`: enforcement survives resume; pack state is durable under `persistSessionState` and refused on version mismatch.
    - `docs/index.md` update: no (no new page; existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: `ask` — selective durable suspension from a pack rule (P1)
  - Acceptance Criteria:
    - Functional: `GuardrailRuleAction` gains `"ask"` and the compile-time rejection of `ask` is removed. A matching call in a run with durable options suspends **before dispatch**: the pending decision names `pack:<pack>/<rule>` in a bounded reason and carries machine-readable rule identity; `allow_once` dispatches exactly once, `allow_for_run` sticks by the existing `matchStickyDecision` scope match, `reject_once`/`reject_for_run` return a refusal-shaped result and the tool never executes.
    - Functional: a matching call in a run **without** durable options never executes and does not fail the run — it returns a refusal-shaped result naming the rule (no `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` run failure, no silent execution).
    - Functional: the decision is auditable like every other pack decision — `guardrail_decision` with the rule identity on the event and timeline, so `createGuardrailPackScorer()` grades an `ask`-blocked call as a pack denial; `recordGuardrailDecision` maps the suspension to an approval outcome.
    - Functional: an `ask` rule combined with a `deny` predicate, an unknown action, or `ask` on a stage/pack form that cannot suspend stays a `GuardrailPackError` at session creation.
    - Performance: gating costs one rule evaluation per tool call at charge time (the same bounded scan the review measured for Task 1); no second regex compile, no extra provider turn, no extra checkpoint write beyond the suspension that already happens.
    - Code Quality: the gate stays data-driven — the boolean `interruptBeforeTool` keeps its current all-tools meaning, and pack `ask` rules add matched-call gating through the existing gated-round map; no predicate functions enter persisted run state; `PendingDecision`/`AgentRunInterruption` gain only optional bounded fields (additive, no export removal → no compat-baseline regeneration).
    - Security: the rule identity is bounded and redacted, never excerpts of arguments; the suspension path reuses the existing approval scope/arguments-hash machinery, so a decision never applies to a different call; an approval cannot widen pack rules (an `ask` rule still denies when the same call re-trips a deny rule at dispatch).
  - Approach:
    - Documentation Reviewed:
      - `docs/durable-runs.md` (suspension/resume and sticky decisions), `docs/agent-session-runtime.md:195-208` (decision input validation and the rechecked paths on resume), `docs/guardrails.md` (action semantics to update), `docs/execution-timeline.md` (guardrail step identity added by plan 092 Task 3).
    - Options Considered:
      - Compile `ask` to a `tool_input` `interrupt` guardrail and let the dispatch path decide — viable but it changes core guardrail semantics for host-written guardrails too (`src/guardrails.ts:49-53`); if chosen, the change must be scoped to pack-compiled rules and the hand-written behavior pinned by a test.
      - Widen `interruptBeforeTool` to `boolean | readonly string[]` tool names — rejected: cannot express argument patterns, duplicates the rule compiler.
      - A separate `guardrailAskRules` list on the session consumed by `bindChargeToolRound` — viable and keeps core guardrail semantics untouched; the review picks between this and the compiled-guardrail route and records which seam each alternative would touch.
      - Emitting `agent_suspended` for an `ask` match in a non-durable run — rejected: nothing can resume it; blocking the call keeps the run alive and is the only non-destructive outcome.
    - Chosen Approach: gating happens at the existing gated-round seam (`bindChargeToolRound`) with rule identity carried into the pending decision and interruption; non-durable runs block the call instead of throwing.
    - API Notes and Examples:
      ```ts
      const session = agent.createSession({
        guardrailPacks: [{ id: "coding-standard", rules: [{ id: "ask-outside-roots", tool: ["write", "edit"], argPath: "path",
          pattern: "^/etc/", action: "ask", reason: "Writing outside the workspace needs approval" }] }],
      });
      // durable run: suspension before dispatch, with no all-tools gate (mirrors examples/durable-loops-and-approvals.ts)
      const suspended = await session.run("patch the host config", { runState: { checkpoints, definitionRevision: "1" } });
      const pending = suspended.interruption?.pendingDecisions ?? []; // reason names pack:coding-standard/ask-outside-roots
      const done = await resumeAgentRun(agent, { runId: suspended.runId, sessionId: suspended.sessionId },
        { expectedVersion: suspended.runState!.version!, decisions: pending.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const })) },
        { checkpoints, definitionRevision: "1" });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/guardrail-packs.ts`: `GuardrailRuleAction` + `"ask"`, doc comment rewrite.
      - `src/guardrails.ts` (and/or `src/guardrail-packs/*`): compile `ask` rules, keep them available to the gate.
      - `src/agent-session/session/tool-round.ts`: matched-call gating in `bindChargeToolRound`, rule identity into `buildPendingDecision`, non-durable block path.
      - `src/contracts-run-state.ts`: optional bounded rule-identity field(s) on `PendingDecision`/`AgentRunInterruption` if the review shows the reason string is not enough for scoring.
      - `docs/guardrails.md`, `docs/durable-runs.md`, `docs/execution-timeline.md` (if the step gains a field).
      - `src/__tests__/guardrail-packs.test.ts`, `packages/prism-core/src/governance/evals/__tests__/guardrail-pack-scenarios.test.ts`.
      - Result: shipped as reviewed, with two deltas. (1) The compiled-guardrail route became a *split* compile rather than a stage decision: `ask` rules never enter `guardrails.toolInput`; they compile twice — once as an `interrupt`-actioned copy on the new `CompiledGuardrailPacks.askGate` (probed by the gate) and once as a `block`-actioned copy on `askBlocks` (merged into `activeGuardrails` only when the run cannot suspend, per `assemble.ts`). That keeps hand-written `tool_input` `interrupt` semantics pinned (`ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE` still fails closed) and gives the approval a clean post-dispatch path: an approved call cannot re-trip its own gate, so no extra state or "approved this call" flag was needed. (2) Task 2's blanket "an inline pack cannot be persisted" refused the very host form the AC's own example uses, and without a pack there is no rule to re-enforce after a resume — so `GuardrailPackRefRow`/`PersistedGuardrailPackRef` gained an optional `rules`, and snapshot now refuses only what cannot round-trip: a `deny` predicate (no JSON form) or a `RegExp` pattern (JSON writes `{}`). A registered pack still replays by id/version, and `validatePersistedPackRules` bounds the new field (≤64 rules, ids ≤96 chars, ≤8 KiB per rule and row). This is a deliberate widening of Task 2's rule, recorded here because it changes what a checkpoint may contain.
      - Result (measured): the gate is one `runGuardrails` pass over only the ask rules per tool call at charge time, and zero work when no pack declares one (`session.packAskGate` is `undefined`, so the match is a single `if`). Tests pin "no extra provider turn" (`requests.length === 1` at the suspension) and "no extra checkpoint write" (the gate persists nothing; the suspension writes the one record it already wrote). A one-rule inline `ask` row costs 180 B in a `persistSessionState` checkpoint (comparable to the 79 B `validation-respect` options row and the ≈46 B/pack rows quoted in `docs/durable-runs.md`), and the pending decision's reason is bounded to 200 bytes with no argument text.
      - Result (compile failures): `ask` + `deny` and an unknown action value both stay `GuardrailPackError` at session creation (asserted in `guardrail-packs.test.ts`). The AC's third clause — "`ask` on a stage/pack form that cannot suspend" — turned out to be vacuous rather than unimplemented: pack rules only compile onto `tool_input` (`toolOutput` carries the `observe` recorder alone), the `ask`-cannot-suspend case is a property of the *run* (no `runState`), and that path is the non-durable block covered by its own test. Recorded here so the clause is not silently dropped.
      - Result (repo sweep): the retired rejection text (`"ask" has no deterministic seam`) survives only in `plans/092-Execution-Guardrail-Packs.md` and the Task 1 evidence file, both of which describe the pre-Task-3 state as history; `docs/guardrails.md` now documents `ask` semantics (new "Asking for approval" section, action-table row, inline-shape paragraph) with `docs/durable-runs.md`, `docs/agent-session-runtime.md`, and `docs/execution-timeline.md` updated for the suspension path and the widened checkpoint row. `docs/options-index.md` is untouched (no option was added). `npm test` is green in all six stages with no budget rebaseline — the new fields are additive and no export was added.
    - References:
      - Plan 092 Task 1 findings #3 (why `ask` was rejected) and `Compromises Made`; `src/agent-session/session/tool-round.ts:282-300`; `matchStickyDecision`; `src/agent-approval.ts:138-210` (decision validation and sticky scope); `src/__tests__/run-decisions.test.ts` (suspension/resume test shape).
  - Test Cases to Write:
    - Durable approve: an `ask` match suspends with the rule id in the interruption/pending reason; `allow_once` dispatches once and the effect store records one execution.
    - Durable sticky: `allow_for_run` on the same scope does not suspend on the next matching call; a different scope still does.
    - Durable deny: `reject_once`/`reject_for_run` produce a refusal-shaped result naming the rule, with no dispatch and no effect record.
    - Non-durable: the call is blocked with the rule named, the run continues to a normal finish, and no `GuardrailError` surfaces.
    - Compile failures: `ask` + `deny`, unknown action value, and an `ask` rule that cannot suspend still fail at session creation with `GuardrailPackError` (repo-wide grep for the retired "unsupported action / ask" message in docs, scripts, examples, workspaces).
    - Eval: scenario assertion that an `ask`-blocked call scores as a pack-rule denial (`createGuardrailPackScorer`) rather than a generic tool error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — pack action vocabulary, suspension behavior, and pending-decision fields.
    - Docs pages to create/edit:
      - `docs/guardrails.md`: `ask` row in the action table, the durable requirement, and the non-durable block behavior.
      - `docs/durable-runs.md`: selective suspension from a pack rule alongside `interruptBeforeTool`.
      - `docs/execution-timeline.md`: the guardrail step for an `ask` decision (status/identity) if it differs from a deny.
      - `docs/options-index.md`: only if a new option is added (the intended design adds none).
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Refusal text — the model sees which rule refused the call (P2)
  - Acceptance Criteria:
    - Functional: a pack-blocked call's `ToolResult.error.message` names the rule (`pack:<pack>/<rule>` plus the pack's bounded reason when configured) at both guardrail stages, instead of the generic `Tool call blocked by guardrail` / `Tool result blocked by guardrail` (`src/tools.ts:227`, `:331`).
    - Functional: `tool_execution_blocked.reason` keeps its machine code (`guardrail_blocked`); the event's `error.message` carries the same bounded text as the result; the ledger/tool-call record keeps the code, not the free text.
    - Functional: a `tripwire` decision keeps failing the run (unchanged), and a hand-written guardrail with no pack identity keeps a neutral message rather than an empty or synthesized one.
    - Performance: O(1) string construction on a path that already throws/blocks; the message is bounded (a fixed cap, e.g. 200 bytes, asserted by a test) so no unbounded reason can reach the model context.
    - Code Quality: one helper builds the text from the terminal decision record (no per-call-site formatting), so the two stages cannot drift; `blocked()` keeps its signature shape (`reason` code + `ErrorInfo`) with the message derived, not passed ad hoc.
    - Security: the text is redacted with the active redactor before it enters the result and event; tool arguments never appear; the rule identity is bounded and cannot be host-injected through a tool result.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md` (refusal semantics), `docs/tools.md` / `docs/agent-events.md` (`tool_execution_blocked` shape), `docs/credentials-and-redaction.md` (redaction ordering at the tool boundary).
    - Options Considered:
      - One generic message that only names the pack id — rejected: a host debugging which rule fired needs the rule id, and the id is already bounded (`pack:<pack>/<rule>`).
      - Passing the full `GuardrailDecision` record into the result — rejected: `record.reason` is free text and the raw record carries more than the model needs; the bounded identity line is the contract.
      - Leaving the message unchanged and relying on the timeline — rejected: the model keeps retrying the same blocked call, which is the failure mode this item exists to fix.
    - Chosen Approach: derive one bounded, redacted identity line from the terminal decision record and use it at both guardrail stages.
    - API Notes and Examples:
      ```ts
      // blocked result seen by the model (ErrorInfo: message only unless a code is set)
      { toolCallId: "call_1", name: "write", error: { message: "Blocked by guardrail rule pack:coding-standard/no-test-rewrites: Writing test files requires approval (pack rule)" } }
      ```
    - Files to Create/Edit:
      - `src/tools.ts`: message derivation at both guardrail call sites and inside `blocked()`.
      - `src/guardrails.ts`: expose the bounded identity/reason accessor used by the helper if `record` does not already carry it publicly.
      - `docs/guardrails.md`; `docs/agent-events.md` if the event's `error.message` is documented by example.
      - Result: shipped as reviewed, with one strengthening. The helper reads a pack identity from the terminal record's `metadata` (`{ pack, rule }`, which only the compiler writes) instead of sniffing the `pack:` name prefix, so a host-written guardrail called `pack:…` cannot be presented to the model as a pack rule; `src/guardrails.ts` needed no change — `record.reason`/`record.metadata` are already redacted and bounded where the record is built (`MAX_REASON_BYTES` 4 KiB, pack names compiler-bounded to 128 bytes), which is why the identity always survives the 200-byte cap and only a long reason is truncated. Compiler-synthesized default reasons (`guardrail pack rule <pack>/<rule>`) are omitted rather than echoed after the identity.
      - Result (both stages): `blocked()` was left alone — it already emitted the same `error` object on the event and the result while keeping `reason` as the machine code, and the ledger row keeps `reason` plus the (already recorded) result, so no free-text field was added. The helper serves both guardrail call sites, but the pack branch is only *reachable* at `tool_input`: packs compile rules onto `tool_input` only, and their `tool_output` observer never denies by contract (`GuardrailPackRules.observe` is allow-only, a throw fails closed as a tripwire), so a pack block at `tool_output` cannot occur. The `tool_output` site is still pinned by test through its neutral line, and recorded here so the AC's "both stages" is not read as an untested gap.
      - Result (repo sweep): the neutral strings stay byte-identical (`Tool call blocked by guardrail` / `Tool result blocked by guardrail`), so `src/__tests__/guardrails.test.ts:183` and `packages/prism-core/src/runtime/workflows/__tests__/run.test.ts:569` keep passing unchanged. Docs updated: `docs/guardrails.md` (the bounded format, neutral fallback, and where the text lands), `docs/tools.md` (Guardrails section), `docs/agent-events.md` (`tool_execution_blocked` row documents `reason` as the machine code and `error.message` as the bounded text).
    - References:
      - Plan 092 Task 1 finding #4 (refusal text) and Task 2's rule identity; `src/redaction.ts`; `src/__tests__/guardrail-packs.test.ts` assertions on blocked results.
  - Test Cases to Write:
    - Pack block at `tool_input` and at `tool_output`: the result and the event name the rule; the message is ≤ the cap; arguments do not appear.
    - Hand-written guardrail block: message stays neutral and names the guardrail, not a fabricated pack id.
    - Redaction: a secret-shaped reason is redacted in the message (asserted with a configured redactor).
    - Regression: `tripwire` still fails the run with its existing error code and the tool never executes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — model-visible refusal text and the event's error message.
    - Docs pages to create/edit:
      - `docs/guardrails.md`: what a blocked call tells the model, with the bounded format.
      - `docs/tools.md` (or `docs/agent-events.md`): the `tool_execution_blocked` message/field note.
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Subscriber ownership — opt-in across-run subscriptions (P2)
  - Acceptance Criteria:
    - Functional: `SubscribeOptions` gains `acrossRuns?: boolean` (default `false`). A default subscriber behaves exactly as today: it is closed at run end by `cleanupRun` (`src/agent-session/session/persist.ts:292`) and by `recordDurableResumption`/`recordDurableDenial` (`src/agent-session/session.ts:337`, `:357`). An `acrossRuns: true` subscriber survives run ends, keeps receiving the next run's events on the same session, and is closed only by the host (`subscription.close()`) or by `session.closeSubscribers()`.
    - Functional: `session.stream()` no longer depends on the run-end close — it closes its own subscription in `finally` and still terminates on success, failure, and early consumer return (abort path unchanged).
    - Functional: `session.subscribe()`'s doc comment and `docs/agent-events.md:13` / `docs/agent-session-runtime.md:67` describe the opt-in and its lifetime; the overflow behavior (`close`, `drop_oldest`, `drop_newest`) applies identically to across-run subscribers.
    - Performance: no change for default subscribers; an across-run subscriber holds its bounded queue (`maxQueuedEvents`, default 1024) for the session's lifetime instead of one run — the docs line states that cost per subscriber and that there is no background work, timer, or durable queue.
    - Code Quality: run end calls a narrowly named close (`closeRunSubscribers()`) and `closeSubscribers()` keeps its all-subscribers meaning; `EventSubscriber` keeps self-unregistering on close, so no new registry or lifecycle API is added.
    - Security: an across-run subscriber cannot observe another session's or another ownership scope's events (it is the same session-scoped broadcaster, redacted per event as today); no subscriber state survives session teardown, and an aborted run still closes nothing that the host owns explicitly.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md:13,296` (long-lived claim, overflow semantics), `docs/agent-session-runtime.md:63,67,181` (`stream()` vs `subscribe()`, broadcaster guarantees), plan 092 `Compromises Made` (the contract mismatch recorded while fixing `runScenario`).
    - Options Considered:
      - Change the default to "subscribers live until the session is disposed" — rejected: `stream()` and the documented example pattern (`start consumer, await run`) rely on run-end close to terminate; existing hosts would hang or leak.
      - Require `session.stream()` to keep relying on the run-end close and only add the flag for `subscribe()` — rejected as the implementation, because `stream()`'s correctness would still depend on a close it does not own; closing its own subscription is the smaller, more honest change.
      - A separate `session.subscribeLongLived()` method — rejected: a second entry point for one flag; and it would need the same `SubscribeOptions` bounds anyway.
      - A durable queue for across-run subscribers — rejected: out of scope; live subscribers stay in-memory and bounded, durable replay is the ledger/`AgentEventSource` path (`docs/agent-events.md:15`).
    - Chosen Approach: one option on the existing `SubscribeOptions`, with run end closing only run-scoped subscribers and `stream()` owning its own subscription.
    - API Notes and Examples:
      ```ts
      const subscription = session.subscribe({ acrossRuns: true, maxQueuedEvents: 256, overflow: "drop_oldest" });
      const consumer = (async () => { for await (const event of subscription) observe(event); })();
      await session.run("first");
      await session.run("second"); // same subscriber, still open
      subscription.close();
      await consumer;
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts:203-208`: `SubscribeOptions.acrossRuns`.
      - `src/agent-session/session.ts`: subscriber registration flag, `closeRunSubscribers()`, `stream()` owning its subscription.
      - `src/agent-session/session/persist.ts`: `cleanupRun` calls the run-scoped close.
      - `docs/agent-events.md`, `docs/agent-session-runtime.md` (+ `docs/options-index.md` if `SubscribeOptions` is listed there).
      - Result: shipped as reviewed. `SubscribeOptions.acrossRuns` (`src/contracts-core/agent.ts`) is read once into `EventSubscriber.acrossRuns`; run end now calls the new `closeRunSubscribers()`, which closes every subscriber that did not opt in — from `cleanupRun` (`src/agent-session/session/persist.ts`) and from `recordDurableResumption`/`recordDurableDenial`, so a suspension and a denial free run-scoped subscribers exactly as before while an `acrossRuns` one survives to the next run. `closeSubscribers()` keeps its all-subscribers meaning (session teardown) and stays off the public `AgentSession` interface — no lifecycle API was added, and the host ends an across-run subscription by breaking out of the `for await` (the iterator's `return()`), which is what `subscribe()` returns today; the plan's `subscription.close()` is the internal spelling, so the docs use the iterator form. `SessionHost` gained `closeRunSubscribers()` (internal type; test fakes cast through `unknown`, no fake needed a change).
      - Result (stream): `stream()` now takes its subscriber from a private `createSubscriber()` (shared with `subscribe()`), closes it in `finally`, and closes it when the owned run settles. That last part fixes a real hang rather than only satisfying the AC: `executeRun` validates options *before* its `try/finally` (`src/agent-session/session/assemble.ts:548-581`), so a pre-flight rejection (e.g. the removed `maxToolRounds` alias) reaches `stream()` with no events and no run-end cleanup — the consumer loop used to park forever, because the run rejection was only observed after the loop ended. Verified by test (rejects with the validation error, then the session runs again) and by the unchanged abort path: terminal events first, then the `AgentRunError` with `status: "aborted"`, and an across-run subscriber the host owns is not closed by that abort.
      - Result (docs): `docs/agent-events.md:13` no longer claims a default `subscribe()` is long-lived; `docs/agent-session-runtime.md:63,67` state run-scoped-by-default, the opt-in lifetime, `closeRunSubscribers()` vs `closeSubscribers()`, and that `stream()` owns its subscription; the guarantees list at `:181` carries the cost line (one bounded queue — default 1024 events, no background work, no durable queue, session-scoped so it cannot observe another session's or ownership scope's events); `docs/options-index.md` gained the `SubscribeOptions.acrossRuns` row. `runScenario`'s per-turn `collectWhileRunning` workaround was left in place (default behavior is unchanged, and the runner scores per turn) with its comment amended to name the opt-in so it does not read as the only option.
    - References:
      - `EventSubscriber` implementation and overflow notice (`event_subscriber_overflow`); plan 092's `runScenario` per-turn subscription fix (the workaround this task retires); `docs/options-index.md` entry for `SubscribeOptions` if one exists.
  - Test Cases to Write:
    - Multi-run: one `acrossRuns: true` subscriber receives events from two sequential runs of the same session and is still open after both.
    - Default compatibility: a default subscriber is closed at run end; `stream()` still throws/returns in the same way on success, failure, abort, and early consumer return.
    - Overflow: an across-run subscriber with `maxQueuedEvents: 1` still gets the overflow notice and closes under the default `close` policy; `drop_oldest` keeps serving later runs.
    - Teardown: `session.closeSubscribers()` closes an across-run subscriber and the consumer loop ends; the session can then be garbage-collected with no listener retained.
    - Regression: `runScenario` and the existing example patterns (`examples/discover-skills.ts:57` style) still work unchanged — and the per-turn subscribe workaround in `runScenario` is left in place unless the task shows a default-behavior run survives the change.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `SubscribeOptions` surface and subscriber lifetime.
    - Docs pages to create/edit:
      - `docs/agent-events.md`: the opt-in, lifetime, overflow parity, and the buffer-cost line.
      - `docs/agent-session-runtime.md`: `subscribe()` long-lived paragraph reconciled with actual behavior; `stream()` owns its subscription.
      - `docs/options-index.md`: `SubscribeOptions.acrossRuns` row.
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: Decision-time revalidation includes session pack rules (P3)
  - Acceptance Criteria:
    - Functional: `validateModifiedArguments` (`src/agent-approval.ts:213-259`) evaluates the resumed session's compiled pack guardrails in addition to `agent.config.guardrails`, so an approval that edits arguments into a pack-violating state is rejected at decision time with `ERR_PRISM_DECISION_INVALID` and the rule named in the bounded message — instead of being accepted and only stopped at dispatch.
    - Functional: the extra guardrail list is passed in from the resumed session (`prepareAgentRunResume` call sites at `src/agent-run-lifecycle.ts:262,264`), not read from a global: a resume with no packs behaves exactly as today, and a build path with no session keeps today's behavior.
    - Functional: a decision whose modified arguments trip a pack `ask`/`deny` rule never becomes a sticky `allow_for_run` for that argument set (the sticky scope already drops `argumentsHash` for modified arguments — a test pins that the pack cannot be bypassed by an `allow_for_run` edit).
    - Performance: one extra guardrail evaluation per modified-argument decision (the same bounded scan), no extra provider turn, no checkpoint write beyond the decision already being recorded.
    - Code Quality: one optional parameter (`guardrails`) threaded through `resolveRunDecisions` rather than a second revalidation function or an `agent.config` mutation; no public export change, no baseline regeneration.
    - Security: revalidation stays fail-closed — a missing pack list on a run that *should* have packs is a bug, so the call site passes the restored list explicitly and a test asserts the deny path fails closed when the pack list is present; the decision error message stays bounded and redacted and never echoes the edited arguments.
  - Approach:
    - Documentation Reviewed:
      - `docs/durable-runs.md` (approve-with-edits semantics), `docs/guardrails.md` (pack enforcement points), `docs/agent-session-runtime.md:208` (which checks re-run at resume: `Prism CAS-claims approval before work, rechecks normal guardrail/permission/validation/limit paths`).
    - Options Considered:
      - Leave decision-time revalidation as-is and rely on dispatch — rejected by this follow-up: the host gets a success-shaped decision, the run only dies at dispatch, and the audit trail shows an accepted approval that the pack refused.
      - Merge packs into `agent.config.guardrails` upstream — rejected: that widens enforcement to every session of that agent, which is exactly what session-scoped packs must not do.
      - Compile packs into the checkpoint and evaluate them directly in `agent-approval.ts` — rejected: duplicate compile + a second enforcement path; the resumed session already holds the compiled guardrails after Task 2.
    - Chosen Approach: thread the resumed session's compiled guardrails into `resolveRunDecisions`, and let the existing `runGuardrails({ stage: "tool_input" })` call reject with the rule named.
    - API Notes and Examples:
      ```ts
      const resolved = await resolveRunDecisions({ agent, state, decisions, guardrails: session.packGuardrails, signal });
      // modified arguments that trip pack:coding-standard/no-unrelated-file-edits →
      // AgentDecisionError("ERR_PRISM_DECISION_INVALID", "Modified arguments blocked by guardrail rule pack:coding-standard/no-unrelated-file-edits")
      ```
    - Files to Create/Edit:
      - `src/agent-approval.ts`: optional `guardrails` in `resolveRunDecisions`, merged inside `validateModifiedArguments`, bounded message naming the rule.
      - `src/agent-run-lifecycle.ts`: pass the resumed session's pack guardrails at both decision call sites.
      - `docs/durable-runs.md`: the rechecked list includes session pack rules.
      - Result: shipped as reviewed, with two decisions worth naming. (1) The refusal derivation moved: `guardrailRefusalText(record, prefix)` now lives in `src/guardrails.ts` and serves both the model-visible tool refusal (Task 4's `guardrailBlockMessage` is a two-line wrapper keeping its neutral stage text) and this decision error — one place decides what counts as a pack rule, so the two enforcement paths cannot drift on the metadata gate, the synthesized-default-reason omission, or the 200-byte cap (the cap now lives with the derivation; `MAX_BLOCK_MESSAGE_BYTES` in `src/tools.ts` is gone). (2) The extra list is the session's `packGuardrails` plus its `packAskBlocks`, not `packGuardrails` alone: `ask` rules must be included for this task's "a decision whose modified arguments trip a pack `ask`/`deny` rule" case, and they only terminate when compiled as blocks — the `askGate` variant evaluates to `interrupt`, which `runGuardrails` reports as non-terminal and would therefore wave through. Composed at the resume call site before the pending-decision block and passed to both `resolveRunDecisions` calls (legacy `approve` and a batch); `validateModifiedArguments` merges it with `agent.config.guardrails` for the `tool_input` stage only, so the agent config is never mutated and other sessions of that agent do not inherit packs.
      - Result (deviation): the plan's Code Quality line said "no public export change, no baseline regeneration". The public/barrel surface is unchanged (`guardrailRefusalText` is not re-exported from `src/index.ts` and does not appear in `dist/index.d.ts`), but the budget gate counts `export function` in `src/**`, so it needed `scripts/budgets.json` `@arnilo/prism` 1450 → 1451 with a reason entry (same precedent as Task 2), and `docs/_evidence/phase54-package-map.md` was regenerated because its per-package export counts were stale (`node scripts/package-truth.mjs --emit-docs`). The compat baseline needed no regeneration.
      - Result (tests): `src/__tests__/guardrail-pack-decision-revalidation.test.ts` (4) — an edit that still matches an `ask` rule is refused with `ERR_PRISM_DECISION_INVALID` naming `pack:deploy-guard/ask-prod-version` and its reason, never echoing the edited arguments, with zero dispatches and the checkpoint left at the suspended version (atomic), and the same suspension still decidable as-is; a benign edit (`staging-2`) dispatches the edited call, so the pack is not blanket-refusing; an edit into a `deny` rule under an `interruptBeforeTool` gate is refused instead of letting the run die at dispatch, while a non-matching edit proceeds; an `allow_for_run` with a pack-violating edit writes no sticky decision (the identical edit is refused again afterwards) while an unedited `allow_for_run` still resumes. The durable options set `persistSessionState: true`, since that is what carries the pack refs to the resume the task depends on. Existing no-pack behavior is pinned unchanged by `src/__tests__/run-decisions.test.ts` (approve-with-edits still rewrites arguments freely when no pack is configured). Effect-store criterion: asserted as "nothing was dispatched" — an effect record can only be written by a dispatched call — rather than by building a bespoke effect-key assertion.
    - References:
      - `src/agent-approval.ts:175-200` (modified-argument validation, sticky scope with `argumentsHash: undefined`), plan 092 Task 1 finding on the early-rejection gap, `src/__tests__/run-decisions.test.ts` (approve-with-edits coverage).
  - Test Cases to Write:
    - Resume with `modifiedArguments` that violate a pack rule: the decision is rejected with the rule named, the tool does not dispatch, and the effect store records nothing.
    - Resume with benign `modifiedArguments`: dispatches as today and the pack rule does not fire.
    - No packs / no session: behavior identical to pre-change (pinned by the existing decision tests).
    - `allow_for_run` + a pack-violating modification: the edit is rejected, and the sticky decision does not later permit that argument set.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume-time decision validation semantics.
    - Docs pages to create/edit:
      - `docs/durable-runs.md`: the revalidation list and what an approve-with-edits decision can still not bypass.
      - `docs/guardrails.md`: enforcement point list includes decision-time revalidation.
    - `docs/index.md` update: no (existing pages only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7: Runnable guardrail-pack walkthrough (P3)
  - Acceptance Criteria:
    - Functional: `examples/guardrail-packs.ts` runs network-free (scripted mock provider, in-memory checkpoints) and demonstrates, in one file: a session with two built-in packs, a blocked `write`/`shell` call whose refusal names the rule, an eval scenario graded by `createGuardrailPackScorer()` with the rule named, and (after Task 3) a durable `ask` decision that suspends and is approved.
    - Functional: the example prints what it demonstrates in the house style of the existing demos (one line per step), so `node examples/guardrail-packs.ts` is self-explaining output rather than a silent pass.
    - Functional: it is added to the `examples/README.md` runnable list with a one-line description, and to the examples enumeration in `docs/index.md:219`.
    - Performance: the example finishes in seconds with no network, no filesystem writes outside a temp store, and no provider credentials; it is not part of the hermetic test suite unless a `scripts/e2e-*` journey already runs examples.
    - Code Quality: typed and compile-checked with the rest of `examples/` (`tsc -p examples`), no `any`, no unused imports, and no duplicated harness code — it reuses the mock provider and scripted-scenario helpers already present in the repo.
    - Security: the example never prints a secret-shaped value (a `secrets-hygiene` step uses an obviously fake token), never writes outside a temp directory, and states in a comment that pack rules are restrictive-only.
  - Approach:
    - Documentation Reviewed:
      - `examples/README.md` (runnable list and description style), `docs/guardrails.md` (the API it demonstrates), `docs/evaluations.md` (scorer usage), `examples/behavior-evaluation.ts` and `examples/behavior-evaluation.js` (scripted scenario + scorer shape), `examples/durable-loops-and-approvals.ts` (durable demo shape).
    - Options Considered:
      - A docs snippet inside `docs/guardrails.md` instead of an example file — rejected: the docs page already carries the API; a runnable file is what a host can copy and check.
      - Extending `examples/behavior-evaluation.ts` — rejected: that file is a host-journey demo with a different focus; a new file keeps both readable.
      - Adding a CLI `prism eval` surface — out of scope (plan 092 Task 1 confirmed no such CLI).
    - Chosen Approach: one new network-free example file plus the two index rows, reusing the existing mock/scripted helpers.
    - API Notes and Examples:
      ```ts
      const session = agent.createSession({ guardrailPacks: ["coding-standard", "destructive-commands"] });
      const result = await session.run("delete the tests directory and push --force");
      // → refused results naming pack:coding-standard/no-test-rewrites and pack:destructive-commands/no-force-push
      ```
    - Files to Create/Edit:
      - Result: `examples/guardrail-packs.ts` (new) runs in 0.17 s with no network, no credentials and no writes outside memory stores, printing one line per step plus the demo's usual trailing JSON line — `demo()` is exported and the `import.meta.url === file://argv[1]` footer matches the other runnable demos, so the walkthrough and the machine-readable summary both stay in the house shape. Output: two built-in-pack refusals naming `pack:destructive-commands/no-force-push` and `pack:coding-standard/no-test-rewrites` (neither call reached its tool), a `createGuardrailPackScorer()` evaluation at score 0 whose reason names `pack:destructive-commands/no-recursive-force-delete`, an inline `ask` rule suspending on `pack:deploy-guard/ask-prod-version` and dispatching once after `allow_once`, and a `secrets-hygiene` refusal naming its rule with the token asserted absent from the message.
      - Result (deviation): the AC's "graded by `createGuardrailPackScorer()` with the rule named" is a *failing* grade by design — the scorer's contract is "fails when a guardrail pack denied the trajectory", so the named rule arrives in `EvaluationRecord.reason` and the scenario is the evidence that a violation cannot pass silently; the `forbidTools` option additionally proves enforcement, since a pack that stopped blocking would fail on "forbidden tool executed" instead. Step 1 reads refusals through `SessionStore.list` on purpose: tool results are appended to session history and are not `AgentEvent`s, and the model-visible `tool_result` is what the step demonstrates.
      - Result (gotcha kept in the file): a scripted provider must advance its turn counter *before* yielding — a consumer stops pulling at `providerDone()`, so an `index += 1` after the yield loop never runs and turn 1 replays until the turn limit (first draft: 16 refusals instead of 2).
      - Result (security): the `secrets-hygiene` token is `sk-TESTONLYFAKEKEY1` — 16 alphanumerics, i.e. long enough to match the pack's own `sk-[A-Za-z0-9]{16,}` pattern while staying below a real key's 20+, and the step asserts the refusal never contains it. The header comment states that pack rules are restrictive-only (they narrow seams, never grant). Index rows: `examples/README.md` runnable list plus its Files entry (the docs gate requires every `examples/*.ts` to be listed) and the `docs/index.md` enumeration.
      - Result (test row): no `scripts/e2e-*` journey runs examples, so per the plan the run row is the smoke command — `npm run build:core && node examples/guardrail-packs.ts` exits 0, and the file's own assertions (refusals present, rule identities named, nothing executed, no token echo) fail loudly on regression. `tsc -p examples --noEmit` is clean.
    - References:
      - `examples/README.md` runnable list; `packages/prism-core/src/governance/evals/__tests__/guardrail-pack-scenarios.test.ts` (the scorer usage to mirror); `docs/index.md` testing/examples section.
  - Test Cases to Write:
    - Compile/typecheck row: the file typechecks under `tsc -p examples` (the repo's existing example gate).
    - Run row: executing the example exits zero and its output contains the rule ids it claims to demonstrate (a `scripts/*-doc-check`-style or example-runner assertion if the repo runs examples in CI; otherwise a smoke command recorded in the task note).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (example only), but host-facing documentation improves.
    - Docs pages to create/edit:
      - `examples/README.md`: runnable row with a one-line description.
      - `docs/index.md`: add the example to the existing examples enumeration (navigation update because the file becomes part of the shipped example surface).
    - `docs/index.md` update: yes — append `guardrail-packs.ts` to the example list at `docs/index.md:219`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Task 2/3 scope widening (the one that mattered): persisting pack refs alone would have left every `ask` rule unenforceable after the resume it exists to gate, so the checkpoint also carries *pattern-only* inline packs (rules with `pattern`, never `deny` predicates or `RegExp` instances). A checkpoint therefore holds host-configured pack rows, which is bounded by the existing 8-packs/96-char/8 KiB caps and validated on read; a pack whose rules cannot be snapshotted still fails closed at save time rather than silently under-enforcing.
- Task 3 enforcement seam: a pack `ask` is enforced at charge time (`bindChargeToolRound`), because `interrupt` at the dispatch stage still throws `ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`. Consequences: an `ask` rule must be pattern-based (no opaque `deny` predicate — a pending decision has to be explainable), it is recorded as the gate's own action (`interrupt` durably, `block` when the run cannot suspend) rather than as an action of its own, and `tool_output` remains unreachable for suspending rules.
- Task 4 reach: packs can refuse only at `tool_input`. `tool_output` packs are observe-only (`observeGuardrail` always allows), so the refusal-text contract there covers hand-written guards with a neutral message; the pack-naming form applies wherever a pack can actually terminate a call.
- Task 5 surface: `acrossRuns` plus `stream()`'s own-subscription lifetime fixed the contract, but `closeSubscribers()` stays off the public `AgentSession` interface — hosts keep the documented `subscribe`/`stream` ownership semantics rather than a new teardown method.
- Task 6 budget deviation: the shared refusal derivation is a `src/**` export even though it never reaches the root barrel, so the export ceiling moved 1450 → 1451 and the Phase 54 evidence was regenerated (`node scripts/package-truth.mjs --emit-docs`); the compat baseline was untouched, and the plan's "no baseline regeneration" line was therefore not literally achievable.
- Task 7 evidence: the example is not part of the hermetic suite (no example runner exists in CI), so its assertions plus the recorded smoke command are the row; the run is 0.17 s if the repo ever adds one.

## Further Actions

- (P3) `snapshotRunBundle` still has no in-repo production caller, so nothing wires a resumed session's packs into a bundle: a host that snapshots a resumed run must pass `packs: session.guardrailPackRefs` itself or the bundle reports the config it supplied rather than what the session enforces. Derive the refs from the session when the caller omits them if a real host hits the mismatch.
- (P3) A pack `ask` cannot gate `tool_output` (observe-only stage). If a host needs output approval, that wants a dispatch-stage output seam, not another gate at charge time — demand-gated.
- (P3) The charge-time ask probe adds one `runGuardrails` pass per tool call on durable runs with ask rules (9 rules ≈ 7 µs, measured in Task 1). If `interrupt` ever lands at the dispatch stage, fold the probe back into the ordinary `tool_input` evaluation and delete the split.
- (P4) `guardrailRefusalText` is a `src/**` export that no host can reach; if a third caller appears, move it behind a non-exported module boundary so the export ceiling stops paying for it.
- (P4) No CI row runs any example; `examples/guardrail-packs.ts` is a 0.17 s candidate for a `scripts/examples-smoke.test.mjs` if such a gate is ever added.