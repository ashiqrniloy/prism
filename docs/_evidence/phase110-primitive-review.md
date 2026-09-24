# Phase 110 — Primitive Review: Cache-Stability Scoring Surfaces and Conformance Rows

Plan: [110-Cache-Stability-Scoring-Surfaces-And-Conformance-Rows.md](../../plans/110-Cache-Stability-Scoring-Surfaces-And-Conformance-Rows.md) Task 1.
Date: 2026-09-22. Baseline: working tree at HEAD `3129d5cf`, Node v26.9.0. Reviewed sources are clean vs HEAD.
Method: read-only inventory plus a scratch probe (`/tmp/phase110-probe.mjs`, not committed; deleted after this
review) against the working-tree `dist/` build, same shape as plan 109 Task 1.
Scope: **gate for Tasks 2–6**. Tasks 2 and 3 have no in-repo consumer (§8) — do not start them. Tasks 4–6
reuse or extend a row below. Any primitive absent here is a review gap and must be added to §2 before
implementation.

Source of every later task: plan 101 `Compromises Made` and `Further Actions`
([101-Cache-Stability-Follow-Ups.md](../../plans/101-Cache-Stability-Follow-Ups.md)). Current contract:
`docs/prefix-stability-conformance.md:L13–L20` (the only export), `:L47–L58` (outputs, `resets` is an index
list, tail rule), `:L91–L131` (fold section and the inventory table). Stage ledger:
`docs/attention-compiler.md:L161–L162`. Layout order: `docs/input-and-prompt-assembly.md:L79–L85`. What the
cache keys on: `docs/provider-caching.md:L16` (hints are intent; the wire bytes are the prefix).

Cite convention: spans are `file:Lstart–Lend` verified in this tree. Every reuse row names the exact
exported symbol or the module-private seam inside one. Every gap row names the file that must change.
Every reject row names the task it would have affected. Plan 110's own citations were re-verified; drifts
are in §9 and the §1 span is authoritative.

---

## 1. Reuse inventory (what the later tasks build on)

### 1.1 Task 2 — the measurement, all module-private inside one export

The testing subpath exports one value. `dist/testing/prefix-stability-conformance.d.ts` and
`Object.keys` of the built module are both exactly `runPrefixStabilityConformance` plus the two option/result
types. `src/index.ts` does not re-export it. `package.json:L53` is the subpath.

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/testing/prefix-stability-conformance.ts:L14–L40` | `PrefixStabilityConformanceOptions` | `host`, `skills`, `minContinuity?` (default `0.95` at `:L75`), `assertOn?`, `inputs?`, `allowedResets?`. No request-list field. |
| `src/testing/prefix-stability-conformance.ts:L42–L59` | `PrefixStabilityConformanceResult` | `{ requests, minContinuity, cacheableContinuity, resets }`. No per-pair fractions. |
| `src/testing/prefix-stability-conformance.ts:L73–L170` | `runPrefixStabilityConformance` | The only exported function. Builds a session, captures four requests, measures, asserts. A host capture cannot enter here. |
| `src/testing/prefix-stability-conformance.ts:L220–L224` | `tailClassifier` (module-private) | Identity set, then serialized-value set, of the session map. Not a content heuristic. |
| `src/testing/prefix-stability-conformance.ts:L232–L244` | `measureRequest` (module-private) | One JSON fragment per tool schema and per message. `cacheablePrefix` drops tail fragments. |
| `src/testing/prefix-stability-conformance.ts:L252–L260` | `sharedPrefixFraction` (module-private) | Shared UTF-8 prefix / previous length. Empty previous returns `1`. |
| `src/input.ts:L360–L366` | `assembleProviderInput` tail call site | The only producer: `moveResourceMessagesToTail` + `appendSkillTailSegments` + `tailMessages`, and only when `options.tailSegments` is passed. |
| `src/input.ts:L574–L593` | `moveResourceMessagesToTail` (module-private) | URI resources move to the tail map. |
| `src/input.ts:L595–L623` | `appendSkillTailSegments` (module-private) | Loaded / eager skill bodies, one segment per skill. |
| `src/input.ts:L626–L629` | `appendTailSegment` (module-private) | `Map#set` retains first-insertion order. |
| `src/input.ts:L631–L633` | `tailMessages` (module-private) | Active ids only, insertion order. |
| `src/agent-session/session.ts:L150` | `tailSegments` (session field, not on the public `AgentSession` contract) | `new Map<string, Message>()`. The runner narrows to read it (`prefix-stability-conformance.ts:L102`). |
| `src/agent-session/session/assemble.ts:L354` | `tailSegments.clear()` | Cleared at the start of every run. A host that snapshots the map across runs reads an empty map on the next run. Plan 110 cites `:L241`; that line is `evaluateTurnStop`. §9. |

