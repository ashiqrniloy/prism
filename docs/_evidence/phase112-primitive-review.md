# Phase 112 — Primitive Review: Family Token Table Freeze and Budget Provenance Single Source

Plan: [112-Family-Token-Table-Freeze-And-Budget-Provenance-Source.md](../../plans/112-Family-Token-Table-Freeze-And-Budget-Provenance-Source.md) Task 1.
Date: 2026-09-22. Baseline: working tree at HEAD `3129d5cf` (0.10.1 WIP), root `dist/` built 2026-09-22
20:13 from this tree, Node v26.9.0, AMD Ryzen 9 PRO 7940HS, linux x64. Reviewed sources are the working
tree; every span below was re-verified there.
Method: read-only inventory plus scratch probes (five files, not committed) against the built root `dist/`.
Probe commands and printed output are in §4.
Scope: **gate for Tasks 2–3**. Task 2 extends `src/usage-estimation.ts` in place (no new export, no type
change); Task 3 edits two docs pages (no code). The demand-gated remainder — barrel promotion of the seam
helpers and detection of post-budget request mutations — stays recorded in plan 103; §4.5 is the evidence
for that gate. Any primitive absent here is a review gap and must be added to §2 before implementation.

Source of the work: plan 103 `Compromises Made` + `Further Actions`
([103-Usage-Estimation-And-Context-Meter-Follow-Ups.md](../../plans/103-Usage-Estimation-And-Context-Meter-Follow-Ups.md)),
`docs/_evidence/phase103-primitive-review.md` (reuse inventory; gap G11 is this plan's Task 2, R3/R18 are
the gated remainder) and `docs/_evidence/phase103-family-token-calibration.md` (row provenance Task 2 must
not change).

Cite convention: spans are `file:Lstart–Lend` verified in this tree. Every reuse row names the exact
exported symbol or the module-private seam inside one. Every gap row names the file that must change. Every
rejected alternative names the plan item it answers.

---

## 1. Reuse inventory (what Tasks 2–3 build on)

### 1.1 Task 2 — the freeze target and its seams

| Span | Exported symbol / seam | Behavior |
| --- | --- | --- |
| `src/usage-estimation.ts:L22–L27` | `ModelFamilyTokens` | `{ charsPerToken, perMessageOverhead, confidence }`, all `readonly` — compile-time only, no runtime guarantee. Unchanged by Task 2. |
| `src/usage-estimation.ts:L30–L38` | `MODEL_FAMILY_TOKENS` | `Readonly<Record<ModelFamily, ModelFamilyTokens>>` built from seven inline object literals; **no `Object.freeze` at either layer**. Measured unfrozen §4.1. Task 2 wraps each row and the table in `Object.freeze` in place. |
| `src/usage-estimation.ts:L17`, `:L19` | `CJK_CHARS_PER_TOKEN` = 1.5, `CODE_RATIO_FACTOR` = 0.88 | Module-private ratio constants (not frozen; primitives cannot be). Unchanged. |
| `src/usage-estimation.ts:L52–L62` | `resolveModelFamily` | Model id/provider id/family name → table key; unmatched → `"unknown"`. Reads `id in MODEL_FAMILY_TOKENS` at `:L55`. Unchanged. |
| `src/usage-estimation.ts:L64–L75` | `estimateTextTokensForFamily` | Reads `MODEL_FAMILY_TOKENS[resolveModelFamily(modelFamily)].charsPerToken` at `:L65` and returns `Math.ceil(...)` at `:L74`. The hot reader a mutated row silently corrupts; **not** re-exported by the barrel. Unchanged. |
| `src/index.ts:L801` | barrel export | `export { MODEL_FAMILY_TOKENS, resolveModelFamily } from "./usage-estimation.js";` (the plan cited `:798`; the tree drifted to `:801`). The table a host can reach; the freeze must not change this line. |
| `src/context-budget.ts:L106–L119` | `estimateMessageTokens` array overload | Reads `table.perMessageOverhead` (`:L113`) and `table.confidence` (`:L115`) from the same rows, so a replaced row makes both token counts and the confidence label unsound. Unchanged. |
| `src/__tests__/usage-estimation.test.ts:L46–L130` | the estimation suite | Existing literals/behaviors Task 2 extends: o200k ±15% drift (`:L47`), conservative `unknown` (`:L60`), CJK density (`:L73`), resolution table (`:L84`), message folding (`:L104`), purity (`:L117`), 100k-char envelope (`:L124`). Its fixture strings are the pinned corpus §4.7 records. |
| `src/__tests__/usage-calibration.test.ts:L61–L129` | calibration bands | Prose ±12%, CJK ±20%, per-message overhead ±1 against `src/__tests__/fixtures/usage-calibration.json`; the shifted-row negative control (`:L110–L120`) already copies a value rather than mutating the table precisely because G11 was true. Must stay green after Task 2. |
| `scripts/budget-gate.test.mjs:L263–L273` | root startup ratio row | Import wall clock vs process start under a pinned ratio ceiling — the regression guard for freezing seven rows at module scope. Task 2 keeps it green; no new benchmark. |
| `docs/runs-and-usage.md:L81` | family-table paragraph | Names the seven families and the confidence semantics; Task 2 adds the frozen sentence here and keeps the recalibration pointer (`:L83`). |
| `docs/_evidence/phase103-primitive-review.md:L145` | plan 103 G11 | `Object.isFrozen(MODEL_FAMILY_TOKENS) === false` and a writable row were already measured at 0.9.0 — this review re-measures the two-layer state at 0.10.1 and adds the shallow-freeze half. |

