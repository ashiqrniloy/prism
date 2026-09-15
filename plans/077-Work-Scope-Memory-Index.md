# 077 — Work-Scope Memory Index

Roadmap phase: **0.7.0**, **plan 3 of 7** in the extended line (**072, 073, 074, 075, 077, 078, 079**). Does **not** wait on [072](072-Host-Eval-And-Observability-Cockpit.md) (no eval/timeline dependency). May run **in parallel** with [073](073-Release-0-7-0-Host-Completeness.md) and [074](074-Attention-Compiler.md). [073 Tasks 27–29](073-Release-0-7-0-Host-Completeness.md) (the 0.7.0 cut) are **deferred until this plan and the rest of the line are closed** and must include this plan’s evidence. Do **not** publish after any single plan alone.

Baseline: `@arnilo/prism-memory` observational memory as shipped on **0.6.0**. Do not edit plan 072 while it is in progress.

Supersedes [076 — Observational Memory Mastra Parity](076-Observational-Memory-Mastra-Parity.md): no `om.current_task`, no KEEP/budget dropper as the working-set mechanism. Observer default-instruction tightening still ships here (Task 6).

Constraint: Prism stays a **harness**. Work scopes are **opt-in**. No attach and no `om.scope.*` entries → today’s OM byte-for-byte (global active pool + existing dropper). No hosted memory studio. No resource-scoped OM. Defaults stay **domain-neutral** (`DEFAULT_OBSERVER_INSTRUCTION` must not contain `coding`). Do not put this inside `runWorkflow`.

## Product Boundary

- **In:** host-named scope tree, bind table from scopes → OM observation/reflection ids, active stack, `projectWorkMemory` query as the working set, leaf-only auto-bind on flush, `withWorkScope` helper, context-block render of the projected set + scope outline, dropper skipped when any host scope exists, domain-neutral observer instruction + existing-observation prompt.
- **Out:** baked `phase | plan | task` enum. Auto-include all siblings. Auto-include closed phase 1 in phase 2. Budget/ceiling drop as GC. `om.current_task`. Resource-scope OM. Log rewrite. Fourth OM worker. Attention Compiler (074). Memory Fabric (075). Graft/wiki. Working-memory extractors. Workflow runtime auto-enter `nodeId`. Bind targets other than OM observation/reflection ids.

## Locked forks

| Fork | Choice |
| --- | --- |
| Auto-bind | **Leaf only** (not leaf+ancestors). Promotion is explicit `bind`. |
| Closed ancestor in `self+ancestors` | **Include** (still in play as constitution). |
| `runWorkflow` auto-enter | **Helper only** (`withWorkScope`). Not inside the runner. |
| 076 budget-drop / current-task | **Scrapped.** Observer text only (Task 6). |
| Bind targets day one | **OM observation + reflection ids only.** |

## Picture

OM ledger = the **log**. Work scopes = the **index**. Compiler (074, same 0.7.0 cut) = the **packer**. Fabric (075, same extended 0.7.0 line) = **cross-session**.

Retention is a **query**, not a delete. Task-1 episodes stay on `task:1`. Task 15 sees them only if the host bound them onto an ancestor (`plan:…` / `phase:…` / `roadmap:…`). Phase 2 does not dump phase 1.

```
open  roadmap:0.8
open  phase:1            parent=roadmap:0.8
open  plan:074           parent=phase:1
open  task:1             parent=plan:074
  flush → new OM ids auto-bind to task:1
close task:1
open  task:15
  project(from=task:15, include=self+ancestors)
  // task:15 + plan:074 + phase:1 + roadmap  (not task:1 unless promoted)
close task:15
bind  selected reflection ids → phase:1
close plan:074 / phase:1
open  phase:2
  project(from=phase:2, include=self+ancestors)
  // roadmap + phase:2 + promoted phase:1 binds; full phase:1 still recallable by id / closed query
```

Do not confuse `WorkScope` with `MemoryScope` (tenant/resource/thread) or `OwnershipScope` (tenant/account/user).

## Objectives