### 1.2 Task 3 — the gap list that already has both fractions

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/testing/prefix-stability-conformance.ts:L139–L152` | gap loop (module-private, inside `runPrefixStabilityConformance`) | Each pair pushes `{ request, fraction, cacheableFraction }` when the metric `assertOn` selected is below `minContinuity`. Both fractions are computed. They die with the local `gaps` array. |
| `src/testing/prefix-stability-conformance.ts:L154` | `resets = gaps.map((gap) => gap.request)` | Only the 1-based index survives onto the result (`:L169`). |
| `src/testing/prefix-stability-conformance.ts:L42–L59` | `PrefixStabilityConformanceResult.resets` | Documented index list. `docs/prefix-stability-conformance.md:L51`. |

### 1.3 Task 4 — fixture provider, one round, stub bytes

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/testing/prefix-stability-conformance.ts:L103` | `limits.maxToolRounds: 1` | One tool round per user turn. A second tool-calling response ends the run (`src/agent-loops.ts:L64–L66` sets `finishReason = "turn_limit"`). |
| `src/testing/prefix-stability-conformance.ts:L188–L205` | `fixtureProvider` (module-private) | `index % 2 === 0` emits one `load_skill` call (plus thinking when the host runs a compiler). `index % 2 === 1` yields `providerDone`. `index >> 1` selects the skill, so requests 1–2 are turn 0 and 3–4 are turn 1. Plan 110 cites `:L188–L207`; the function ends at `:L205`. |
| `src/agent-loops.ts:L304–L312` | `dispatchToolCallsInOrder` | One `chargeToolRound(calls)` for the whole array, then dispatch. Default concurrency is 1 (`:L284–L294`: only a `single-shot` loop with `toolConcurrency` set goes above 1). |
| `src/agent-session/session/tool-round.ts:L309` | `bindChargeToolRound` | `if (calls.length > 0) ctx.limits.charge("maxToolRounds")` — one charge per assistant message, not per call. |
| `src/attention-compiler.ts:L537–L551` | stage 2 + shrink guard (inside `compileAttention`) | `:L545–L546` estimates the row and the stub. `:L547–L551` leaves the row alone when `after >= before` and the id is not sticky. |
| `src/attention-compiler.ts:L632–L668` | `toolResultTargets` | Oldest-first, past `keepLast`, minus errors / `excludeTools` / protected metadata / fold age and `minBytes`. |
| `src/attention-compiler.ts:L700–L709` | `stubToolResultMessage` (module-private) | Replaces `result` with `foldedToolResultHeader(...)` and sets `metadata.prismFolded`. |
| `src/attention-compiler.ts:L713–L715` | `attentionStubText` (module-private) | `omitted ${bytes} bytes (sha256 ${digest})`. Digest is sha256 hex sliced to 32 (`:L728`, `THINKING_KEY_BYTES` at `:L448`). |
| `src/tool-result-fold.ts:L187–L189` | `foldedToolResultHeader` | `` `Tool result ${toolName} [${toolCallId}]: ${summary}` ``. |
| `src/tool-result-fold.ts:L193–L199` | `toolResultFoldText` | `JSON.stringify(error ?? result ?? null)` plus any text blocks still on the message. |
| `src/tool-result-fold.ts:L203–L211` | `capToolResultSummary` | UTF-8 cap. Host-summarize path only; the deterministic stub does not use it. |
| `src/skill-load.ts:L7` | `MAX_LOAD_SKILL_RESULT_BYTES` = `512` | Product cap. `capLoadSkillText` at `:L164–L172` enforces it. |
| `src/skill-load.ts:L211–L216` | `createLoadSkillTool` success return | Text is `` `Loaded skill ${skill.name} for this session.` ``, then capped. For `alpha` that string is 36 bytes and is not capped. |
| `src/input.ts:L529–L540` | `toToolResultMessage` | Wire row. Text content blocks are dropped (`:L536`); the value object is the `result`. |
| `src/context-budget.ts:L87–L89` | `estimateTextTokens` | `Math.ceil(text.length / 4)`. The shrink guard uses `estimateMessageTokens` (`src/context-budget.ts:L106`), which flattens through `messageText` (`:L456–L470`). |
| `src/run-limits.ts:L21` | `DEFAULT_RUN_LIMITS.maxRequestBytes` | `8 * 1024 * 1024`. Hard ceiling `HARD_RUN_LIMITS.maxRequestBytes` is 64 MiB (`:L31`). An 8 KiB fixture payload is not near either. |