### 1.2 Task 3 — the two provenance pages

| Span | Exported symbol / page fact | Behavior |
| --- | --- | --- |
| `docs/agent-events.md:L199–L206` | `provider_turn_finished.metadata.budgets` payload reference | Shape at `:L199–L200`; field meanings at `:L201–L203`; the enum rule at `:L204` (`"reported"` or `"estimated"`, absent with `inputTokens`); optionality at `:L205–L206`. This page owns the shape; Task 3 removes the second explanation of the enum. |
| `docs/runs-and-usage.md:L85–L99` | `AgentConfig.usageEstimation` fallback contract | Mode semantics `:L87`, fallback bullet with the label derivation `:L89`, never-priced rule `:L91`, `"off"` `:L92`, `"strict"` `:L93`, scope sentence `:L95`, ordered three-path list `:L97–L99`. This page derives the enum from the paths, so Task 3 makes it canonical. |
| `plans/103-Usage-Estimation-And-Context-Meter-Follow-Ups.md:L97` | Task 2 execution note | Records that the label shipped in one spread and that **both** pages were edited in lockstep (`docs/runs-and-usage.md:L87`, `docs/agent-events.md:L199–L207`) plus `docs/execution-timeline.md:L142` — the drift Task 3 closes. |
| `docs/execution-timeline.md:L148` | timeline projection | "with its `inputTokensSource` provenance label" — a pass-through mention, not an explanation; no duplication, Task 3 leaves it. |
| `docs/input-and-prompt-assembly.md:L94` | budget stage position | `contextBudget` runs after default message groups are built and before the final flatten — the page that fixes the mutation window §4.4 measures. Unchanged. |

### 1.3 Sibling exported tables (frozen state and decision)

Measured live against the built root `dist/`, §4.6.

| Span | Symbol | Kind / live frozen state | Decision |
| --- | --- | --- | --- |
| `src/guardrail-packs/index.ts:L20` | `BUILT_IN_GUARDRAIL_PACK_IDS` | `readonly string[]` (runtime array), `Object.isFrozen` → `false`, length 4 | Not frozen here. A mutation changes which packs validate; it cannot change a token count. Recorded as a lower-severity gap (G7), not a task. |
| `src/content.ts:L25` | `MODEL_INPUT_CAPABILITIES` | `as const` array, `Object.isFrozen` → `false`, length 6 | Not frozen here. A mutation changes capability validation outcomes; no numeric accounting reads it. G7, not a task. |
| `src/thinking.ts:L8` | `THINKING_LEVELS` | `as const` array, `Object.isFrozen` → `false`, length 7 | Not frozen here. A mutation changes thinking-level validation; no numeric accounting reads it. G7, not a task. |
| `src/usage-estimation.ts:L30` | `MODEL_FAMILY_TOKENS` | object with seven object rows, table and every row `false` | **Task 2 freezes this one only** — it is the only one of the four whose mutation silently changes numeric accounting (and can make it `NaN`). |

---

## 2. Gap rows (what no current seam or page does)

