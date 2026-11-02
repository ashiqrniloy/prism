# Plan 202 closure and Plan 210 handoff

**Closed by owner disposition, 2026-11-02.** Owner instruction: “Okay. Then close 202 and do the recommended”. This closes execution of plan 202 and transfers outstanding measurements; it does not certify its unmet targets. Continue with **207 → 208 → 209 → 210**.

The accepted Muse screen remains 23 cells, `baselineComplete: false`. Task 5's development-screen verdict remains `miss`. Task 17 remains unmeasured and is deferred without implementation; F4 is unresolved. No facts preset, preset revision, default or published quality claim changes. The historical reports, criteria, partitions, reservations and owner gates are preserved. Earlier notes saying a parent task remains open describe its status before this disposition.

## Transferred work

Plan 210 Task 1 must import every row below, pin its evidence hashes and give each feature an explicit status. A missing measurement stays `unmeasured`; a screen miss is not automatically a statistically significant negative effect. Tasks 2–5 diagnose and measure on development partitions before Task 8 freezes the product. Task 9 supplies the independent held-out verdict and Task 10 owns defaults and claims.

| Source task | Evidence and limitation | Required owner in Plan 210 |
| --- | --- | --- |
| 4: broad baseline / measurement | [Accepted screen](muse13-screen-final/README.md), [corrected attribution](failure-attribution.md), [diagnosis](diagnosis-2026-10-30/README.md). One-model screen only; missing stage attribution, incomplete usage and no human calibration. Cache equivalence [differs](cache-stability/README.md); pre-change fabric arms cannot be mixed with current arms. | Tasks 1/3/5: fresh, compatible paired development bases and residual attribution where needed; retain historical debt and missing-cost flags. Task 9: original multi-model, cross-provider, repeat and frozen robustness requirements. No automatic restart of the obsolete 75-cell campaign. |
| 5: enrichment and navigation | [Screen miss](task5/development-screen-verdict.md), [full manifest](task5/development-comparison-manifest.json). Halving missed in every measurable suite, descriptive ability regressions; MAB fine recall inconclusive. | Existing Tasks 1/5/9 handoff remains mandatory: full LongMemEval-M and BEAM-1M cohorts, separate enrichment/navigation ablations, frozen candidate-gap rules and ability veto. |
| 6: timeline | [Free diagnostic](task6/README.md) is one-model evidence, not the baseline-model/multi-model target. | Tasks 1/5: temporal strata and applicable baseline-model comparisons; Task 9: frozen temporal acceptance. |
| 7: state grouping / opt-in wrapper | Functional tests only; provisional exchange subject Dice floor 0.5. StateMemBench was unavailable; no measured state-drift halving or knowledge-update non-regression. | Tasks 1/3/5: calibrate grouping, separately cost the wrapper and diagnose residual state failures; explicitly record unavailable dataset coverage. |
| 8: passive delivery | Functional tests only; 0.2/0.35 tuning floors lack a development benefit row. | Tasks 1/5: irrelevant rate ≤0.40, injected tokens −50%, 2-point non-inferiority and small-model no-harm. |
| 9: aggregation / abstention | Functional tests only; no measured answer-gap −40% or abstention ≥full. | Tasks 1/3/5: target metrics and residual attribution with actual delivered evidence and read-time/oracle controls. |
| 10: weak-tool-caller adaptation | Functional tests only; fresh one-question benchmark sessions do not exercise its two-turn trigger. | Tasks 2/5: realistic multi-turn weak-caller probe, small-model ≥passive and within 5 points of full, strong-model 2-point no-harm and run-limit share. |
| 11: coding decisions | Functional tests and cue timing; no model-run 12-persona/MemoryCode/VibeMemBench target. | Tasks 1/5: coding benefit and superseded-rule exposure; Plan 209 generalizes the existing rules module and measures work outcomes. Task 9: coding acceptance and licensed-suite availability. |
| 12: decision gates P1–P7 | [Evidence status](decisions/README.md): synthetic fixture only, no point passed its live bench; thresholds provisional. | Tasks 1–5: each point separately, per-point accuracy/ECE/order-flip/latency/cost, calibration, end-to-end no-harm and trust-scan recall. Do not treat opt-in implementation as evidence that a point earned inclusion. |
| 13: typed-link association | [Closed without implementation](task13/README.md); causal association attribution insufficient. | Tasks 1/3: retain the unbuilt-lever disposition separately from existing links; reconsider only on complete ≥5% shared-entity/not-in-query residual attribution. No graph-store work. |
| 14: safety | [Offline pass](safety.md), deterministic follower mock; no real-model MINJA confirmation or ontology probes yet. | Plan 208 supplies ontology probes; Plan 210 Tasks 5/9 confirm agentic poisoning and rerun safety on the final product before any default promotion. |
| 15: growth and scale | [Growth](growth.md), [stress](growth-stress.md), [store scale](exchange-scale.md). Offline retrieval, not generated-answer accuracy; hardware-specific performance. | Tasks 1/5: retain measured capacity/cost role with scope; Task 9: final-product growth criterion and model-answer confirmation. |
| 16: OM and promotion | [Role](observational/role.md), [cost](observational/cost.md), [completion smoke](observational/arms.md). Synthetic role comparison; zero later cited promoted notes; six one-question live arms prove completion only. | Tasks 1–5: promotion is neutral/unjustified on this evidence, with cost and applicability separate; full development QA and live promotion benefit if pursued. Task 9: final quality acceptance. Promotion stays off. |
| 17: facts / F4 | [Attribution](failure-attribution.json) and [accepted screen](muse13-screen-final/summary.json): all 14 Task 17 cell flags `measured: false`. No causal residual evidence from Tasks 7/9. | Tasks 1/3/5 explicitly own the deferred prerequisite diagnosis. Facts are unbuilt, not a removable installed feature. Apply the conditional procedure below. |