### 1.4 Task 5 — calibration helper and the two pinned groups

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/__tests__/invalidation-inventory.test.ts:L79–L95` | `assembleTwice` (file-private) | One pair, boundary = first differing JSON fragment, continuity = the runner's fraction. Tasks 5 and 6 reuse it. |
| `src/__tests__/invalidation-inventory.test.ts:L281–L327` | eviction rows | Pins `tool_results` (boundary message 4) then `history` (boundary message 2). Caps come from `getContextBudgetReport` after `maxInputBytes: 1_000_000`. No other omission kind is pinned. |
| `src/context-budget.ts:L33–L41` | `ContextBudgetOmissionKind` | `skills`, `skill_body`, `context`, `history`, `tool_results`, `summaries`, `attachments`, `tools`. Plan 110 cites `:L33–L39`; `tools` is `:L41`. |
| `src/context-budget.ts:L220–L240` | `dropNext` order | `cache_aware`: tool_results → history → summaries → context → skills → attachments. `legacy` swaps attachments ahead of context. |
| `src/context-budget.ts:L255–L257` | attachments victim | `groups.attachments.pop()` — LIFO. |
| `src/context-budget.ts:L262–L271` | context victim | `pickVictimIndex` on `priority ?? 0` (`:L473–L481`: lowest priority, equal priority → highest index). |
| `src/context-budget.ts:L273–L289` | skills victim | Body demotion (`kind: "skill_body"`, `:L207–L208` on the report) before a full drop. |
| `src/context-budget.ts:L202–L215` | `applyContextBudget` report | `demotedSkillBodies` and `report.omitted`. `getContextBudgetReport` (`:L147–L150`) is what the inventory reads back. |
| `src/__tests__/context-budget.test.ts:L96` | behavioral drop order | `evicts history/tool results before context and skills`. |
| `src/__tests__/context-budget.test.ts:L198` | attachments kept, not pinned | `keeps cache_aware attachment prefix while dropping history`. Asserts attachments are **not** omitted. No LIFO boundary index. |
| `src/__tests__/context-budget.test.ts:L237` | context priority | `drops lower-priority context blocks before higher-priority ones`. Behavioral only. |
| `src/__tests__/context-budget.test.ts:L269` | context LIFO | `equal context priority preserves LIFO eviction`. Behavioral only. |
| `src/__tests__/context-budget.test.ts:L301`, `:L323` | skill demotion | Catalog demotion, then progressive-disclosure demotion. No boundary index. |

### 1.5 Task 6 — layout order and the hoist

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/input.ts:L445–L466` | `flattenInputGroups` | `cache_aware`: instructions, attachments, summaries, history, toolResults, input. `legacy`: instructions, summaries, history, input, attachments, toolResults. Plan 110 cites `:L445–L467`; the function ends at `:L466`. |
| `src/input.ts:L179–L213` | `createDefaultPromptBuilder` | `:L201–L203` `legacy` returns `[...context, ...skills, ...declarations, ...request.messages]`. `:L207–L211` `cache_aware` hoists leading system messages ahead of context/skills/declarations. Plan 110 cites `:L179–L212`; the function closes at `:L213`. |
| `docs/input-and-prompt-assembly.md:L79–L85` | documented order | Same two orders. Switching `inputLayout` is an explicit reorder, not a stability claim. |

### 1.6 Verification seams later tasks extend

| Span | Seam | Behavior |
| --- | --- | --- |
| `src/__tests__/prefix-stability-conformance.test.ts` | runner suite | The only behavioral caller of `runPrefixStabilityConformance`. Task 4 adds cases here. Tasks 2–3 add cases here only if the demand gate opens. |
| `src/__tests__/invalidation-inventory.test.ts` | inventory suite | Tasks 5 and 6 extend this file. No second fixture file. |
| `scripts/budgets.json` | export ceiling | Task 2's +2 (testing subpath, no root barrel) rebaselines with a reason entry only if Task 2 lands. |
| `scripts/plan-review-gate.test.mjs` | this review's gate | `PLAN_110_TASK_1` names the tokens this file must keep. |

---