| # | Gap | File that must change | Task |
| --- | --- | --- | --- |
| G1 | The table is unfrozen at both layers: `Object.isFrozen(MODEL_FAMILY_TOKENS)` → `false`, `Object.isFrozen(MODEL_FAMILY_TOKENS.anthropic)` → `false`; a nested write turns a 100-token estimate into 4 and a row replacement into `NaN`, with no error and no warning. **CONFIRMED §4.1.** | `src/usage-estimation.ts:L30–L38` | 2 |
| G2 | A table-level freeze alone does not close G1: rows stay writable after `Object.freeze(MODEL_FAMILY_TOKENS)` and the write still lands. **CONFIRMED §4.2.** The freeze must be per-row **plus** table, and Task 2's test must fail if a row is left unfrozen. | `src/usage-estimation.ts:L30–L38` + `src/__tests__/usage-estimation.test.ts` | 2 |
| G3 | No test asserts the frozen state at either layer, so a later edit that adds an eighth row can ship a writable row silently; the existing suite pins bands (`usage-calibration.test.ts:L61–L129`) and behaviors (`usage-estimation.test.ts:L46–L130`) but not immutability. | `src/__tests__/usage-estimation.test.ts` | 2 |
| G4 | The enum is explained twice: `docs/agent-events.md:L204` states the two values and the absent-together rule, `docs/runs-and-usage.md:L89` restates the label derivation. Plan 103 Task 2 had to edit both in lockstep (`plans/103-…:L97`), and the event page is the page that went stale once already (plan 103 G2). **CONFIRMED §4.8.** | `docs/agent-events.md:L199–L206`, `docs/runs-and-usage.md:L85–L99` | 3 |
| G5 | The report path measures the request before `input_assembly`/`prompt_build` middleware (`src/input.ts:L340`, `:L370–L383`), tail segments (`:L360–L366`), and the prompt builder (`:L369–L397`) run, so a request mutated after `applyContextBudget` (`:L329–L338`) is under-counted. Measured 19.4% short with an 8k-char append and 0.0% same-basis without it. **CONFIRMED §4.4.** | none here: demand-gated, stays recorded in plan 103 (R5) | none |
| G6 | `resolveHostTokenEstimator` and `estimateRequestExtrasTokens` are exported from `src/context-budget.ts` (`:L413`, `:L422`) for the usage seam only, and absent from the barrel (`src/index.ts`). One in-tree consumer (`src/agent-session/session/provider-round.ts:L191`, `:L197`, `:L202`) plus one plan-103 test. **CONFIRMED §4.5.** | none: no host demand, stays recorded in plan 103 (R4) | none |
| G7 | The sibling tables in §1.3 are runtime-mutable. Mutating them changes validation outcomes (pack ids, capability tags, thinking levels) but never a token/cost figure, so the blast radius is different in kind from G1 and is not widened into this plan. | `src/guardrail-packs/index.ts:L20`, `src/content.ts:L25`, `src/thinking.ts:L8` | none (recorded) |

---

## 3. Per-task verdict (reuse as-is / extend / add new)

| Task | Verdict | Seam | New surface |
| --- | --- | --- | --- |
| 2 — deep-freeze the table | **Extend `src/usage-estimation.ts` in place** | `MODEL_FAMILY_TOKENS` (`:L30–L38`) gets per-row `Object.freeze` plus a table `Object.freeze`, with the hazard reason inline; the existing estimation suite (`src/__tests__/usage-estimation.test.ts:L46–L130`) gains the freeze block and the pinned literals §4.7 records; the calibration suite and `scripts/budget-gate.test.mjs:L263` stay green | No new export, no new module, no new type; `Readonly<Record<ModelFamily, ModelFamilyTokens>>` stays the declared type; only `Object.freeze` calls at the declaration |
| 3 — one owning page for the provenance enum | **Edit two docs pages; no code** | `docs/agent-events.md:L199–L206` keeps the shape and one line per field, linking to the runs-and-usage section; `docs/runs-and-usage.md:L85–L99` owns the two values, the absent-together rule, what produces each (the three paths), the never-priced rule, and the caveat with the measured number | No API, no test, no config; only wording ownership moves, and any fact already stated once is left untouched |

Neither task adds an export, a default, or a pinned number in `scripts/budgets.json`.

---

## 4. Runnable confirmations