## Conditional fact extraction, before held-out access

Plan 210 Task 3 specifies the diagnosis and inspects available development traces; if new model evidence is required, Task 5 first runs a pre-registered diagnostic leg under C-1 and updates the gap analysis before any build. Diagnose aggregation/state failures after read-time fixes using valid ingestion, actual delivered evidence, oracle/read-time controls, unique failed-question denominators and source/protocol hashes. Missing attribution never counts as zero. A generic answer gap, an ability label or a retrieval miss cannot justify extraction.

If complete target attribution is below 5%, record `not-needed` and close F4's proposed remedy without claiming the existing extractor became reliable. If a suite × model attributes ≥5% of development failures to state/aggregation those controls cannot recover, Plan 210 may execute the original scoped Task 17 remedy before its freeze: minimal extraction repair in fabric consolidation, citations to exchanges, inherited scope/consent, and a separately named opt-in `conversational-facts` preset. No kernel change, dependency or change to `conversational` is authorized. Write the original Task 17 regression tests first and update all affected config/exports/compat baselines/docs in that task.

Task 4's cleanup criteria and gate C-1 must pre-register this conditional add-one arm before its calls. Acceptance remains ≤2% session consolidation failures on development partitions, measured cheap-model write cost per session and per 1k exchanges, `product-extract` cache-read/write tokens and cost with/without cache reads, target-ability benefit without regression, provenance and scope/consent safety. If attribution stays incomplete, record `unmeasured` and leave the preset unbuilt. Task 6 must record a disposition; no automatic promotion or claim of F4 resolution. All diagnosis/tuning precedes Task 9's held-out read; held-out results never open this build condition.

## Closure verification

[Machine-readable closure verification](closure-verification.json) records commands, exit codes and log hashes. This is a documentation-only closure check, not a passing product-acceptance or release verdict.

| Check | Fresh result |
| --- | --- |
| Build and repository typecheck | Pass |
| Fabric | 585 pass / 29 PostgreSQL skips / 0 fail on isolated rerun; initial concurrent run had one enrichment timing failure |
| Memory core / observational | 63 / 101 pass, zero failures |
| Prefix stability / offline prefix probe | 24 pass; seven probe scenarios have one prefix per epoch except the two retraction scenarios; zero network calls |
| Offline benchmark / long-term-memory example | Pass; 14 synthetic questions / cross-session recall and isolation |
| Docs | 65 pass / 0 fail |
| Whole memory benchmark | 416 pass / 3 skip / 1 fail / 1 error: Task 5 manifest refuses the existing dirty candidate product |
| Reference host | 54 pass / 1 fail: after-forget assertion matches the query echoed by the no-match result, already noted in Task 11 |
| Release gate | Fails: missing Ollama Cloud compat baseline, changed Kilo exports, kernel packed/unpacked bytes, file-count, root-export and source-line budgets |
| Closure consistency | All parent dispositions explicit, Plan 210 owns all handoff rows and F4, evidence links resolve, backlog entries unique, `git diff --check` passes |

No runtime code, budgets or compatibility baselines were changed during closure. The memory harness/host failures belong to Plan 210's verification prerequisites; provider baseline and kernel budget failures remain release-path work before plans 185/186 certify the surface. Closure is by the owner's explicit disposition with these blockers recorded, not a claim that the tree is green.

Historical equivalence replay, local/hosted decision inference, live model screens and large safety/growth/scale campaigns were not repeated for a documentation change. Existing scoped evidence is preserved and Plan 210 owns final-product measurements. No held-out item was read, no model campaign was started, and no owned check process remains.