## 2. Gap rows (what no current seam does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | No export accepts a captured request list. The module's only function export is `runPrefixStabilityConformance`. `scorePrefixStability` is `undefined`. A hand-built two-request capture passed to the export throws `TypeError: skills is not iterable` before any measurement. **CONFIRMED §5(a).** | `src/testing/prefix-stability-conformance.ts` | 2, **gated §8** |
| G2 | `resets` is indexes only. The gap row's `fraction` and `cacheableFraction` stay local (`:L139–L152`); `:L154` keeps `request`. The result object has no `resetDetails`. **CONFIRMED §5(b).** | `src/testing/prefix-stability-conformance.ts` | 3, **gated §8** |
| G3 | Stage 2 cannot be the visible reset with today's fixture. The 36-byte `load_skill` confirmation estimates at 18 tokens; its stub estimates at 27. The shrink guard leaves it. **CONFIRMED §5(c).** A synthetic row at the 512-byte cap would **not** be skipped (137 vs 27) — the miss is the fixture's actual 36-byte text, not "anything ≤ 512 loses to the stub". | `src/testing/prefix-stability-conformance.ts` (new fixture tool + `foldableToolResultBytes`). Do not edit `src/skill-load.ts` or `src/attention-compiler.ts`. | 4 |
| G4 | `context`, `skills` / `skill_body`, and `attachments` have no boundary index in `src/__tests__/invalidation-inventory.test.ts`. They are behavioral-only in `src/__tests__/context-budget.test.ts`. **CONFIRMED §5(d)** by the suite's pinned kinds (`tool_results`, `history` only). | `src/__tests__/invalidation-inventory.test.ts` | 5 |
| G5 | `legacy` layout has no parity row. The shipped inventory never passes `inputLayout`. **CONFIRMED §5(e):** the injector-context boundary moves from 2 to **1**, not to 0. The bare summary fixture stays at 1 in both layouts. | `src/__tests__/invalidation-inventory.test.ts` | 6 |

---

## 3. Per-task decision (reuse as-is / extend / add new)

| Task | Decision | Named seams |
| --- | --- | --- |
| 2 | **Do not start** (§8: no consumer). If a host consumer appears: **extend** `measureRequest`, `tailClassifier`, and `sharedPrefixFraction` into one exported `scorePrefixStability`; `runPrefixStabilityConformance` delegates. No second function, no root-barrel export, no new file. | §1.1; G1 |
| 3 | **Do not start** (§8). No in-repo reader for a private projection either. If a consumer appears: **extend** the existing gap list with one projection shared by the runner result and the scorer. `resets` stays the index list. The plan's fallback (private helper while the scorer stays unchecked) is still that same projection — it does not justify starting the task with no consumer. | §1.2; G2 |
| 4 | **Extend** `fixtureProvider` and `PrefixStabilityConformanceOptions`. Add `foldableToolResultBytes` and one runner-owned tool, installed only when the option is set. The two-call / one-round assumption holds (§5(f)). | §1.3; G3 |
| 5 | **Reuse** `assembleTwice` and the calibration step. Extend the existing suite. No production change. | §1.4; G4 |
| 6 | **Reuse** `assembleTwice`. Assert both layouts. Pin the **measured** indexes in §5(e), not plan 110's guessed `0`. The bare summary fixture is vacuous across layouts; the parity row needs context (and a skill, if the claim is "after the skill slot"). | §1.5; G5 |

---

## 4. Rejected alternatives (frozen)

None may reappear as an implementation without a new review row. R1–R6 are this task's gate list.
R7–R9 are this task's process rejects. R10–R20 are the later tasks' rejects, recorded so they are not reopened.