All probes ran against the built root `dist/` from this tree (Node v26.9.0). Probes are scratch files kept
outside the tree and are not committed (`freeze.mjs`, `shallow.mjs`, `deep.mjs`, `under-count.mjs`,
`tables.mjs`, `literals.mjs`, `timing.mjs`); two import the module directly (`dist/usage-estimation.js`,
`dist/context-budget.js`) because the estimator and the seam helpers are deliberately not barrel exports.

### 4.1 The two-layer freeze gap — measured, not asserted — CONFIRMED

`node freeze.mjs`:

```text
frozen? false | row frozen? false
nested mutation {"charsPerToken":3.7,"perMessageOverhead":4,"confidence":"medium"} -> {"charsPerToken":99,"perMessageOverhead":4,"confidence":"medium"}
estimate 370 chars: 4 (was 100)
row replacement {} -> estimate 370 chars: NaN
```

This reproduces the transcript recorded while the plan was written, byte-for-byte on the first three lines
(`frozen? false | row frozen? false | nested mutation … | estimate 370 chars: 4 (was 100)`), and adds the
`NaN` row-replacement leg the plan's Objective cites. The `NaN` is not a throw: `Math.ceil` of `undefined`
division propagates silently into usage records and run-limit comparisons.

### 4.2 A shallow table freeze does not close it — CONFIRMED

`node shallow.mjs` — `Object.freeze(MODEL_FAMILY_TOKENS)` on the live module, then the same
nested write:

```text
table frozen? true | row frozen? false
after shallow freeze: row.charsPerToken = 99 (write landed: true)
estimate 370 chars: 4 (was 100)
```

The table-level freeze changes `Object.isFrozen` for the record and changes **nothing** about the nested
rows. This printed write is the reason Task 2's freeze is per-row plus table, and the reason its test must
fail when a per-row `Object.freeze` is deleted while the table-level one stays.

### 4.3 The per-row + table pattern closes it — CONFIRMED

`node deep.mjs` — the Task 2 pattern applied in-memory to the live module (each row frozen,
then the table), write attempted before any mutation:

```text
table frozen? true | anthropic row frozen? true
strict write threw=TypeError | Reflect.set=false | row={"charsPerToken":3.7,"perMessageOverhead":4,"confidence":"medium"}
estimate 370 chars: 100 (was 100)
whole-row replacement threw=TypeError | estimate still: 100
```

Vacuity control: the identical write against the unfrozen table lands and changes the estimate (§4.1), so
the `TypeError`/`Reflect.set === false`/unchanged estimate come from the freeze, not from the probe. This is
the behavior Task 2's `assert.throws` and `Reflect.set` cases pin.

### 4.4 The post-budget under-count, measured with a real session — CONFIRMED

Probe `under-count.mjs`: a real session with `AgentConfig.contextBudget:
{ maxInputTokens: 100_000, reportOmissions: true }`, two warm-up turns of generated filler (≈25k characters
each) to build history, then a final turn. The mutation case registers an `input_assembly` middleware that
appends one generated 8,000-character message — the stage runs after `applyContextBudget`
(`src/input.ts:L329–L338` → `:L340`). The control is the same session with the middleware removed. Printed
per case: `result.usage.inputTokens` (the reused `report.keptTokens`), the assembled request's own family
cost (`estimateMessageTokens(request.messages, model) + estimateRequestExtrasTokens(request.tools,
request.context, estimateTextTokensForFamily)`), and the assembled request measured on the report's own ÷4
basis (`measureInputCost` over the final request):

```text
middleware=true  | fallback estimate (report.keptTokens): 13659 | actual assembled request (family estimator): 16955 | shortfall: 13659 vs 16955 = 19.4% | assembled request on the report's own ÷4 basis: 15659 (12.8% short) | messages 6 | wall 1ms
middleware=false | fallback estimate (report.keptTokens): 13659 | actual assembled request (family estimator): 14788 | shortfall: 13659 vs 14788 = 7.6% | assembled request on the report's own ÷4 basis: 13659 (0.0% short) | messages 5 | wall 0ms
```

Reading the rows honestly:

- The **mutation** is the 8k append: `keptTokens` is identical (13659) in both cases because the budget
  pass ran before the middleware, while the request the provider saw grew by the appended message. On the
  family basis the shortfall is 19.4%, matching the plan's recorded 19.2% shape; on the report's own basis
  the appended text alone accounts for 12.8%.
