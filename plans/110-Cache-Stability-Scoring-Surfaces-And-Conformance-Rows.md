# Cache-Stability Scoring Surfaces and Remaining Conformance Rows

Release: **post-0.10.0** (the 0.11.0 line), recorded from plan [101](101-Cache-Stability-Follow-Ups.md)'s Further Actions. Nothing here belongs to plan [105](105-Scoped-Agent-Memory-And-Release-0-10-0.md)'s 0.10.0 cut or to the 0.10.0 line's [106](106-Hook-Lifecycle-Completion.md)/[107](107-Behavior-And-Graft-Integration-Removals.md) scope: plan 101 already ships correct, documented behavior. These tasks turn its fixture-only numbers into host-usable surfaces and pin the conformance rows its fixtures left uncovered. Tasks 2 and 3 are host-demand gated (Task 1 records whether a consumer exists); Tasks 4–6 are cheap coverage that can land any time after the 0.10.0 cut.

## Objectives
- Give a host the tail-aware cacheable-prefix measurement over its **own** captured requests, without a wire marker and without running the fixture runner: one exported scoring entry point the runner itself calls, so fixture numbers and host numbers cannot drift apart.
- Report *where* and *how far* each reset fell. `resets` keeps its 1-based index list and a detail row carries both fractions per reset, so a host cockpit plots the boundary instead of re-deriving the measurement.
- Pin the two areas plan 101 left uncovered: the attention compiler's **tool-result** stage (its fold fixture proves only the thinking stage, because the fixture's 36-byte `load_skill` confirmation is skipped by the stub's shrink guard) and the remaining context-budget eviction groups (`context`, `skills` body demotion, `attachments`).
- Keep `legacy` layout honest with a parity row set that fails if a change keeps `cache_aware` correct while moving legacy positions.

## Expected Outcome
- `scorePrefixStability(requests, { tailSegments, minContinuity })` returns `{ minContinuity, cacheableContinuity, resets, resetDetails }` for any captured request list; `runPrefixStabilityConformance` delegates to it, so both fractions and the reset list come from the exported path while its defaults and four-request scenario stay byte-identical.
- A host with no tail map reads `cacheableContinuity === minContinuity`; a host with one reads the same number the runner reports for the same requests (pinned by a test that runs both over one capture).
- `resetDetails[i].request === resets[i]` for every gap, ascending, with both fractions; a run with no gap returns `[]`.
- A fold fixture whose reset comes from the **tool-result** stub exists: one declared reset, the stubbed row is the boundary, and the untouched `load_skill` confirmation beside it proves the reset is stage 2 and not the shrink guard's neighbour.
- `context`, `skills`, and `attachments` evictions have boundary indexes in `src/__tests__/invalidation-inventory.test.ts`, the `legacy` layout has a parity row set, and every existing pin plus the default layout behavior stays byte-identical.

## Tasks