| # | Rejected | Task | Reason |
| --- | --- | --- | --- |
| R1 | A wire marker on the provider payload | 2 | Wire bytes are what the prompt cache keys on (`docs/provider-caching.md:L16`). A marker that varies per request is the invalidation the runner measures, and it would change every host's requests, not just fixtures. |
| R2 | A second conformance runner for host traffic | 2 | Duplicated assertions and two definitions of "reset". One scorer the runner calls is the only shape that cannot drift. No consumer exists today (§8), so even that scorer stays unbuilt. |
| R3 | Pattern-matching host content to find tail segments | 2 | `tailClassifier` (`src/testing/prefix-stability-conformance.ts:L220–L224`) matches the session's own `Message` objects. A content heuristic mis-classifies host text that happens to look like a skill body. |
| R4 | Changing allowedResets semantics | 3, 4 | `allowedResets` is documented and asserted (`docs/prefix-stability-conformance.md:L51`, the fold suite). Detail rows project the same gap list; they do not redefine how many gaps pass. |
| R5 | Raising `MAX_LOAD_SKILL_RESULT_BYTES` | 4 | Product cap at `src/skill-load.ts:L7`. A fixture must not dictate it. §5(c) also shows the cap is not the shrink floor: a 512-byte confirmation would fold, today's 36-byte one does not. Raising the cap would be the wrong lever even though it would mechanically clear the guard. |
| R6 | Pinning eviction groups in production code instead of fixtures | 5 | Drop order already lives in `dropNext`. A production pin duplicates the inventory suite and couples a cache-boundary index to the budget pass. |
| R7 | Treating the items as already-designed work and skip the review | 1 | Every later task adds or moves a testing-subpath surface or a fixture contract, and the demand gate needed a measurement. |
| R8 | One evidence file per task | 1 | One review owns the inventory; later tasks cite its rows, matching plans 102/103/104/108/109. |
| R9 | Registering the gate block later, with the code | 1 | `PLAN_074_TASK_1` in `scripts/plan-review-gate.test.mjs` is the shape. A Task 1 without the gate can drift with no signal. |
| R10 | Exporting `measureProviderPrefix` plus a classifier factory | 2 | Two exports for internals a host can mis-order. One entry point, if it ever lands, returns the whole sample. |
| R11 | An adapter-level segment index inside provider adapters | 2 | Adapters do not know tail ids. A host with its own capture or a non-Prism transport would get nothing. |
| R12 | Replacing `resets` with detail rows | 3 | `resets` is published and asserted. A rename breaks hosts for a cosmetic gain. |
| R13 | A parallel `fractions` array with no `request` field | 3 | Index-pairing two arrays is the fragile shape the alignment test would have to police. |
| R14 | A host-provided tool for the fixture provider to call | 4 | Determinism would depend on host tool behavior. Cross-host comparability is the runner's premise. |
| R15 | Three requests per turn | 4 | Breaks the four-request contract and the docs' "two per turn" sentence. §5(f) shows two calls still fit in two requests. |
| R16 | Tuning `fold.minBytes` down to the confirmation's size | 4 | The shrink guard still skips the 36-byte row (stub is larger). It would prove the gate, not stage 2. |
| R17 | Hardcoding caps that happen to evict the right group | 5 | A cap tied to the ÷4 estimator breaks when the estimator or the fixture text changes. Calibration derives it. |
| R18 | A dedicated `context-budget-boundaries.test.ts` | 5 | The inventory rows are one table and one suite. |
| R19 | Drop legacy support instead of pinning it | 6 | Documented layout hosts select explicitly. Removal is a breaking change, not a fixture side effect. |
| R20 | Pin only `cache_aware` and document legacy as unverified | 6 | That is today's gap (G5). |

---

## 5. Confirmation (runnable observation)

Probe: `/tmp/phase110-probe.mjs` (not committed; deleted after this review), against `dist/`, Node v26.9.0.
Host and skills match `src/__tests__/prefix-stability-conformance.test.ts` (`host()`, `alpha` / `beta`).
Raw observations:

```
exports: ["runPrefixStabilityConformance"]
scorePrefixStability: undefined
handBuilt: TypeError: skills is not iterable
runnerResult: {"requests":4,"minContinuity":0.9790209790209791,"cacheableContinuity":1,"resets":[]}
foldRunner: {"requests":4,"minContinuity":0.533163913595934,"cacheableContinuity":0.5404430705821741,"resets":[3]}
default measureRequest bytes: 4154, 4576, 4655, 5078
default wire JSON bytes: 4475, 4897, 4976, 5399
twoCall.requests: 4
twoCall request 2: indexMod2 1, turn 0, toolResults 2, toolCallsInHistory 2
  roles: system, system, system, system, user, assistant, tool, tool, system
confirm text: "Loaded skill alpha for this session." bytes 36 cap 512
confirm tokens before/after: 18 / 27  messageBytes 72 / 105  guardSkips true
compileSmall: AttentionBudgetError ... stubbing 0 tool results
bulk generatedBytes 8192  messageBytes 8194 / 123  tokens 2049 / 31  shrinkBytes 8071  guardSkips false
compileBulk: AttentionBudgetError ... stubbing 1 tool results
atCap (512-byte text, not the fixture row): tokens 137 / 27  skips false
layoutContext cache_aware messageIndex 2
layoutContext legacy messageIndex 1
layoutSummary both layouts messageIndex 1
layoutSummaryWithContext cache_aware 1 / legacy 3
runnerPass median 0.801 ms (min 0.726, max 1.080, 11 samples after 2 warmup)
measureOnly median 0.048 ms
resetDetail JSON bytes: 80 (identical fractions) / 81 (runner's two minimums)
```