- The **control** is the shipped drift test's 0% case (`src/__tests__/usage-estimation-exact.test.ts:L171`,
  "keptTokens is measureInputCost of the pre-eviction keep-set — zero drift by construction"): with no
  middleware, the final request measured on the report's own ÷4 basis equals `keptTokens` exactly.
- The remaining 7.6% in the control's family column is the **estimator basis**, not a mutation: the report
  was measured with the built-in ÷4 while the family table uses `anthropic` at 3.7 chars/token. It is
  present with or without the append and is not the gap this plan gates.

Gap shape, stated honestly: the report is measured before `input_assembly`/`prompt_build` middleware
(`src/input.ts:L340`, `:L370–L383`), tail segments (`:L360–L366`), and the prompt builder (`:L369–L397`),
so the caveat is real but only bites a host that mutates the request after the budget pass.
`docs/runs-and-usage.md:L97` already documents exactly that boundary. The measured 19.4% is the evidence
that would justify a request digest or a seam-side re-projection **if** a host reports the under-count; no
in-tree consumer does (§4.5), so the fix stays out of this plan (R5).

### 4.5 Demand evidence for the gated remainder — CONFIRMED

`rg -n` over `src packages scripts docs` (excluding `dist/` and `node_modules/`), then a barrel check. The
`scripts/budgets.json`/compat-baseline hits are the plan-103 T6 export-counter history and the generated
`.d.ts` compatibility listing — records, not consumers.

| Gated item | Grep | Consumers outside `src/context-budget.ts` | Conclusion |
| --- | --- | --- | --- |
| `estimateRequestExtrasTokens` | `rg -n estimateRequestExtrasTokens` | `src/agent-session/session/provider-round.ts:L7` (import), `:L197`, `:L202`; `src/__tests__/usage-estimation-exact.test.ts:L7`, `:L94` | One runtime consumer (the usage seam itself) + one plan-103 test. **No demand → stays recorded in plan 103**, no barrel promotion. |
| `resolveHostTokenEstimator` | `rg -n resolveHostTokenEstimator` | `src/agent-session/session/provider-round.ts:L9` (import), `:L191` | Exactly one user, the seam that replaced the plan-103 forked resolution. **No demand → stays recorded in plan 103**, no barrel promotion. |
| barrel references | `rg -n "estimateRequestExtrasTokens\|resolveHostTokenEstimator" src/index.ts` | **zero hits** (the planned expectation) | The public surface is unchanged today and Task 2 must not move it. |
| post-budget request-mutation detection (digest / seam-side re-projection) | `report.keptTokens` consumers; middleware-mutation tests | No host path appends after the budget pass in-tree; the only mutation is this probe | **No demand → stays recorded in plan 103**; the measured 19.4% is kept as the trigger evidence. |

### 4.6 Sibling exported tables — live frozen state

`node tables.mjs`, built root `dist/`:

```text
BUILT_IN_GUARDRAIL_PACK_IDS: frozen=false kind=array length=4
MODEL_INPUT_CAPABILITIES: frozen=false kind=array length=6
THINKING_LEVELS: frozen=false kind=array length=7
MODEL_FAMILY_TOKENS: frozen=false kind=object length=7
MODEL_FAMILY_TOKENS row frozen: anthropic=false openai=false google=false deepseek=false openrouter-generic=false mistral=false unknown=false
```

Every row's live frozen state is `false`, including all seven `MODEL_FAMILY_TOKENS` rows. Decision per row
is in §1.3: only `MODEL_FAMILY_TOKENS` is in scope for Task 2 because it is the one whose mutation silently
changes numeric accounting; the three `as const`/`readonly` arrays change validation outcomes and are
recorded as G7 instead of widening this plan.

### 4.7 Estimator literals Task 2 must pin, and the freeze's cost

`node literals.mjs` — the shipped `usage-estimation.test.ts` fixture strings, text-only
projection, per family:

```text
prose 232 chars | code 90 chars | cjk 39 chars
anthropic           prose=63 code=28 cjk=24
openai              prose=47 code=21 cjk=24
google              prose=60 code=27 cjk=24
deepseek            prose=62 code=27 cjk=24
openrouter-generic  prose=53 code=24 cjk=24
mistral             prose=60 code=27 cjk=24
unknown             prose=67 code=30 cjk=24
```