- Give hosts four verbs — **open / bind / project / enter** — so they can build their own session memory systems (coding roadmap→plan→execute loops included) without Prism inventing that ontology.
- Stop using the OM dropper as the working-set mechanism when hosts declare scopes.
- Keep the OM ledger append-only and exact-id recall intact.
- Keep attach-off and unscoped attach compatible with 0.6.0.

## Expected Outcome

- Public helpers on `@arnilo/prism-memory/compaction/observational-memory`: `foldWorkScopeMap`, `projectWorkMemory`, `createWorkScopeController`, `withWorkScope`, plus custom-entry types `om.scope.*`.
- Default OM context block, when any host scope exists: projected `self+ancestors` from the leaf, with a scope outline, then reflections, then observations. No host scopes: today’s full active pool.
- Example `examples/work-scopes-coding-loop.ts` (mock provider): nested roadmap/phase/plan/task, task-1 hidden from task-15 until promote, closed-phase library query.
- Docs: `docs/compaction-observational-memory.md` current-line; `docs/index.md` one-sentence blurb if the contract sentence changes.
- 073 Tasks 28–29 (the cut) will not run if this plan’s checkboxes are open; Task 27 already shipped the journey/evidence matrix that keeps this plan’s row `blocked`.

## Requirements

| ID | Requirement |
| --- | --- |
| S1 | Opt-in. No `om.scope.*` entries → fold is implicit root `session` only; projection equals today’s active observations/reflections; dropper unchanged. |
| S2 | `WorkScope`: `{ id, parentId?, kind?, label?, status: "open" \| "closed" }`. `kind`/`label` opaque strings. No required enum. Reserved id `session` is the implicit root (always open, never host-opened/closed). |
| S3 | Tree, not DAG. `open` fails closed on missing/closed parent, duplicate id, reserved id, cap breach. `close` does not delete binds or OM records. Closing a stacked id pops it and every frame above it. |
| S4 | Bind `{ scopeId, ref }` where `ref` is `om:<12-hex>` or `reflection:<12-hex>`. Many-to-many. Bind to closed scopes allowed (promotion). Unknown scope or unknown OM id → reject. Unbind does not delete the OM record. |
| S5 | Active stack via `enter`/`leave` custom entries. `enter` requires open scope; recomputes stack as root→…→id. `leave` pops the leaf (`session` never pops). |
| S6 | Auto-bind on flush: new observation/reflection ids from that flush bind to the **leaf only**. If leaf is `session`, that is the unscoped pool. |
| S7 | `projectWorkMemory(ledger, map, { from, include, closed?, kinds? })`. `include`: `self` \| `self+ancestors` \| `self+descendants` \| `lineage`. Default context path: `from=leaf`, `include=self+ancestors`, `closed=hide`. `closed=hide`: omit closed scopes **except** ancestors of `from` (those stay). `closed=include`: every matched scope. Exact-id `recallObservationalMemory` ignores the projection. |
| S8 | Token/byte GC is **not** this plan. Dropper runs only when the map has **no host-opened scopes** (unscoped compat). Folded payload byte cap remains a storage crash cap, not “forget task-1”. |
| S9 | `withWorkScope(controller, spec, fn)`: open if missing, enter, `try fn`, `finally leave`. Does **not** close. Not called from `runWorkflow`. |
| S10 | Caps (fail closed): scope id `[A-Za-z0-9._:/-]{1,128}`, no `..`, max 256 scopes/session, depth 8, stack 8, 4096 binds/scope, label 512 chars. Labels/kinds redacted with OM secrets. Same `appendEntry` ownership check as OM. |
| S11 | Render order when scoped: Scope outline (id + label, no payloads) → Reflections → Observations. |
| S12 | Observer default instruction stays domain-neutral and gains: assertions vs questions; user assertions authoritative; supersede state changes; `completed:` only on real completion; preserve identifiers/paths/errors; do not repeat existing observations; single-line prose. Observer prompt includes a bounded list of already-active observations. No `record_current_task`. |

---

## Tasks