- **(a) CONFIRMED — no export accepts a capture.** Module keys are `runPrefixStabilityConformance` only.
  Passing a two-element request array to that function throws `TypeError: skills is not iterable`. The
  runner reads `options.skills` (`src/testing/prefix-stability-conformance.ts:L74`) and never looks at a
  request list. Tail segments are produced only at `src/input.ts:L360–L366` and the session map is cleared
  at `src/agent-session/session/assemble.ts:L354`, so a host cannot reconstruct the classifier's input from
  a capture either (G1).
- **(b) CONFIRMED — `resets` is index-only.** Default result keys: `requests`, `minContinuity`,
  `cacheableContinuity`, `resets`. Fold run returns `resets: [3]` and no fractions. The per-pair
  `{ request, fraction, cacheableFraction }` exists only inside the loop (`:L139–L152`) and `:L154` keeps
  `request` (G2).
- **(c) CONFIRMED — stage 2 skips the fixture row.** `createLoadSkillTool(...).execute({ name: "alpha" })`
  returns text `Loaded skill alpha for this session.` (36 bytes, under `MAX_LOAD_SKILL_RESULT_BYTES` 512).
  `toToolResultMessage` of that result is 72 bytes / 18 tokens. The deterministic stub
  (`foldedToolResultHeader` + `attentionStubText`) is 105 bytes / 27 tokens. `compileAttention` with
  `keepLast: 0` and a predicate that always folds throws `AttentionBudgetError` naming
  `stubbing 0 tool results`. An 8 KiB `"x".repeat(8192)` row is 8194 message bytes / 2049 tokens; its stub
  is 123 bytes / 31 tokens; the same `compileAttention` call throws naming `stubbing 1 tool results`.
  A synthetic confirmation whose text is exactly 512 `"x"` bytes estimates at 137 tokens vs a 27-token
  stub and would **not** be skipped — recorded so Task 4 does not treat the cap as the shrink floor.
  The floor the fixture needs is `estimateMessageTokens(row) > estimateMessageTokens(stub)`. 18 < 27 fails
  it. 2049 > 31 clears it (G3).
- **(d) CONFIRMED — pinned eviction rows are `tool_results` then `history` only.**
  `src/__tests__/invalidation-inventory.test.ts:L281–L327` is the only boundary pin. `context`, `skills`,
  and `attachments` appear in `src/__tests__/context-budget.test.ts` as behavior (priority, LIFO, demotion,
  "attachments not omitted"), not as a message index (G4). Drop order and victims are the §1.4 spans.
- **(e) CONFIRMED — layout move, and plan 110's index 0 is wrong.** Same injector-context fixture as
  plan 101 Task 3:
  - `cache_aware` boundary **2**. Texts before: system, `Project:\nstable`, skill, `Ask`. After: the
    `Now:\nturn two` block inserts at index 2.
  - `legacy` boundary **1**, not 0. Texts before: `Project:\nstable`, skill, system, `Ask`. After: `Now`
    inserts at index 1. Message 0 is the stable host context block, so the boundary is not the leading
    message. The context *slot* does lead (message 0 is context). The *boundary index* is 1.
  - Bare summary fixture (no context, no skills): boundary **1 in both layouts**. `flattenInputGroups`
    and the legacy prompt branch have nothing to put in front of instructions+summary, so the hoist
    difference is invisible. A parity row on this fixture passes vacuously.
  - Same summary fixture plus the host context provider and `brief` skill: `cache_aware` boundary **1**
    (summary stays hoisted after the system prompt). `legacy` boundary **3** (`Project`, skill, system
    instruction, then the summary). That is the row Task 6 must pin.
- **(f) CONFIRMED — two tool calls, one round, four requests.** A provider that copies `fixtureProvider`
  and adds a second `tool_call` (`prefix_stability_bulk`) on `index % 2 === 0`, with
  `limits.maxToolRounds: 1`, captured **4** requests. Request 2 (`index % 2 === 1`, `index >> 1 === 0`)
  carries **2** `tool_result` blocks and 2 `tool_call` blocks, roles
  `system ×4, user, assistant, tool, tool, system`. No fifth request. Mapping: even index is the
  tool-call request of turn `index >> 1`; odd index is the completion that carries that turn's results.
  Dispatch is sequential (`src/agent-loops.ts:L284–L294` returns 1) but still one charged round
  (`src/agent-session/session/tool-round.ts:L309`). Task 4's "two requests per turn" assumption holds.
  "Parallel" means one assistant message, not concurrent dispatch.

**Refuted by the same probe:**

- Plan 110's `src/agent-session/session/assemble.ts:241` for the tail-map clear. The clear is `:L354`.
  `:L241` is inside `evaluateTurnStop`.