These are the pre-change literals Task 2 asserts after the freeze, so the freeze cannot be paired with an
accidental ratio edit.

`node timing.mjs`:

```text
import wall: 0.52ms | freeze 7 rows + table: 0.004ms | 370k-char estimate: 2.42ms (100000 tokens)
```

The freeze is O(7) row freezes at module load — 0.004 ms measured for the whole op, four orders of
magnitude below the import itself. The regression guard is the existing startup-ratio row
(`scripts/budget-gate.test.mjs:L263–L273`), so Task 2 adds no performance surface and no new benchmark.
Probe wall clock: freeze 4 ms end-to-end, shallow 5 ms, deep 4 ms, under-count 3 ms per session case,
sibling tables 30 ms, literals 24 ms (cold Node process each).

### 4.8 The duplication, printed — CONFIRMED

`docs/agent-events.md:L199–L206` (event reference — shape first):

```text
`provider_turn_finished.metadata.budgets` is an O(1) snapshot from the run limit tracker:
`{ inputTokens?, inputTokensSource?, inputCap?, runInputBudget?, runInputUsed, turns, maxTurns }` —
current-turn charged input tokens (provider-reported, or the labeled fallback estimate when the
provider reported none) against the resolved per-request input cap, cumulative run input against
`limits.maxInputTokens`, and provider turns against `limits.maxTurns` (`null` when disabled).
`inputTokensSource` is `"reported"` or `"estimated"` and is absent together with `inputTokens`.
Optional fields are absent when the provider reported no usage or no input cap can be derived; hosts
that ignore the fields are unaffected.
```

`docs/runs-and-usage.md:L87–L99` (the modes page — semantics first):

```text
`usageEstimation` is `"fallback"` (default), `"off"`, or `"strict"`. …
- … `budgets.inputTokensSource: "estimated"` labeling the figure (`"reported"` when the provider did report it) …
1. **The budget pass's own measurement.** … It is measured at budget time, so content added afterwards
   (tail segments, middleware edits) is not included …
2. **The host tokenizer.** … never `"reported"`.
3. **The family heuristic** (plan 091) …
```

Ownership after Task 3: the event page keeps the payload shape and one-line field meanings and links to
the runs-and-usage fallback section; the runs-and-usage page owns the provenance rules (the two values, the
absent-together rule, what produces each value, never-priced, `"off"`/`"strict"` unaffected) plus the caveat
carrying §4.4's number. `docs/execution-timeline.md:L148` keeps its pass-through mention because it explains
nothing the other two pages own.

---

## 5. Rejected alternatives (frozen)

Every item below is an option the plan's tasks considered and this review rejects, with the reason. None
may reappear as an implementation without a new review row.