- [x] **Task 1 — Primitive review (no ledger types until this lands)**
  - Acceptance Criteria:
    - Functional: Written inventory of OM custom entries, fold/projection/render/context blocks/flush/dropper, `MemoryScope` vs `OwnershipScope` vs this index, workflow `nodeId`/`runId`/`iterationId`, coding `taskId`; reuse vs gap table mapped to S1–S12; explicit reject of resource-scope OM, budget drop as working set, `om.current_task`, workflow auto-enter, bind kinds beyond OM, a new npm package, and stuffing `scopeId` onto `MemoryObservation`.
    - Performance: Docs-only; no runtime change; no new import graph.
    - Code Quality: Evidence file lists current `covers:` file:line for each primitive; names `appendCustom` / `foldObservationalMemoryLedger` / `buildObservationalMemoryContextBlocks` as the seams to extend.
    - Security: Confirms attach-off stays inert; scope labels use the same redaction/byte caps as observations; no new network; no `runWorkflow` patch.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` — four-layer provider, custom-entry table, worker limits, funnel anti-patterns.
      - `docs/working-and-semantic-memory.md` — `MemoryScope` (tenant/resource/thread); **not** this index.
      - `docs/workflows.md` — `nodeId` / `runId` / `iterationId` as optional host scope ids; runner must not auto-enter.
      - `docs/api-page-template.md` / `.agents/skills/create-plan/references/prism-wiki.md`.
      - Plan 076 (superseded) — current-task + KEEP drop are **rejected** product.
    - Options Considered:
      - Put `scopeId` on `MemoryObservation`: one membership, promotion requires rewrite. Reject.
      - New `@arnilo/prism-memory/work-scopes` subpath: extra export for a join table. Reject; same OM subpath.
      - Mastra `scope: "resource"`: unfinished work leaks across threads. Reject.
      - Budget KEEP-dropper as working set (076): cannot see task 15 from task 1. Reject.
    - Chosen Approach:
      - Separate fold (`foldWorkScopeMap`) over `om.scope.*` custom entries; projection joins to the existing OM ledger; auto-bind in `flush`; helper stays in memory package.
    - API Notes and Examples:
      ```ts
      import {
        createObservationalMemory,
        foldObservationalMemoryLedger,
        foldWorkScopeMap,
        projectWorkMemory,
      } from "@arnilo/prism-memory/compaction/observational-memory";
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase77-primitive-review.md`: inventory + reuse table (history path; not an API page).
    - References:
      - `packages/memory/src/compaction/observational-memory/{ledger,projection,render,recent-messages,runtime,compose,types}.ts`
      - `packages/prism-core/src/sessions/codecs/ownership.ts` `assertOwnershipScope`
      - `packages/prism-core/src/runtime/workflows/types.ts` `WorkflowNodeContext.nodeId`
      - `packages/prism-coding-tools/src/agent/coding-checkpoint.ts` `taskId`
  - Test Cases to Write:
    - none (review). Gate: evidence file exists and names S1–S12 against a reuse/gap column.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase77-primitive-review.md`: inventory (history, not `/docs` API).
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (no API page).

