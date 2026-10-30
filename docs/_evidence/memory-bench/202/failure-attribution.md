# Task 4.4 failure attribution correction

Historical exploratory evidence only. This correction separates outcomes from causes and applies the unchanged 5% rule to product arms. It does not establish final lever decisions, acceptance, pilot readiness or permission to resume the broad baseline. Tasks 4.5–4.8 remain open.

Computed offline from the seven authoritative completed saved reports, selected by the existing widest-completed-attempt rule. The [machine-readable correction](failure-attribution.json) records every source file SHA-256, per-stage question ids, eligible suite/model/arm decisions, denominators, provenance, coverage and overlap. Scores, original reports, archived bytes and the criteria file are unchanged. No dataset text, model call or held-out inspection was needed.

Observed run limits remain end-to-end failures in each denominator. The Beam preset has 8/26 failed questions limited; MiniMax has 1/23. They are not abstention or retrieval diagnoses. Transport/setup errors, invalid comparators, unknown evidence and judged incorrect answers have separate stage buckets.

## Product attribution coverage

Only `fabric-x` and `fabric-x-tools` can nominate product levers. All failures are unique within suite × model × arm. Coverage is attributed causes / all failures; operational outcomes do not imply an attributed cause. All cells below are BEAM-100K.

| Model | Arm | All failures | Attributed heuristics | Unknown | Operational | Coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| opencode-go/beam-free | fabric-x | 31 | 6 | 25 | 0 | 19.4% |
| opencode-go/beam-free | fabric-x-tools | 26 | 2 | 16 | 8 | 7.7% |
| opencode-go/minimax-m3 | fabric-x | 26 | 3 | 23 | 0 | 11.5% |
| opencode-go/minimax-m3 | fabric-x-tools | 23 | 4 | 18 | 1 | 17.4% |

## Candidate screening

| Task | Unique candidate questions | Arm occurrences | Shared across product arms | Screen |
| --- | ---: | ---: | ---: | --- |
| 9 | 6 | 9 | 3 | needed |
| 5 | 4 | 6 | 2 | needed |
| 6 | 0 | 0 | 0 | unmeasurable |
| 7 | 0 | 0 | 0 | unmeasurable |
| 8 | 0 | 0 | 0 | insufficient-evidence |
| 10 | 0 | 0 | 0 | unmeasurable |
| 13 | 0 | 0 | 0 | insufficient-evidence |
| 16 | 0 | 0 | 0 | unmeasurable |
| 17 | 0 | 0 | 0 | unmeasurable |

Unique candidates use suite/model/question keys; the same question on different answer models remains a different model-specific failure. Occurrences count distinct eligible arms, and shared counts identify questions appearing in both arms. Counts can overlap between levers and are never summed as unique recoveries. A stage nominates a candidate lever, not a causal claim that the task will recover that question.

The historical reports predate Task 4.1’s validated BEAM mapping and retain only stage diagnoses and recalled ids, without compatible stage-count/protocol provenance. This correction deliberately does not invent corrected source labels or delivery measurements. Their causes are `historical_heuristic`; only observed outcomes and product eligibility are repaired here. The `needed` screens for Tasks 5 and 9 are provisional historical nominations. They do not authorize final corrected-protocol decisions. New run-path evidence records validated source-label provenance and unresolved-reference counts, and an unresolved label stays unknown.

Tasks 8 and 13 have insufficient evidence; stages never emitted remain unmeasurable. Unknown, operational or missing stage measurements cannot close a lever. New reports can close a lever below 5% only when attribution is complete and its target stages were measured. The original historical lever table in [the baseline README](baseline/README.md) is superseded by this correction; the broad baseline remains paused.