| # | Rejected | Reason | Would have changed |
| --- | --- | --- | --- |
| R1 | `shallow freeze` only — `Object.freeze(MODEL_FAMILY_TOKENS)` without per-row calls | Measured writable rows and a landed write (§4.2); `Object.isFrozen(table)` becomes `true` while the accounting hazard stays live, which is worse than today because it looks fixed. | Task 2 |
| R2 | `typed readonly is enough` — rely on `Readonly<Record<…>>` / `readonly` fields | Type-only; the measured mutation happens through the runtime object in plain JS and through a cast in TS (§4.1). Plan 103 G11 was recorded for exactly this reason. | Task 2 |
| R3 | A `host-overridable ratio registry` or `setModelFamilyRatio` seam | Plan 103 R3 already rejected a mutable module-level table; a supported override is a new public API with its own calibration, concurrency, and provenance questions, and no host asked. A host with measured numbers passes `contextBudget.tokenEstimator` instead. | Task 2, plan 103 R3 |
| R4 | `barrel promotion without demand` — re-export `estimateRequestExtrasTokens`/`resolveHostTokenEstimator` from `src/index.ts` | Exactly one in-tree consumer each (the usage seam, §4.5), no host request; promotion would move the export ceiling and need a `package-truth --emit-docs` run for a helper nothing outside the package can use yet. | plan 103 R18 (stays recorded) |
| R5 | `request digest without demand` — detect or repair post-budget request mutations now (digest, or seam-side re-projection) | The gate is "if a real host reports it"; no in-tree consumer exists (§4.5), and the cheapest repair changes the public `ContextBudgetReport` shape. The measured 19.4% is recorded so the next reader starts from evidence. | plan 103 Further Actions item (stays recorded) |
| R6 | `freezing every exported table` — freeze the §1.3 arrays in the same task | Only `MODEL_FAMILY_TOKENS` feeds numeric accounting; the arrays change validation outcomes and would widen this plan's blast radius for a lower-severity class. Recorded as G7 instead. | Task 2 scope |
| R7 | Freeze lazily on first estimate | Makes the guarantee depend on call order and adds a branch to the hot path (`estimateTextTokensForFamily`, `src/usage-estimation.ts:L64–L75`); module-scope freeze costs 0.004 ms (§4.7). | Task 2 |
| R8 | A frozen as const literal plus a runtime assertion | Two mechanisms for one guarantee, and `as const` is still compile-time only; `Object.freeze` is the runtime one. | Task 2 |
| R9 | Make the table private and export a read-only accessor | Breaking export change for a hazard a freeze closes; the table's values are documented calibration evidence hosts are invited to read (`docs/runs-and-usage.md:L83`). | Task 2 |
| R10 | Skip the review and write Tasks 2–3 directly | Task 2 changes the runtime behavior of an exported table and Task 3 decides doc ownership from two conflicting passages; the reuse/gap/rejection rows and measured transcripts are what a later reader re-decides from. | Task 1 |
| R11 | One evidence file per task | One review owns the inventory and later tasks cite its rows, matching plans 102/103/104/108/109/110/111. | Task 1 |
| R12 | Register the gate block later | The gate precedes the code so the review cannot silently drift. | Task 1 |
| R13 | Move the whole `budgets` shape into runs-and-usage | The shape belongs to the event payload reference a `provider_turn_finished` consumer reads; what duplicates is the enum's *meaning*, not the shape. | Task 3 |
| R14 | Delete the agent-events enum wording and link without a summary | A reader of the event page must not have to leave it to learn the field's two values; one line stays. | Task 3 |
| R15 | A docs conformance test asserting the enum appears once | A test that greps prose is brittle; the plan-review gate's required tokens plus `dist/__tests__/docs.test.js` cover the structural risk. | Task 3 |
| R16 | Fold the `budgets` shape into a generated schema | Out of scope; the event page is hand-maintained by design and this task only removes the duplication. | Task 3 |

---

## 6. Security confirmations

- **A mutable ratio table is a safety issue, not a style one.** An under-counted input estimate is what
  `maxInputTokens`/`maxCost` are checked against: a nested `charsPerToken` write to 99 turns a 100-token
  estimate into 4 (§4.1), and replacing a row makes the figure `NaN`, so every comparison against a limit is
  false and a limited host can spend unnoticed. The unmutated table over-counts by design ("an
  overestimated context meter is safe while an underestimated one under-compacts",
  `src/usage-estimation.ts:L1–L13`), so the freeze removes write access and adds none — nothing a host could
  legitimately do today stops being possible, and no fail-closed path is weakened. `maxCost` keeps failing
  closed on unpriced estimates (`docs/runs-and-usage.md:L91`).
- **No new write surface.** Task 2 adds `Object.freeze` calls only: no setter, no registry, no accessor, no
  new export (`src/index.ts:L801` unchanged). Recalibration stays a source change plus the gated live leg
  (`docs/runs-and-usage.md:L83`), so there is no runtime override to authenticate or audit (R3).
- **No credential, request text, or host path in this evidence.** The probes print token counts, ratios,
  message counts, byte lengths, and timings; request text is generated filler and is never printed. The
  probe files live outside the tree and are not committed; the review cites relative `path:line` spans only.
- **The docs edit cannot weaken a fail-closed statement.** Task 3 moves wording ownership; the
  never-priced rule (`docs/runs-and-usage.md:L91`) and the `"strict"` refusal semantics (`:L93`) stay on the
  page that owns them, and the event page keeps stating that estimates are estimates.

---

## 7. Evidence-artifact scope

Read-only for the tree: this review adds no code and no docs navigation. `docs/index.md` is untouched
(evidence files are not navigation targets, `.agents/skills/create-plan/references/prism-wiki.md`). Tasks 2
and 3 must cite a row from §1/§3; any new primitive they need that is absent here is a review gap and must
be added to §2 before implementation. The gate entry `PLAN_112_TASK_1` in
`scripts/plan-review-gate.test.mjs` freezes this file's required tokens and rejected list.