- [x] **Task 2 — Scope ledger, controller, caps**
  - Acceptance Criteria:
    - Functional: `om.scope.opened|closed|entered|left|bound|unbound` fold to `WorkScopeMap` (`scopes`, `binds`, `stack`); implicit `session` root; controller `open/close/enter/leave/bind/unbind/leaf` appends via the same `appendEntry` ownership check as OM; S2–S5 and S10 fail closed; bind rejects unknown OM ids (pass ledger or id set); unbind leaves OM records.
    - Performance: Fold O(n) over entries; no provider calls; caps cheap (length/count).
    - Code Quality: Types live next to OM, not on `MemoryObservation`; no `phase|plan|task` union; exported guards `isWorkScopeId` / `isWorkBindRef`.
    - Security: Id charset + `..` reject; labels/kinds redacted; reserved `session` cannot be opened/closed; same-session branch check on append.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` custom-entry table.
      - `docs/session-stores.md` — `SessionEntry.kind: "custom"`, `appendEntry` / `expectedParentId`.
      - `packages/memory/src/compaction/observational-memory/runtime.ts` `appendCustom` (ownership fail-closed).
    - Options Considered:
      - Mutate `ObservationalMemoryLedger` with scope fields: couples two folds. Reject.
      - 12-hex scope ids: blocks host `phase:1` / coding `taskId`. Reject; bounded free ids.
    - Chosen Approach:
      - Sibling fold over the same entry list; controller wraps `appendCustom` pattern.
    - API Notes and Examples:
      ```ts
      const ctrl = createWorkScopeController({ session, appendEntry, secrets });
      await ctrl.open({ id: "phase:1", parentId: "session", kind: "phase", label: "Eval cockpit" });
      await ctrl.enter("phase:1");
      await ctrl.bind("phase:1", ["om:aaaaaaaaaaaa"]);
      foldWorkScopeMap(await session.entries()).stack; // ["session", "phase:1"]
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/append-custom.ts`: shared ownership-checked custom append.
      - `packages/memory/src/compaction/observational-memory/{scopes,compose,runtime}.ts`: types, fold, caps, controller, and shared append reuse.
      - `packages/memory/src/compaction/observational-memory/index.ts`: exports.
      - `packages/memory/src/compaction/observational-memory/__tests__/scopes.test.ts`.
    - References:
      - `runtime.ts` `appendCustom`
      - `types.ts` `isMemoryId`
      - `limits.ts` truncate/redact helpers
  - Test Cases to Write:
    - `fold_empty_is_session_root_only`.
    - `open_enter_leave_close_roundtrip`.
    - `open_rejects_missing_parent_duplicate_reserved_id_bad_charset_dotdot`.
    - `bind_rejects_unknown_scope_and_unknown_om_id`.
    - `bind_to_closed_scope_allowed`.
    - `unbind_does_not_delete_observation`.
    - `close_pops_closed_id_and_frames_above`.
    - `caps_max_scopes_depth_stack_binds_fail_closed`.
    - `append_wrong_session_throws` (same pattern as OM ownership test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new custom-entry types and controller, documented in Task 7 (not a second API page).
    - Docs pages to create/edit:
      - none this task (Task 7).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 3 — `projectWorkMemory` + scoped render + context blocks**
  - Acceptance Criteria:
    - Functional: S7/S11. Default `buildObservationalMemoryContextBlocks` uses `self+ancestors` from leaf when any host scope exists; otherwise today’s full active pool. Outline is ids+labels only. `closed=hide` keeps closed **ancestors** of `from`. Recall-by-id still returns dropped/out-of-projection records.
    - Performance: Projection is set-filter over already-folded arrays; no extra session scans beyond the two folds; render still 256 KiB cap.
    - Code Quality: Do not fork `renderObservationalMemory` into a second renderer — optional outline prepend or options bag. Context provider stays one `observational-memory` block.
    - Security: Outline labels redacted; projection never reads another session’s entries; `kinds` cannot smuggle non-OM refs.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` four-layer table + `renderObservationalMemory`.
      - `docs/context-and-skills.md` — `ContextBlock` title/priority.
    - Options Considered:
      - Fifth context block `work-scopes`: extra prefix noise. Reject; outline inside OM block.
      - Inject all descendants of the current plan (siblings): reintroduces dump. Reject; host promotes.
    - Chosen Approach:
      - Join table query; default path leaf + ancestors; outline then existing reflection/observation sections.
    - API Notes and Examples:
      ```ts
      const entries = await session.entries();
      const view = projectWorkMemory(foldObservationalMemoryLedger(entries), foldWorkScopeMap(entries), {
        from: "task:15",
        include: "self+ancestors",
        closed: "hide",
      });
      // view.observations / view.reflections / view.outline
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/scopes.ts` (project) or `scopes-project.ts` if Task 2 file is already large.
      - `packages/memory/src/compaction/observational-memory/render.ts`: outline section.
      - `packages/memory/src/compaction/observational-memory/recent-messages.ts`: scoped default.
      - `packages/memory/src/compaction/observational-memory/index.ts`.
      - `packages/memory/src/compaction/observational-memory/__tests__/scopes-project.test.ts`.
    - References:
      - `projection.ts` `buildObservationalMemoryProjection`
      - `recent-messages.ts` `buildObservationalMemoryContextBlocks`
      - `recall.ts` must stay unfiltered
  - Test Cases to Write:
    - `task15_does_not_see_task1_until_bind_on_plan`.
    - `closed_ancestor_still_in_self_plus_ancestors`.
    - `closed_hide_omits_closed_non_ancestors`.
    - `closed_include_returns_closed_phase_library`.
    - `unscoped_projection_equals_active_pool`.
    - `render_outline_then_reflections_then_observations`.
    - `recall_by_id_ignores_projection`.
    - `context_block_uses_projection_when_host_scopes_exist`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `projectWorkMemory` + render order; docs in Task 7.
    - Docs pages to create/edit:
      - none this task (Task 7).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 4 — Flush auto-bind + dropper unscoped-only**
  - Acceptance Criteria:
    - Functional: S6/S8. After observer/reflector append, new ids bind to current leaf. Dropper **does not run** when any host-opened scope exists; unscoped attach still drops as today. Folded payload 512 KiB cap unchanged (storage, not GC).
    - Performance: Auto-bind is one extra custom entry per flush that recorded ids (batch refs in one `om.scope.bound`); no extra provider calls.
    - Code Quality: No new worker; no `om.current_task`; do not change `dropObservationsToTarget` preservation math — skip the dropper call instead.
    - Security: Auto-bind uses controller caps; cannot bind ids not just written; secrets already redacted on observation content before bind (bind is ids only).
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` dropper policy table.
      - `runtime.ts` `flush` sequence (observe → reflect → drop).
    - Options Considered:
      - Keep dropper as working-set GC under scopes (076): rejected by product.
      - Change `dropObservationsToTarget` KEEP rules: unused when scoped; extra policy. Reject.
      - Auto-bind leaf+ancestors: task-1 always visible at plan. Reject (fork: leaf only).
    - Chosen Approach:
      - Skip `runDropper` when `foldWorkScopeMap` has a host scope; batch-bind new ids to `leaf`.
    - API Notes and Examples:
      ```ts
      // flush after enter("task:15") → om.scope.bound { scopeId: "task:15", refs: ["om:…", "reflection:…"] }
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/runtime.ts`
      - `packages/memory/src/compaction/observational-memory/__tests__/runtime-scopes.test.ts` (or extend `runtime-drop.test.ts` / `runtime-coverage.test.ts`).
    - References:
      - `runtime.ts` `flush`
      - existing drop tests for unscoped regression
  - Test Cases to Write:
    - `flush_binds_new_ids_to_leaf_only_and_skips_dropper_with_host_scope` — leaf-only batch bind, no ancestor bind, no dropper call.
    - `dropper_still_runs_when_only_implicit_session_and_preserves_drop_count` — unscoped regression.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — dropper default when scoped; docs in Task 7.
    - Docs pages to create/edit:
      - none this task (Task 7).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 5 — `withWorkScope` helper + coding-loop example**
  - Acceptance Criteria:
    - Functional: S9. Helper opens-if-missing, enters, runs `fn`, always leaves. Does not close. Example walks roadmap→phase→plan→task-1→task-15→promote→phase-2 with mock provider; asserts projection membership. Workflow example (in the same file or a comment) shows `functionNode.execute` calling the helper — **no** `runWorkflow` source change.
    - Performance: Helper is try/finally around existing controller calls; example is mock, no live keys.
    - Code Quality: Helper in memory package, not `packages/prism-core/src/runtime/workflows`. Example is not a public contract.
    - Security: Example uses mock provider; no secrets in committed fixtures; scope ids are literals.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` — hosts may use `ctx.nodeId` as `spec.id`; runner stays unaware.
      - `examples/observational-memory-lifecycle.ts` — attach pattern.
      - `examples/durable-coding-workflow.ts` — `taskId` as a good scope id (do not parse plan markdown in OM).
    - Options Considered:
      - Patch `executeNode` to auto-enter `nodeId`: hidden coupling, hosts with non-memory workflows pay it. Reject.
      - Close-on-exit in the helper: phases would close when a nested task helper returns if nested poorly. Reject; close is explicit.
    - Chosen Approach:
      - `withWorkScope` + one mock example that is the host recipe.
    - API Notes and Examples:
      ```ts
      await withWorkScope(ctrl, { id: "task:15", parentId: "plan:074", kind: "task", label: "Wire gates" }, async () => {
        await session.run("implement task 15");
      });
      await ctrl.close("task:15");
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/scopes.ts` (`withWorkScope`).
      - `packages/memory/src/compaction/observational-memory/index.ts` (public export).
      - `examples/work-scopes-coding-loop.ts`.
      - `packages/memory/src/compaction/observational-memory/__tests__/scopes-helper.test.ts`.
    - References:
      - `compose.ts` `attach`
      - `packages/prism-core/src/runtime/workflows/run/node-execution.ts` — do not edit
  - Test Cases to Write:
    - `withWorkScope_leaves_on_throw`.
    - `withWorkScope_does_not_close`.
    - `examples/work-scopes-coding-loop.ts` `demo` asserts task 1 is hidden from task 15 until promotion and phase 2 sees only promoted memory.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `withWorkScope`; docs in Task 7. Example is not a contract.
    - Docs pages to create/edit:
      - none this task (Task 7).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 6 — Observer default instruction + existing observations in prompt**
  - Acceptance Criteria:
    - Functional: S12. `DEFAULT_OBSERVER_INSTRUCTION` encodes the rules; `includes("coding") === false`. `runObserver` prompt includes a bounded list of already-active observations (`joinWorkerText` / `maxMessageBytes`). New observations still append; old contents never rewritten. No `record_current_task`. Reflector/dropper **instructions** unchanged in this task.
    - Performance: Extra prompt text is bounded by existing `maxWorkerMessageBytes`; no extra worker turn by default.
    - Code Quality: Host `instruction` still appends after the default. Do not introduce XML. Do not change observation schema.
    - Security: Active observation lines redacted with `secrets`; still `om:{session.id}` correlation.
  - Approach:
    - Documentation Reviewed:
      - `docs/compaction-observational-memory.md` observer/reflector defaults.
      - Existing `DEFAULT_OBSERVER_INSTRUCTION` and `worker-split.test.ts` domain-neutral gate.
    - Options Considered:
      - 076 current-task tool: leaf scope label replaces it. Reject.
      - Rewrite reflector as GC: breaks immutable ledger. Reject.
    - Chosen Approach:
      - Prompt + default string only. Current task **is** the leaf scope in the outline (Task 3).
    - API Notes and Examples:
      ```ts
      import { DEFAULT_OBSERVER_INSTRUCTION } from "@arnilo/prism-memory/compaction/observational-memory";
      DEFAULT_OBSERVER_INSTRUCTION.includes("coding"); // false
      ```
    - Files to Create/Edit:
      - `packages/memory/src/compaction/observational-memory/workers/observer.ts`
      - `packages/memory/src/compaction/observational-memory/runtime.ts` (pass active observations into `runObserver`).
      - `packages/memory/src/compaction/observational-memory/__tests__/worker-split.test.ts` (extend).
    - References:
      - `workers/observer.ts` `DEFAULT_OBSERVER_INSTRUCTION`
      - `joinWorkerText` in `limits.ts`
  - Test Cases to Write:
    - `observer_default_prompt_is_domain_neutral` (existing, still passes).
    - `observer_prompt_lists_existing_active_observations`.
    - `observer_does_not_expose_record_current_task`.
    - `abstention_observer_does_not_record_unmentioned_ids` (mock provider).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — default instruction text is a replaceable contract; docs in Task 7.
    - Docs pages to create/edit:
      - none this task (Task 7).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 7 — Docs current-line, exports, 0.7.0 evidence pointer**
  - Acceptance Criteria:
    - Functional: `docs/compaction-observational-memory.md` documents work scopes, entry types, project query, auto-bind, unscoped dropper, helper, and explicitly **does not** offer resource-scope OM or budget-drop as the working set. Index one-sentence blurb matches today’s contract. Public exports covered by package surface test. `docs/_evidence/phase77-primitive-review.md` remains history.
    - Performance: n/a
    - Code Quality: API page follows `docs/api-page-template.md` / prism-wiki.md; no plan numbers or “0.7.0 adds” in the page or index.
    - Security: Notes redaction, caps, fail-closed bind, projection is a filter not a second session.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`
      - `.agents/skills/create-plan/references/prism-wiki.md`
      - `docs/index.md` Compaction/session memory heading
      - `docs/compaction-observational-memory.md`
    - Options Considered:
      - New `docs/work-scopes.md`: splits a small contract from OM. Reject.
      - Mention in `docs/workflows.md`: runner unchanged; a Related APIs bullet is enough if the OM page already says hosts may use `nodeId`.
    - Chosen Approach:
      - One OM page update + index blurb + Related APIs on workflows (one bullet, no new workflow API), plus a packed public-surface R16 journey and evidence-matrix pointer.
    - API Notes and Examples:
      ```ts
      const attached = createObservationalMemory({ /* workers */ }).attach(session, { appendEntry, sessionModel });
      const ctrl = createWorkScopeController({ session: attached.session, appendEntry });
      await withWorkScope(ctrl, { id: "task:1", parentId: "plan:074", kind: "task" }, () => attached.session.run("do task 1"));
      ```
    - Files to Create/Edit:
      - `docs/compaction-observational-memory.md`
      - `docs/index.md` — observational memory one-liner
      - `docs/workflows.md` — Related APIs bullet only
      - `packages/memory/src/compaction/observational-memory/__tests__/index.test.ts` — public work-scope exports and docs contract.
      - `scripts/fixtures/e2e-070-host-completeness-journey.mjs` / `scripts/e2e-full-surface.test.mjs` — packed public-surface R16 proof.
      - `docs/_evidence/0.7.0-host-completeness.{json,md}` / `scripts/host-completeness-evidence.test.mjs` — R16 evidence pointer and gate.
    - References:
      - Four-layer table: add “Work-scope index (opt-in)” as the filter over observation/reflection layers, not a fifth retrieval system.
  - Test Cases to Write:
    - `observational_memory_work_scope_helpers_and_entries_are_public`.
    - `observational_memory_docs_cover_the_work_scope_contract`.
    - Packed R16 journey: task-1 memory stays hidden from task-15 until explicit ancestor promotion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents Tasks 2–6.
    - Docs pages to create/edit:
      - `docs/compaction-observational-memory.md`: work scopes, project, auto-bind, unscoped dropper, helper, no resource scope, no budget GC.
      - `docs/workflows.md`: Related APIs → work-scope helper (optional `nodeId` as scope id).
    - `docs/index.md` update: yes — Compaction/session memory → Observational memory compaction subpath: one sentence covering observations/reflections, optional work-scope index, exact-id recall. No plan number.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

- Known constraints (pre-execution): no resource-scoped OM; no observation-log rewrite; no XML; defaults stay domain-neutral; OM remains opt-in; unscoped attach keeps today’s dropper; bind targets OM only; auto-bind leaf only; `withWorkScope` does not close and is not inside `runWorkflow`; working-memory extractors stay host-owned; graft/wiki unchanged; 072 not edited; 074/075 not implemented here.
- Post-execution compromises: none.

## Further Actions

- **074 Attention Compiler packs the projected episodic layer — complete (2026-09-15).** The observational-memory compaction strategy renders its summary — the layer the next run's pack carries — through the same leaf/`self+ancestors` projection the context blocks use, so a compacted prefix never carries the full ledger; the folded payload still keeps every observation for later scopes. `packages/memory/src/compaction/observational-memory/strategy.ts` + `__tests__/strategy.test.ts`; docs `docs/compaction-observational-memory.md`, `docs/attention-compiler.md`; R16 evidence row.
- **075 Memory Fabric accepts explicit binds of closed-scope reflections — complete (2026-09-15).** `remember({ kind: "fact" | "procedure", reflectionId })` derives content from a reflection whose explicit `om.scope.bound` entry sits on a closed scope, fails closed on unknown, unbound, or open-scope-only reflections, and records `promotedFrom: { reflectionId, scopeId }`. `packages/memory/src/fabric/{types,create,consolidate,index}.ts` + `__tests__/notes.test.ts`; docs `docs/memory-fabric.md`; packed R16 leg.
- **0.7.0 cut:** plan 073 Tasks 28–29 remain deferred until every plan in the extended line closes; R16 now points to this plan's hermetic and packed proof. Priority: release-blocking.