- Plan 110 Task 6's legacy injector-context boundary of 0. Measured 1.
- Plan 110 Task 6's implication that the shipped summary fixture moves under `legacy`. It does not,
  unless the fixture also has context (and a skill, for the skill-slot claim).

---

## 6. Measured costs (numbers, not claims)

Same probe. Runner median is 11 samples after 2 warmup, default `host()` from the conformance test.
Regression baselines only — the shipping suites assert behavior; the harness is not committed.

| Path | Measured | Consequence for the task |
| --- | --- | --- |
| One `runPrefixStabilityConformance` pass, default host, four requests | **0.801 ms** median (min 0.726, max 1.080) | Session + two runs dominate. A scorer over an already-captured list is not this number. |
| `measureRequest` + `sharedPrefixFraction` over those four requests, no session | **0.048 ms** median | The private measurement Task 2 would export. About 6% of one runner pass. One pass, no second serialization. |
| Per-request `measureRequest` bytes (the runner's payload: tool-schema fragments + message fragments) | **4154, 4576, 4655, 5078** | The four fixture requests. Wire `JSON.stringify(request)` is 4475, 4897, 4976, 5399 — model and options sit outside the measured prefix. |
| One `resetDetails` entry, fold gap `{ request: 3, fraction: 0.533163913595934, cacheableFraction: 0.533163913595934 }` | **80 bytes** JSON | The planned row. Using the runner's two different minimums (`0.533…` and `0.5404430705821741`) is **81 bytes**. Empty `resetDetails` adds a key, not a row. The per-pair cacheable fraction is not on the result today (G2), so 81 uses the run-level minimums as the stand-in precision. |
| 8 KiB generated payload vs its stub, versus the 512-byte cap | payload **8192** bytes; compiler message **8194 → 123** bytes; shrink **8071** bytes; tokens **2049 → 31** | 8192 is 16× `MAX_LOAD_SKILL_RESULT_BYTES` (512) and far under `maxRequestBytes` (8 MiB). The 36-byte confirmation does not shrink (72 → 105 message bytes, 18 → 27 tokens). |
| Fold runner, one sample, `allowedResets: 1` | **1.635 ms**, `resets: [3]` | Thinking-stage fixture only. Not the Task 4 case. |

---

## 7. Security confirmations and hard rejections

- **No host payload can ride the new surfaces.** `scorePrefixStability` / `resetDetails`, if they land,
  return fractions and indexes only: `{ request, fraction, cacheableFraction }` plus the two minimums.
  `measureRequest`'s strings stay module-private. The result type today already excludes message text
  (`PrefixStabilityConformanceResult`, `src/testing/prefix-stability-conformance.ts:L42–L59`). A detail
  row adds three numbers, not a fragment.
- **No marker on the provider payload by default (R1).** The cache keys on wire bytes. A marker that
  varies per request is the invalidation the measurement exists to catch. The runner adds nothing to
  `ProviderRequest` today; Task 4's extra tool call is opt-in and changes the fixture scenario only when
  `foldableToolResultBytes` is set.
- **The fixture bulk payload is generated text.** Task 4's `"x".repeat(n)` and this probe's 8 KiB row
  are generated. They are not captured host content, not a secret, and not a prompt. The 36-byte
  confirmation measured here came from `createLoadSkillTool` against a fixture skill named `alpha`.
- **Tail classification stays identity-based (R3).** A wrong `tailSegments` map, if Task 2 ever accepts
  one, yields a wrong number rather than a throw — already the docs rule at
  `docs/prefix-stability-conformance.md:L58`. Do not add a content matcher to "fix" that.

---

## 8. Demand gate (Tasks 2 and 3)

Command: `rg -n "runPrefixStabilityConformance|prefix-stability-conformance" src packages examples scripts`.

| Hit | What it is |
| --- | --- |
| `src/testing/prefix-stability-conformance.ts:L73` | The definition. |
| `src/__tests__/prefix-stability-conformance.test.ts` | The only caller. Test suite. |
| `src/__tests__/docs.test.ts:L75`, `:L2737–L2740` | Docs-contract strings (`docs/prefix-stability-conformance.md`, the subpath, the function name). |
| `src/__tests__/invalidation-inventory.test.ts:L7` | Comment pointing at the docs page. |
| `scripts/e2e-coverage.json:L178–L181` | Coverage map from the subpath to the test file. |
| `scripts/compat-baseline/arnilo__prism.txt:L966` | Export baseline line. Not a call. |
| `scripts/budgets.json:L7`, `:L17`, `:L25` | Reason-string mentions of the docs page and the plan 088 +3. Not a call. |
| `packages/` | **zero hits** |
| `examples/` | **zero hits** |

`package.json:L53` (outside that grep) is the subpath map. No script invokes the runner.

**Tasks 2 and 3: no in-repo consumer at review time.** A host reads `docs/prefix-stability-conformance.md`
and runs `runPrefixStabilityConformance` — the docs fallback. That was the gate. An explicit request opened
Task 2 anyway.

**Status.** Task 2 landed (2026-09-22). `scorePrefixStability` is the one producer (`src/testing/prefix-stability-conformance.ts`).
The runner calls it with `{ tailSegments, minContinuity, assertOn }` and reads the sample. `assertOn` is
optional, default `providerPrefix`, so fixture resets stay on the selected metric without a second pass.
G1 is retired for the scorer. G2 is retired (2026-09-22): the runner result copies `sample.resetDetails`
from `projectResetDetail`. No second gap loop. No new export.

**Task 4 landed (2026-09-22):** G3 is retired. `foldableToolResultBytes` installs a private
`prefix_stability_bulk` tool (`"x".repeat(bytes)`) and the fixture provider emits a second call in the
same round, so the run stays four requests. Measured with 8 KiB: the run-2 opening estimate is over
3,500 tokens with the row and 1,841 after stage 2 stubs it (floor 2,500 settles and cannot fire on
the run-1 opening); the stub header is
`Tool result prefix_stability_bulk [prefix-stability-bulk-0]: omitted 8194 bytes (sha256 …)`; the
sibling 36-byte confirmation is byte-identical across the reset; every thinking block survives
(`thinkingKeepTurns: 1`, so stage 1 has nothing to strip); the tail re-renders byte-identically. Case
wall-clock 1.3–3.5 ms across the five floor probes. The option is off by default: captured requests
carry no bulk tool and no bulk call id. No new export.

**Task 5 landed (2026-09-22):** G4 is retired. `src/__tests__/invalidation-inventory.test.ts` pins the
three groups with the same calibration shape as the shipped rows (`maxInputBytes: 1_000_000`, then
`keptBytes - 1`): context boundary **1** (lowest-priority block; the higher-priority bytes survive),
skills boundary **1** (`skill_body` demotion; the `Skill big: short desc` catalog text survives),
attachments boundary **2** (newest pops LIFO; the older bytes survive). Each case reads its omission
kind back from `getContextBudgetReport`; no production change and no new export. Suite: 10 tests,
**6.6 ms** (plan 101's seven-case mark was ~13 ms).

**Task 6 landed (2026-09-22):** G5 is retired. The injector fixture now uses one module-scope,
layout-parameterized builder for both the shipped row and the parity rows. Measured and pinned:
injector-context boundary **2 (`cache_aware`) → 1 (`legacy`)** with the host context staying at
message 0 under legacy, and summary boundary **1 → 3** once context and a skill lead. Both parity
pairs assert the boundary moves on layout alone. Suite: 12 tests, 8.2 ms. No production change, no
new export.

---

## 9. Stale plan cites (this review's spans win)

| Plan 110 cite | Actual |
| --- | --- |
| `src/agent-session/session/assemble.ts:241` | `tailSegments.clear()` is `:L354` |
| `src/input.ts:577-632` | producers are `:L574–L633`; the call site is `:L360–L366` |
| `src/testing/prefix-stability-conformance.ts:188-207` | `fixtureProvider` is `:L188–L205` |
| `src/testing/prefix-stability-conformance.ts:220-230` | `tailClassifier` is `:L220–L224` |
| `src/testing/prefix-stability-conformance.ts:252-259` | `sharedPrefixFraction` is `:L252–L260` |
| `src/input.ts:445-467` | `flattenInputGroups` is `:L445–L466` |
| `src/input.ts:179-212` | `createDefaultPromptBuilder` is `:L179–L213` |
| `src/context-budget.ts:33-39` | the kind union is `:L33–L41` |
| Task 6 legacy injector-context boundary `0` | measured **1** |
| Task 6 bare summary fixture moves under `legacy` | measured **1 in both layouts**; with context+skill, legacy boundary is **3** |

---

## 10. Evidence-artifact scope

Read-only for the tree except this file and `PLAN_110_TASK_1` in `scripts/plan-review-gate.test.mjs`.
No production code, no test, no docs navigation. `docs/index.md` is not touched (`docs/_evidence/` is not
indexed, `.agents/skills/create-plan/references/prism-wiki.md`). Tasks 4–6 must cite a row from §1/§2.
Tasks 2–3 must not start without a consumer (§8). All numbers in §5 and §6 are from the probe above.