- [x] Task 1: Primitive review — scoring surface, reset detail, and the uncovered conformance rows (P1, must run first)
  - Acceptance Criteria:
    - Functional: `docs/_evidence/phase110-primitive-review.md` exists with three sections — (a) reuse rows for every primitive the later tasks build on, each with a `path:line` span, (b) gap rows naming what no current seam does, (c) rejected alternatives with the reason (including every item in the rejected list below).
    - Functional: the review confirms each ceiling with a runnable observation, not prose:
      - (a) Tail-aware measurement is runner-private: `tailClassifier` and `measureRequest` are module-private (`src/testing/prefix-stability-conformance.ts:220-244`), the only producer of tail segments is assembly (`src/input.ts:360-366`, `:577-632`) and the session's map is cleared at the start of every run (`src/agent-session/session/assemble.ts:241`), so a host cannot score its own capture today. Prove it by scoring a hand-built capture with the exported surface and recording that no export accepts one.
      - (b) `resets` is index-only: the per-pair gaps stay local and only `request` survives (`src/testing/prefix-stability-conformance.ts:134-152`).
      - (c) Stage 2 cannot be the visible reset with today's fixture: the shrink guard leaves a row alone when the stub would cost more tokens (`src/attention-compiler.ts:545-552`) and the fixture's only tool result is a `load_skill` confirmation capped at 512 bytes (`src/skill-load.ts:7,166-168`). Print both token estimates for that 36-byte row and for its stubbed form, and print the same pair for an 8 KiB payload, so the floor the fixture needs is measured.
      - (d) Which eviction rows are pinned today: `tool_results` then `history` only (`src/__tests__/invalidation-inventory.test.ts`), while `context`, `skills`, and `attachments` are behavioral-only (`src/__tests__/context-budget.test.ts`); drop order and victim rules at `src/context-budget.ts:220-240,262,273-289`, kinds at `:33-39`.
      - (e) Layout order and the hoist: `flattenInputGroups` (`src/input.ts:445-467`) and the prompt builder's two branches (`src/input.ts:179-212`) — `cache_aware` keeps the leading system prefix ahead of context/skills/declarations, `legacy` puts context first. Re-run plan 101 Task 3's cross-layout probe and record the moved indexes.
      - (f) Two parallel tool calls in one assistant message still execute inside one round: `limits.maxToolRounds: 1` (`src/testing/prefix-stability-conformance.ts:103`) with two `tool_result` blocks after the assistant message yields the same two requests per turn and no extra provider round — the assumption Task 4's fixture rests on. Prove it by printing the captured request count and the tool-result count for a two-call round, and record how the fixture provider's `index % 2` alternation (`:188-207`) maps requests to turns.
    - Functional: the demand evidence for the gated tasks is recorded: the review lists every in-repo consumer of the runner (`grep -rn "runPrefixStabilityConformance\|prefix-stability-conformance" src packages examples scripts`) and states for Tasks 2 and 3 whether a consumer exists today, and what a host reads instead when none does (the docs fallback), so the gate is evidence rather than opinion.
    - Functional: the review states per later task whether it reuses a seam as-is, extends it, or adds one — Task 2 (`measureRequest`/`tailClassifier`/`sharedPrefixFraction` become the internals of one exported scorer; runner delegates), Task 3 (one projection shared by scorer and runner result), Task 4 (fixture provider plus one runner-owned tool; option on the existing options interface), Task 5 (existing `assembleTwice` + calibration helper), Task 6 (`inputLayout` on the same fixtures).
    - Performance: the review records measured numbers — one runner pass cost, the per-request byte counts of the four fixture requests, bytes a `resetDetails` entry adds, and the stub's measured shrink for 8 KiB versus the 512-byte cap.
    - Code Quality: the review is deterministic evidence, not prose; every reuse row names the exact exported symbol, every gap row names the file that would have to change, and each rejected alternative names the task it would have affected. It adds the matching `PLAN_110_TASK_1` block to `scripts/plan-review-gate.test.mjs` (plan path, evidence path, required tokens, rejected tokens) so the review cannot silently drift.
    - Security: the review states why no host payload can ride the new surfaces (fractions and byte counts only), why no marker is added to the provider payload by default (wire bytes are what the prompt cache keys on, so a marker that varies per request is the invalidation the runner measures), and that the fixture's bulk payload is generated text rather than captured host content.
  - Approach:
    - Documentation Reviewed:
      - Plan 101 `Compromises Made` + `Further Actions` (the source of every later task); `docs/prefix-stability-conformance.md:20,47-58,91-131` (the shipped contract); `docs/attention-compiler.md` (stage ledger and the fold report); `docs/input-and-prompt-assembly.md` (layout order, the summary hoist); `docs/provider-caching.md` (what the cache pays for).
    - Options Considered:
      - Treat the items as already-designed work and skip the review — rejected: every later task adds or moves a public surface on the testing subpath or changes the fixture contract, and the demand gate itself needs evidence.
      - One evidence file per task — rejected: one review owns the inventory; later tasks cite its rows, matching plans 102/103/104/108/109.
      - Registering the gate block later, with the code — rejected: the gate is the mechanism that keeps a completed review honest (`scripts/plan-review-gate.test.mjs` `PLAN_074_TASK_1` is the shape), and a Task 1 that runs without it can drift with no signal.
      - Rejected and recorded by this task (the gate's rejected-token list): a wire marker on the provider payload, a second conformance runner for host traffic, pattern-matching host content to find tail segments, changing `allowedResets` semantics, raising `MAX_LOAD_SKILL_RESULT_BYTES`, and pinning eviction groups in production code instead of fixtures.
    - Chosen Approach: one evidence file mapping all five 101 Further Actions to existing primitives or named gaps, with a runnable confirmation of each ceiling, the measured fold floor, the demand evidence, and the rejected list that Tasks 2–6 must not reopen.
    - API Notes and Examples:
      ```text
      reuse: src/testing/prefix-stability-conformance.ts:232-244  measureRequest (private)          → Task 2 (extend: internals of the exported scorer)
      reuse: src/testing/prefix-stability-conformance.ts:220-224  tailClassifier (private)         → Task 2 (reuse, stays private)
      reuse: src/testing/prefix-stability-conformance.ts:252-260  sharedPrefixFraction (private)   → Task 2 (reuse, stays private)
      reuse: src/testing/prefix-stability-conformance.ts:134-169  gap loop + resets/return        → Task 3 (extend: one projection)
      reuse: src/testing/prefix-stability-conformance.ts:188-207  fixtureProvider + call wiring    → Task 4 (extend: optional bulk tool call)
      reuse: src/__tests__/invalidation-inventory.test.ts:79-95   assembleTwice + calibration     → Tasks 5, 6 (reuse)
      reuse: src/input.ts:179-212                                 prompt builder layout branches  → Task 6 (assert only)
      gap:   src/testing/prefix-stability-conformance.ts:220-244  no exported scorer for a host capture     → Task 2
      gap:   src/testing/prefix-stability-conformance.ts:149-169  resets carries indexes only              → Task 3
      gap:   src/attention-compiler.ts:545-552                    shrink guard skips the tiny fixture row  → Task 4
      gap:   src/__tests__/invalidation-inventory.test.ts         three eviction groups unpinned          → Task 5
      gap:   src/__tests__/invalidation-inventory.test.ts         legacy layout unpinned                   → Task 6
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase110-primitive-review.md` (new).
      - `scripts/plan-review-gate.test.mjs`: `PLAN_110_TASK_1` block.
    - References:
      - `scripts/plan-review-gate.test.mjs` (gate shape), `docs/_evidence/phase74-primitive-review.md` (span-citation expectation), plan 109 Task 1 (the sibling review shape and its measured-numbers criterion), plan 101 Task 3 deltas (the cross-layout probe and the eviction calibration this review re-runs).
  - Test Cases to Write:
    - None (evidence artifact); the check is `node --test scripts/plan-review-gate.test.mjs` plus every later task's Approach citing a row from this file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence only).
    - Docs pages to create/edit:
      - `docs/_evidence/phase110-primitive-review.md`: new evidence artifact (not a navigation surface).
    - `docs/index.md` update: no (`docs/_evidence/` is not indexed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Host-facing tail-aware scoring entry point (P2, host-demand gated)
  - Acceptance Criteria:
    - Functional: `src/testing/prefix-stability-conformance.ts` exports `scorePrefixStability(requests: readonly ProviderRequest[], options?: ScorePrefixStabilityOptions): PrefixStabilitySample`, reachable at the existing `./testing/prefix-stability-conformance` subpath. `ScorePrefixStabilityOptions` is `{ tailSegments?: ReadonlyMap<string, Message>; minContinuity?: number }` (default `0.95`). `PrefixStabilitySample` is `{ minContinuity, cacheableContinuity, resets, resetDetails }`; `resetDetails` is the projection Task 3 also puts on the runner result, so both surfaces read one producer.
    - Functional: fewer than two captured requests throws a plain `Error` naming the count (the runner's own convention: no test runner, no network, no credentials), and a tail map that matches nothing returns `cacheableContinuity === minContinuity` — never a fabricated `1` (`docs/prefix-stability-conformance.md:58`).
    - Functional: `runPrefixStabilityConformance` computes its numbers through `scorePrefixStability(requests, { tailSegments, minContinuity })` and keeps its own four-request assertion, its reset assertion and message text, and its return shape (`requests`, `minContinuity`, `cacheableContinuity`, `resets`) — a host that only runs fixtures sees byte-identical results.
    - Performance: one pass over the captured requests, no session, no provider call, no capture of its own; the runner measures once and its assertion reads the sample (no second serialization pass). Task 1's review records the measured cost of one runner pass and the scorer's share of it.
    - Code Quality: `measureRequest`, `tailClassifier`, and `sharedPrefixFraction` stay module-private and are the only measurement path — the scorer and the runner both call them, so no second fraction algorithm exists. No new file, no new subpath, no root-barrel export (`src/index.ts` untouched).
    - Security: the helper consumes `ProviderRequest` objects the host already holds; it adds no I/O, no logging, and returns counts and fractions only — never message text, never a fragment. A host that passes the wrong `tailSegments` gets a wrong number rather than a failure, which is stated in the docs page.
  - Approach:
    - Documentation Reviewed:
      - `docs/prefix-stability-conformance.md:13-20,47-58,91-131` (current contract, the two-fraction rule, the tail-source paragraph), plan 101 Task 1 (`cacheableContinuity` shipped), plan 101 `Compromises Made` (why tail detection reads the session map), Task 1's evidence rows for Task 2.
    - Options Considered:
      - A marker field on the provider payload so the runner can classify tails without the session — rejected: the wire bytes are what the cache keys on, and a marker that varies per request *is* the invalidation the measurement exists to catch; it would also change every host's requests, not just fixtures.
      - An adapter-level segment index inside the provider adapters — rejected: adapters do not know tail ids, and a host with its own capture (or a non-Prism transport) would get nothing.
      - Exporting `measureProviderPrefix` plus a classifier factory — rejected: two exports for internals, and a host can mis-order them; one entry point that returns the whole sample is harder to misuse.
      - A second host-facing runner that re-implements the capture — rejected: duplicated assertions and two definitions of "reset".
      - Keeping the runner private and documenting "run the fixture runner" — the honest fallback when Task 1 finds no consumer; it is what ships today, and the docs already say so.
    - Chosen Approach: one exported scorer that owns the sample shape and delegates to the private measurement, with the runner refactored to call it — smallest surface and a single algorithm. Execution (2026-09-22): the user request opened the demand gate (Task 1 still found no in-repo consumer). `assertOn` is an optional third field, default `providerPrefix`, so the runner can pass its metric and read `resets` off the sample without a second serialization. The export counter saw +4 (function + three types), not the sketch's +2. `src/index.ts` untouched. Compat baseline not regenerated.
    - API Notes and Examples:
      ```ts
      import { scorePrefixStability } from "@arnilo/prism/testing/prefix-stability-conformance";

      // A host that captures its own provider requests (middleware, proxy, or an adapter tap):
      const sample = scorePrefixStability(captured, { tailSegments: sessionTails, minContinuity: 0.95 });
      // → { minContinuity: 0.98, cacheableContinuity: 1, resets: [], resetDetails: [] }
      // With no tail map a deliberate tail re-send counts against the score:
      // → { minContinuity: 0.71, cacheableContinuity: 0.71, resets: [2], resetDetails: [{ request: 2, fraction: 0.71, cacheableFraction: 0.71 }] }
      ```
      ```text
      // src/testing/prefix-stability-conformance.ts — shape (sketch)
      export interface ScorePrefixStabilityOptions { readonly tailSegments?: ReadonlyMap<string, Message>; readonly minContinuity?: number; }
      export interface PrefixStabilityResetDetail { readonly request: number; readonly fraction: number; readonly cacheableFraction: number; }
      export interface PrefixStabilitySample { readonly minContinuity: number; readonly cacheableContinuity: number; readonly resets: readonly number[]; readonly resetDetails: readonly PrefixStabilityResetDetail[]; }
      export function scorePrefixStability(requests: readonly ProviderRequest[], options?: ScorePrefixStabilityOptions): PrefixStabilitySample;
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: `ScorePrefixStabilityOptions`, `PrefixStabilityResetDetail`, `PrefixStabilitySample`, `scorePrefixStability`; runner delegates and keeps its assertion layer.
      - `src/__tests__/prefix-stability-conformance.test.ts`: scorer cases plus the runner-parity case.
      - `docs/prefix-stability-conformance.md`: "When to use it" gains the host-capture sentence, "Outputs" documents the scorer, "Implementation example" gains the snippet above.
      - `scripts/budgets.json`: rebaseline the `@arnilo/prism` export count with a reason entry naming the two additions (testing subpath only, no root-barrel change). Additive only — no compat-baseline regeneration in this task; the 0.11.0 cut owns that.
    - References:
      - `src/testing/prefix-stability-conformance.ts:220-260` (the measurement to export), `src/agent-session/session/assemble.ts:354` (`tailSegments.clear()` — plan cite `:241` was `evaluateTurnStop`) and `src/input.ts:360-366` plus `:574-633` (where tail segments actually come from), `docs/prefix-stability-conformance.md:56-58` (the rule the scorer must preserve). Demand gate: Task 1 found no consumer (`docs/_evidence/phase110-primitive-review.md` §8). Do not start unless a host consumer appears.
  - Test Cases to Write:
    - Scorer over a hand-built three-request capture with one tail message: `cacheableContinuity` above `minContinuity`, `resets` naming the pair that broke, `resetDetails` aligned with it.
    - Runner parity: run `runPrefixStabilityConformance` for a fixture host, then score the captured requests with the runner's own tail map — both fractions and `resets` are identical, so the two surfaces cannot diverge.
    - No tail map at all: the two fractions are equal (including the tail-heavy eager-host fixture, where both dip together).
    - Tail map present but matching nothing: equal fractions, no fabricated `1`.
    - Fewer than two requests: plain `Error` naming the count; no partial sample.
    - `release:gate`: additions only (the new names on the testing subpath).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a new exported scorer on the testing subpath, usable over host-captured requests.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: scorer contract, options, sample shape, and the "a wrong tail map yields a wrong number, not an error" note.
    - `docs/index.md` update: no (existing page only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Per-pair reset detail on the result (P2, host-demand gated; depends on Task 2's scorer). Demand gate (Task 1 §8): no in-repo consumer. Do not start unless one appears. Task 2 landed: copy `resetDetails` off `scorePrefixStability`'s sample — do not add a second gap loop.
  - Acceptance Criteria:
    - Functional: `PrefixStabilityConformanceResult` gains `resetDetails: readonly PrefixStabilityResetDetail[]` — one row per reset, ascending, with `request` equal to `resets[i]`, `fraction` the fraction of the metric `assertOn` selected for that pair, and `cacheableFraction` the tail-excluded fraction for the same pair. A run with no gap returns `[]`; a run with a declared `allowedResets` carries exactly that many rows.
    - Functional: the rows come from the same gap list that produces `resets` (one projection, shared with Task 2's `PrefixStabilitySample`), so the two cannot disagree; a test asserts the alignment rather than assuming it.
    - Functional: when Task 2's demand gate keeps the scorer unchecked, the projection still lands as one shared private helper used by the runner result, so Task 2 can consume it later without moving the code. No new event, no new subpath, and the runner's existing fields keep their current values and types.
    - Performance: only the gaps allocate a row (O(pairs) in the worst case, typically one or two); no extra request capture, no extra serialization beyond the per-pair fractions the loop already has.
    - Code Quality: one projection helper and one gap loop — `resets` stays derived from the gap list, never recomputed; the docs' "no host content in the result" sentence stays true (numbers only).
    - Security: percentages and indexes only; no message fragments or payload bytes are added to the result or to the error message.
  - Approach:
    - Documentation Reviewed:
      - `docs/prefix-stability-conformance.md:47-58` (outputs and reset semantics), plan 101 `Compromises Made` ("`resets` names the request index only"), Task 1's review rows for Task 3.
    - Options Considered:
      - Replace `resets` with the detail rows — rejected: `resets` is documented, published, and asserted by existing fixtures; a rename would break hosts for a cosmetic gain.
      - Detail rows only in the scorer, not on the runner result — rejected: the runner is where fixtures read the reset, and a host cockpit that uses the runner would still have to re-derive the fraction.
      - A parallel `fractions` array with no `request` field — rejected: index-pairing two arrays is exactly the fragile shape the alignment test would have to police.
      - Include the captured requests or their bytes in the result — rejected: it would turn a numbers-only diagnostics result into a payload carrier and change the docs' security sentence.
    - Chosen Approach: add `resetDetails` to the runner result, projected from the same gap list that already yields `resets`, and share that projection with the scorer. Execution (2026-09-22): the user request opened the gate. `projectResetDetail` is the one projection; the runner copies `sample.resetDetails`. `fraction` is the metric `assertOn` selected. No new export — `PrefixStabilityResetDetail` was already counted in Task 2. `scripts/budgets.json` untouched.
    - API Notes and Examples:
      ```ts
      const { resets, resetDetails } = await runPrefixStabilityConformance({ host, skills, allowedResets: 1 });
      // resets: [3]  ·  resetDetails: [{ request: 3, fraction: 0.62, cacheableFraction: 1 }]
      //                                 ^ provider-visible pair broke, the tail-excluded pair did not
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: `resetDetails` on the result, one projection helper reused by `scorePrefixStability`.
      - `src/__tests__/prefix-stability-conformance.test.ts`: alignment, fraction, and empty-run cases.
      - `docs/prefix-stability-conformance.md`: "Outputs" row and the `allowedResets` paragraph pointing at the detail rows.
      - `scripts/budgets.json`: only if `PrefixStabilityResetDetail` is not already counted by Task 2's rebaseline (one entry, one reason).
    - References:
      - `src/testing/prefix-stability-conformance.ts:134-152` (the gap list to project), `src/__tests__/prefix-stability-conformance.test.ts` (the fold and tail fixtures whose resets stay unchanged), `docs/prefix-stability-conformance.md:51` (the reset paragraph to extend).
  - Test Cases to Write:
    - Tail-only dip: `resetDetails` for that pair carries `cacheableFraction === 1` while `fraction < minContinuity` — the distinction a host cockpit plots.
    - Fold fixture with `allowedResets: 1`: exactly one detail row, `request` equal to `resets[0]`, both fractions below `minContinuity` for the thinking fold.
    - Passing run: `resets` and `resetDetails` both `[]`.
    - Regression: existing fixtures' `resets` values and result fields unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the result gains a field, and the field's type is exported from the testing subpath.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: output row, example line, and the `allowedResets` cross-reference.
    - `docs/index.md` update: no (existing page only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Tool-result-stage fold fixture (P3)
  - Acceptance Criteria:
    - Functional: `PrefixStabilityConformanceOptions` gains `foldableToolResultBytes?: number`. When set, the runner installs a runner-owned fixture tool (constant name, e.g. `prefix_stability_bulk`) that returns deterministic generated text of exactly that many bytes, and the fixture provider adds a second `tool_call` part for it to the even-index request alongside `load_skill`, so both results land in the same round (the runner's `limits.maxToolRounds: 1` keeps it to one round and two requests per turn). Default unset: the capture is byte-identical to today — same four requests, one tool call each, same message shapes.
    - Functional: with `foldableToolResultBytes: 8_192` and a host attention compiler whose trigger settles (`state.turn === 1 && estimatedInputTokens >= floor`, plan 101's shape) plus `keepLast: 0`, the run declares exactly one reset and that request carries the stub header for the bulk `toolCallId` while the sibling `load_skill` confirmation in the same request is byte-unchanged — the reset is attributable to the compiler's tool-result stage (and to the shrink guard, which left the small row alone: `src/attention-compiler.ts:545-552`).
    - Functional: stage isolation is asserted, not assumed: the reset request still carries every thinking block its predecessor carried (the fixture host sets `thinkingKeepTurns` so stage 1 has nothing to strip), and the reset request's message list differs from its predecessor only inside the stubbed row.
    - Functional: the option is documented where a host meets it — the options interface field with the reason it exists and the docs page's fold section — and the fixture's payload is derived from the byte count rather than checked in.
    - Performance: the case stays a four-request run (no extra turn, no extra provider round); Task 1's review records the measured stub shrink for the 8 KiB payload (payload bytes minus stub bytes) and the case's wall-clock cost, and the bulk payload stays far under `maxRequestBytes`.
    - Code Quality: the fixture tool is created next to the existing `createLoadSkillTool` wiring in one place, the provider's extra call is a parameter rather than a second provider function, and the option carries no behavior when unset — no branch in the default path beyond the existing `skillName !== undefined` check.
    - Security: the payload is generated text (`"x".repeat`), never host or captured content, so no secret can ride the fixture; the fixture tool is installed only when the option is set, and the runner remains a testing helper with no network, credentials, or test-runner dependency.
  - Approach:
    - Documentation Reviewed:
      - `docs/prefix-stability-conformance.md:91-131` (fixture contract and the fold section), `docs/attention-compiler.md` (the stage ledger and why two stages exist), plan 101 Task 2 deltas (the thinking-stage fixture) and `Compromises Made` (why the tool-result stage is unproven), `src/tool-result-fold.ts:4-6` (the host-fold defaults that do not gate the deterministic stub), Task 1's review rows for Task 4.
    - Options Considered:
      - Raise `MAX_LOAD_SKILL_RESULT_BYTES` (512) so the load-skill confirmation folds — rejected: it is a documented product cap (`src/skill-load.ts:7`), and a fixture must not dictate product limits.
      - An option naming a host-provided tool for the provider to call — rejected: the fixture's determinism would depend on host tool behavior, and cross-host comparability is the runner's whole premise.
      - Three requests per turn (load_skill, then the bulk call) — rejected: it breaks the runner's four-request contract and the docs' "two per turn" sentence.
      - Tuning `fold.minBytes` down to the confirmation's size — rejected: the shrink guard still skips the row (the stub is larger), so it would prove the gate rather than the stage.
      - Duplicating the runner inside the test file to drive a big tool result — rejected: a second capture path with its own reset definition.
    - Chosen Approach: one opt-in option, one runner-owned fixture tool, and a second parallel tool call in the same round — the smallest change that puts a foldable row in history without moving the request count.
    - Execution (2026-09-22): `foldableToolResultBytes` + private `createFoldableToolResultTool` / `PREFIX_STABILITY_BULK_TOOL_NAME`; `fixtureProvider` gained a `bulk` parameter. No new export, so `scripts/budgets.json` untouched (measured 1465 = baseline). Tests capture the runner's own wire requests through the existing `provider_request` middleware hook. Measured window: run-2 opening > 3,500 tokens pre-fold, 1,841 post-fold, so the test floor is 2,500. With 8 KiB the stub header is `Tool result prefix_stability_bulk [prefix-stability-bulk-0]: omitted 8194 bytes (sha256 …)`; the sibling 36-byte confirmation is byte-identical across the reset; one thinking block survives; the tail re-renders byte-identically; case cost 1.3–3.5 ms. Default capture: four requests, no bulk tool, no bulk id.
    - API Notes and Examples:
      ```ts
      await runPrefixStabilityConformance({
        host: { ...host, attentionCompiler: { keepLast: 0, trigger: { kind: "predicate", shouldFold: (s) => s.turn === 1 && s.estimatedInputTokens >= floor } } },
        skills: [first, second],
        allowedResets: 1,
        foldableToolResultBytes: 8_192, // the bulk result is foldable; the load_skill confirmation is not
      });
      // → { resets: [3], resetDetails: [{ request: 3, fraction: 0.4, cacheableFraction: 0.4 }] }
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: `foldableToolResultBytes`, the fixture tool, the provider's second call, and a constant for the tool name.
      - `src/__tests__/prefix-stability-conformance.test.ts`: the tool-result fold case plus the default-capture regression.
      - `docs/prefix-stability-conformance.md`: options row, one sentence in the fold section naming both proven stages, and a note that the fixture tool is installed only for this option.
    - References:
      - `src/attention-compiler.ts:537-551` (stage 2 and the shrink guard), `:632-668` (`toolResultTargets`), `src/tool-result-fold.ts:187,203` (`foldedToolResultHeader`, `capToolResultSummary`), `src/testing/prefix-stability-conformance.ts:188-205` (the provider to extend), plan 101 Task 2's trigger design (`docs/prefix-stability-conformance.md:96-113`). Task 1 §5(c): 36-byte confirmation is 18 vs 27 tokens (guard skips); 8 KiB is 2049 vs 31 (shrink 8071 message bytes). A 512-byte confirmation would not be skipped — the cap is not the shrink floor. §5(f): two calls still yield four requests.
  - Test Cases to Write:
    - Tool-result fold: one declared reset; the reset request contains the stub header for the bulk call id; the `load_skill` confirmation in that request equals its predecessor's bytes.
    - Stage isolation: every thinking block present before the reset is still present in the reset request; the only differing message is the stubbed one.
    - Vacuity guard: the same host without `foldableToolResultBytes` (or with a payload whose stub is larger) declares zero resets and fails a run that expects one — the fixture cannot pass by accident.
    - Default regression: a run without the option captures four requests with one tool call each and produces exactly the numbers the pre-task suite pinned.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — the fixture runner's options gain a field that changes the generated scenario.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: options table row, fold-section sentence, and the "installed only when set" note.
    - `docs/index.md` update: no (existing page only).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Remaining eviction-boundary rows (P3)
  - Acceptance Criteria:
    - Functional: `src/__tests__/invalidation-inventory.test.ts` pins the boundary for the three eviction groups plan 101 left behavioral, each with its cap derived from a calibration run (the file's existing pattern: assemble once with `maxInputBytes: 1_000_000`, `reportOmissions: true`, then derive the cap that drops exactly the target group — no magic constants):
      - `context`: two host context blocks with different `priority` values (`src/context-budget.ts:262`) — the cap that evicts the lower-priority block only; boundary is the message index where the context fragment first differs and the surviving block's bytes stay intact.
      - `skills`: a cap that forces exactly the skill-body demotion rather than a drop — assert `report.demotedSkillBodies` names the skill (`src/context-budget.ts:207-208`, `:273-289`), the boundary is the skill catalog message index, and the skill's name/description bytes survive inside that message.
      - `attachments`: two attachments with a cap that evicts the newer one (LIFO, `src/context-budget.ts:33-39`) — boundary is that attachment's index and the older attachment's bytes survive.
    - Functional: the existing `tool_results` and `history` rows keep their current boundary indexes; no fixture asserts a group it does not evict (each row's omission kind is read back from `getContextBudgetReport` and asserted).
    - Functional: `docs/prefix-stability-conformance.md`'s budget-eviction row names the five pinned groups and points at `src/__tests__/context-budget.test.ts` for the rest of the drop order.
    - Performance: one calibration plus one pair per row; the suite stays inside the input-pipeline test budget (plan 101's seven-case suite ran in ~13 ms, measured again here).
    - Code Quality: the cases reuse the file's existing `assembleTwice` helper and calibration step; no second fixture framework, no duplicated LCP math, and each case name states the group it pins.
    - Security: fixtures only — no new content, no host payload, no secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/prefix-stability-conformance.md:118-131` (the inventory table rows and owners), `docs/input-and-prompt-assembly.md` (context budget and drop order), plan 101 Task 3 deltas 2–4 (the calibration method and why magic caps were avoided), Task 1's review rows for Task 5.
    - Options Considered:
      - A dedicated `context-budget-boundaries.test.ts` — rejected: the inventory rows are one table and one suite; a second file splits the pin from the doc row that describes it.
      - Hardcoding caps that happen to evict the right group — rejected: a cap tied to the ÷4 estimator breaks silently when the estimator or the fixture text changes; the calibration derives it.
      - Asserting the whole final message list for each case — rejected: an exact list pins unrelated bytes and turns a fixture-text edit into a boundary failure.
    - Chosen Approach: extend the existing suite with one calibration-derived case per group, asserting the boundary index plus the surviving bytes, and update the one docs row.
    - Execution (2026-09-22): three cases added, no production change, no new export. Each calibrates at `maxInputBytes: 1_000_000` then evicts with `keptBytes - 1`: context boundary **1** (low-priority block message, high-priority bytes survive), skills boundary **1** (`skill_body` demotion; `Skill big: short desc` survives, body gone), attachments boundary **2** (newest pops LIFO, older bytes survive). Omission kinds read back per case. The suite is 10 tests and ran in **6.6 ms** (plan 101's seven-case mark was ~13 ms). Docs row names the five pinned groups and points at `src/__tests__/context-budget.test.ts` for the full order.
    - API Notes and Examples:
      ```ts
      // Same shape as the shipped tool_result/history rows: calibrate, then derive the cap.
      const full = await assembleProviderInput({ ...base, contextBudget: { maxInputBytes: 1_000_000, reportOmissions: true } });
      const keptBytes = full.budget?.keptBytes ?? 0;
      const pair = await assembleTwice({ ...base, contextBudget: { maxInputBytes: keptBytes - 1, reportOmissions: true } }, evicting);
      assert.deepEqual(pair.after.budget?.omitted.map((row) => row.kind), ["context"]);
      ```
    - Files to Create/Edit:
      - `src/__tests__/invalidation-inventory.test.ts`: three cases plus any small helper the calibration needs.
      - `docs/prefix-stability-conformance.md`: the budget-eviction row text.
    - References:
      - `src/context-budget.ts:220-240` (drop order), `:262` (context victim), `:273-289` (skill demotion), `:33-39` (kind list and LIFO order), `:202-215` (the report fields the cases assert), `src/__tests__/context-budget.test.ts` (behavioral coverage that remains the owner of the full order).
  - Test Cases to Write:
    - The three cases above, each asserting omission kind, boundary index, and the surviving bytes of the untargeted row.
    - Regression: the existing two eviction rows plus the stable row keep their assertions and pass unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — fixtures over existing behavior.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: one table row's pin list extended.
    - `docs/index.md` update: no (no navigation delta).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6: `legacy`-layout parity rows (P3)
  - Acceptance Criteria:
    - Functional: `src/__tests__/invalidation-inventory.test.ts` gains a parity row set that assembles the same fixtures under `inputLayout: "legacy"` and asserts the documented legacy positions from `createDefaultPromptBuilder`'s legacy branch (`src/input.ts:201-203`) and `flattenInputGroups` (`:445-466`). Task 1 §5(e) measured the move: injector-context boundary is message 2 under `cache_aware` and message 1 under `legacy` (host context stays at 0; the injector block is the first difference) — not message 0. The bare summary fixture stays at message 1 in both layouts, so a parity row on it passes vacuously. The summary row must include the host context provider and a skill: measured `cache_aware` boundary 1 (hoisted) and `legacy` boundary 3 (after context, skill, and the system instruction).
    - Functional: at least two rows are pinned in both layouts from the same fixture host, so a layout change that silently relocates a boundary fails one of them; the `cache_aware` expectations stay exactly as plan 101 pinned them.
    - Functional: the docs page records that switching `inputLayout` is an explicit, documented invalidation (the whole order moves) rather than a stability claim, and the row set is named as the pin for the legacy order.
    - Performance: two extra assembly pairs on fixtures that already exist; no new session, provider, or calibration run.
    - Code Quality: one shared fixture builder parameterized by layout, so the two expectations cannot drift into different scenarios; no production change.
    - Security: unchanged — fixtures only; the parity cases assemble host-configured blocks and assert positions and surviving bytes.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md` (layout options and order), `docs/prefix-stability-conformance.md:91-131`, `src/input.ts:179-212` (both branches), plan 101 Task 3 delta 5 (the cross-layout probe) and Task 6 of this plan's Task 1 evidence rows.
    - Options Considered:
      - Drop legacy support instead of pinning it — rejected: it is a documented layout hosts select explicitly; removal is a breaking change that needs its own plan, not a follow-up fixture's side effect.
      - Pin only `cache_aware` and document legacy as unverified — rejected: that is today's state, and it is the gap this task exists to close.
      - Assert legacy positions in a new file — rejected: the rows are one inventory and one table.
    - Chosen Approach: parameterize the existing fixtures by layout, assert both orders in the same suite, and state the documented invalidation in the docs row.
    - Execution (2026-09-22): the injector fixture's `contextBlockInjector` + `contextSlotAssembly` moved to module scope with a layout parameter (the shipped `cache_aware` row now calls the same builder), and `summaryWithContextAssembly(summary, layout)` is the new shared builder. Measured and pinned: injector-context boundary **2 → 1**, summary boundary **1 → 3**; both parity pairs assert the host context stays at message 0 under `legacy` and that the boundary moves on layout alone. Suite: 12 tests, 8.2 ms. No production change, no new export.
    - API Notes and Examples:
      ```ts
      const cacheAware = await assembleTwice(fixture("cache_aware", 1), fixture("cache_aware", 2));
      const legacy = await assembleTwice(fixture("legacy", 1), fixture("legacy", 2));
      assert.equal(cacheAware.boundary.messageIndex, 2); // injector block after system + host context
      assert.equal(legacy.boundary.messageIndex, 1);     // host context leads; injector block is the first difference
      // bare summary fixture is 1 in both layouts. summary + context + skill: cache_aware 1, legacy 3
      ```
    - Files to Create/Edit:
      - `src/__tests__/invalidation-inventory.test.ts`: layout-parameterized fixtures plus the parity assertions.
      - `docs/prefix-stability-conformance.md`: a sentence in the inventory section naming the legacy pin and the explicit-invalidation rule.
    - References:
      - `src/input.ts:201-212` (legacy branch and the hoist), `:445-467` (`flattenInputGroups` order), `src/__tests__/input-pipeline.test.ts` (existing layout expectations to stay consistent with).
  - Test Cases to Write:
    - Injector-context fixture in both layouts: boundaries 2 and 1 (Task 1 §5(e); not 0), each with the surviving bytes asserted.
    - Summary fixture in both layouts: hoisted index under `cache_aware`, post-context/skill index under `legacy`.
    - Guard: switching only the layout (same fixture content) changes the boundary — the pair is not silently equal, so the parity rows cannot pass vacuously.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — fixtures over an existing, documented option.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: one sentence in the documented-boundaries section.
    - `docs/index.md` update: no (no navigation delta).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- **Demand gate opened by request, not by a found consumer.** Task 1 §8 found no in-repo consumer of the runner, so Tasks 2–3 were gated; the explicit task requests landed them anyway. The seam decisions from the review (one scorer, one projected gap list, no second measurement) keep them adoptable without moving code if a host appears.
- **`ScorePrefixStabilityOptions` gained an optional `assertOn`** beyond the plan's `{ tailSegments?, minContinuity? }` sketch, so the runner can read its reset metric off the same single pass. Default is `providerPrefix`; runner results stayed byte-identical.
- **Task 2's export count was +4, not the plan's +2** (`scorePrefixStability` plus `ScorePrefixStabilityOptions`, `PrefixStabilityResetDetail`, `PrefixStabilitySample` — the types the sketch itself exported). Recorded in `scripts/budgets.json`.
- **Task 4's fold floor (`2_500`) is a measured scenario constant**, not a runtime-derived cap. It sits in the measured window (run-2 opening > 3,500 pre-fold, 1,841 post-fold); if the fixture host text changes, the case fails loudly with `AttentionBudgetError` instead of silently adapting.
- **Task 6 uses measured boundaries (1 and 3), not the plan's original 0.** Task 1 §5(e) showed the host context stays at message 0 under `legacy` and the bare summary fixture is vacuous across layouts, so the summary parity row adds context and a skill.
- **The root tarball diet check now runs** on npm 12 after the pack-JSON fix (Further Actions): `budget-gate.test.mjs` is 19/19, including the artifact-diet bound. The working-tree pack size measured +4.4% over the 0.9.0-cut baseline (inside the 5% tolerance), so no rebaseline was needed for this plan's docs edits.

## Further Actions
- (done, 2026-09-22) **`npm pack` JSON shape.** All five readers now normalize the npm ≥11 name-keyed object: `measureRootPack` (`scripts/budget-gates.mjs`), `packedFilePaths` (`scripts/release-gates.mjs`), `getPackList` (`src/__tests__/packaging.test.ts`), `packList` and the install canary's `filename` read (`scripts/packaging-current.test.mjs`), each via `const entries = Array.isArray(parsed) ? parsed : Object.values(parsed)`. Verified: `budget-gate.test.mjs` 19/19 (was 17/19), `packaging-current.test.mjs` 40/40 (was 39/40), `dist/__tests__/packaging.test.js` 73/73. npm 11 arrays still take the array branch. Plan 109's copy of this item is retired.
- (P3) `scripts/phase15-freeze.test.mjs` "baseline manifest count is coherent with the real filesystem" fails on the current workspace (expected 11 vs measured 9): its `manifestCount` plus the plan-054 `delta` constants no longer match `workspaceShape()` after later package changes (plans 083/105/106/107). Pre-existing and unrelated to the pack fix; rebaseline the counts or retire the 0.1.2-era leg.
- (P3) The `summaries` and `tools` omission kinds remain behavioral-only (`src/__tests__/context-budget.test.ts`); the inventory now pins tool results, history, context, skill-body demotion, and attachments. Add boundary rows for the remaining two when the drop order or their caps change.
- (P3) Tasks 2–3 ship a host-facing testing-subpath surface with no in-repo consumer. If none appears by the 0.11.0 cut, decide then whether to keep it as documented host API or revert it before the release.
- (P3) `npm run build` (all workspaces) was not run for Tasks 4–6; `build:core` plus the affected root suites were. Run the full build before the 0.11.0 cut.
