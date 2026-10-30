# Muse 1.3 development screen — closed with 23 accepted cells

Closed: 2026-10-30T00:06:17.169Z. Owner accepted all 23 completed cells of the original 25-cell design. No further live requests are authorized by this closure.

## Coverage and exclusions

All five suites are represented. BEAM-100K, LoCoMo, MemoryAgentBench-CR and LongMemEval-M have five completed configurations each; BEAM-1M has three. The 15 partial BEAM-1M full-truncated rows are preserved but excluded from every metric and comparison. BEAM-1M lexical-topk never started. Exclusions were caused by the weekly quota; selection uses completion status, not accuracy.

The accepted 23-cell scope is complete. The original 25-cell design and deferred multi-model Task 4 baseline are not complete. Task 18 criteria are unchanged.

## Descriptive binary accuracy

Binary accuracy is secondary for BEAM rubric abilities; registered graded scores, confidence intervals, paired cluster analysis and Holm corrections are preserved in summary.json. Parentheses give scored sample size. No pooled accuracy is reported.

| Suite | Preset r1 | Passive | Full-history reference | Lexical |
|---|---:|---:|---|---:|
| beam-100k | 32.5% (40) | 30.0% (40) | 32.5% (40) | 27.5% (40) |
| locomo | 65.0% (60) | 56.7% (60) | 76.7% (60) | 51.7% (60) |
| memoryagentbench-cr | 0.0% (20) | 0.0% (20) | 20.0% (20) | 20.0% (20) |
| longmemeval-m | 70.0% (50) | 60.0% (50) | Only 4/50 eligible; no suite-wide comparison | 58.0% (50) |
| beam-1m | 35.0% (40) | 32.5% (40) | Only 9/40 eligible; no suite-wide comparison | Excluded |

## Interpretation and limits

Full-history comparisons are valid across the complete selected draw only for BEAM-100K, LoCoMo and MemoryAgentBench-CR. LongMemEval-M has 4/50 eligible full histories, BEAM-1M 9/40. LongMemEval-M retains its separate bounded comparator; BEAM-1M lacks both bounded-comparator and lexical completion. Missing comparisons remain unavailable. Full-truncated repeats on fitting histories are not independent treatments.

The registered screen flags Tasks 5, 8, 9 and 13 for investigation. Tasks 6, 7, 10, 16 and 17 remain unmeasurable; no missing measurement closes a lever. These are single-model development priorities, not final cross-model lever decisions. Small BEAM rubric samples remain non-discriminating. The LongMemEval-M preset-minus-bounded-context difference is +8 percentage points (95% CI -8 to +24); it does not establish superiority.

## Accounting and provenance

Retained journal charge: 668,089,833 tokens against the unchanged 2B ceiling. This includes historical debt and conservative reservations, not measured token consumption or a dollar bill. No refunds. Two completed cells (LoCoMo preset-r1 and LongMemEval-M full-truncated) have incomplete usage, so their reservations remain held and complete cost claims are unavailable.

manifest.json pins all 23 report files, original design, frozen analysis protocol and source journal by hash. Closure proof verifies report identity, exact completed-cell coverage and unchanged registered statistics. Original attempt/report files and the uncompleted-cell evidence remain preserved. Human calibration remains owner-waived. No model call, source/gold/answer/judge text publication, public API change or held-out evaluation occurs.
