# Plan 202 Task 4.6: paired analysis and prospective sizing

Task 18 3-point non-inferiority remains unresolved at the frozen supply under every declared sensitivity scenario; both audited rubric abilities are not lever-discriminating at this sample.

## Registered analysis

unique question ids, matching conversation clusters and abilities; incomplete comparisons have no gap
item-weighted paired mean; 10000 whole-cluster bootstrap draws; two-sided cluster sign-flips; seed 7
Holm across all emitted overall, ability-binary and ability-graded tests in one baseline summary; pointwise CIs; descriptive only

Task 4 is descriptive screening. BEAM ordering/summarization use the registered graded primary and binary secondary. Oracle rows only inform sizing and never enter product comparisons or lever rankings. Overlapping marginal CIs are not a significance test.

Task 18 keeps binary scoring and the 0.03 margin. H0: candidate minus comparator <= -0.03; alternative difference 0; one-sided alpha .025 (95% two-sided lower bound), target power .8. BFC requires all registered rows to pass (intersection-union); this does not authorize cherry-picked per-row claims. No margin or metric amendment.

Sizing uses Var(paired binary difference)=q-delta² and N_eff=N²/[(1-rho)N+rho*sum(cluster_size²)]. Power is Phi((delta+.03)*sqrt(N_eff/(q-delta²))-z_.975). Required cluster supply scales the current size distribution. q=.10/.25/.50 and paired-difference ICC rho=0/.5/1 are assumptions, not fitted evidence. At one question per cluster these require 873/2181/4361 clusters respectively. These are optimistic normal planning approximations, never a universal paired sample size; few-cluster CI coverage needs verification before acceptance.

## Frozen independent supply (metadata only)

| Suite | Partition | Questions | Conversations | Supply qualification |
| --- | --- | ---: | ---: | --- |
| beam-100k | dev | 40 | 18 | conversation key from frozen id metadata; no held-out text read |
| beam-100k | heldout-a | 20 | 14 | conversation key from frozen id metadata; no held-out text read |
| beam-100k | heldout-b | 20 | 12 | conversation key from frozen id metadata; no held-out text read |
| locomo | dev | 60 | 9 | conversation key from frozen id metadata; no held-out text read |
| locomo | heldout-a | 30 | 9 | conversation key from frozen id metadata; no held-out text read |
| locomo | heldout-b | 30 | 9 | conversation key from frozen id metadata; no held-out text read |
| memoryagentbench-cr | dev | 20 | 7 | conversation key from frozen id metadata; no held-out text read |
| memoryagentbench-cr | heldout-a | 10 | 7 | conversation key from frozen id metadata; no held-out text read |
| memoryagentbench-cr | heldout-b | 10 | 6 | conversation key from frozen id metadata; no held-out text read |
| longmemeval-m | dev | 50 | 50 | optimistic upper bound; verify haystack clusters before acceptance |
| longmemeval-m | heldout-a | 25 | 25 | optimistic upper bound; verify haystack clusters before acceptance |
| longmemeval-m | heldout-b | 25 | 25 | optimistic upper bound; verify haystack clusters before acceptance |
| beam-1m | dev | 40 | 24 | conversation key from frozen id metadata; no held-out text read |
| beam-1m | heldout-a | 20 | 15 | conversation key from frozen id metadata; no held-out text read |
| beam-1m | heldout-b | 20 | 16 | conversation key from frozen id metadata; no held-out text read |

More questions, repeated answers and extra models on the same histories are not independent conversations. Partitions can share conversation keys: disjoint question ids do not imply a conversation-disjoint split. The existing draws stay frozen; this limits generalization. LongMemEval-M counts are upper bounds until its haystack hashes are checked; beyond-window rows are not the in-window NI claim.

## Prospective Task 18 non-inferiority sensitivity (heldout-a)

| Suite | Discordance | ICC | Effective pairs | Power | Required conversations | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| beam-100k | 0.1 | 0 | 20.00 | 0.0623 | 611 | claim unresolved |
| beam-100k | 0.1 | 0.5 | 15.38 | 0.0562 | 794 | claim unresolved |
| beam-100k | 0.1 | 1 | 12.50 | 0.0521 | 977 | claim unresolved |
| beam-100k | 0.25 | 0 | 20.00 | 0.0454 | 1527 | claim unresolved |
| beam-100k | 0.25 | 0.5 | 15.38 | 0.0423 | 1985 | claim unresolved |
| beam-100k | 0.25 | 1 | 12.50 | 0.0402 | 2442 | claim unresolved |
| beam-100k | 0.5 | 0 | 20.00 | 0.0383 | 3053 | claim unresolved |
| beam-100k | 0.5 | 0.5 | 15.38 | 0.0364 | 3969 | claim unresolved |
| beam-100k | 0.5 | 1 | 12.50 | 0.0352 | 4884 | claim unresolved |
| locomo | 0.1 | 0 | 30.00 | 0.0749 | 262 | claim unresolved |
| locomo | 0.1 | 0.5 | 12.33 | 0.0519 | 637 | claim unresolved |
| locomo | 0.1 | 1 | 7.76 | 0.0450 | 1012 | claim unresolved |
| locomo | 0.25 | 0 | 30.00 | 0.0514 | 655 | claim unresolved |
| locomo | 0.25 | 0.5 | 12.33 | 0.0401 | 1592 | claim unresolved |
| locomo | 0.25 | 1 | 7.76 | 0.0365 | 2530 | claim unresolved |
| locomo | 0.5 | 0 | 30.00 | 0.0420 | 1309 | claim unresolved |
| locomo | 0.5 | 0.5 | 12.33 | 0.0351 | 3184 | claim unresolved |
| locomo | 0.5 | 1 | 7.76 | 0.0328 | 5059 | claim unresolved |
| memoryagentbench-cr | 0.1 | 0 | 10.00 | 0.0485 | 611 | claim unresolved |
| memoryagentbench-cr | 0.1 | 0.5 | 7.69 | 0.0449 | 794 | claim unresolved |
| memoryagentbench-cr | 0.1 | 1 | 6.25 | 0.0425 | 977 | claim unresolved |
| memoryagentbench-cr | 0.25 | 0 | 10.00 | 0.0383 | 1527 | claim unresolved |
| memoryagentbench-cr | 0.25 | 0.5 | 7.69 | 0.0364 | 1985 | claim unresolved |
| memoryagentbench-cr | 0.25 | 1 | 6.25 | 0.0352 | 2442 | claim unresolved |
| memoryagentbench-cr | 0.5 | 0 | 10.00 | 0.0339 | 3053 | claim unresolved |
| memoryagentbench-cr | 0.5 | 0.5 | 7.69 | 0.0327 | 3969 | claim unresolved |
| memoryagentbench-cr | 0.5 | 1 | 6.25 | 0.0319 | 4884 | claim unresolved |

## Graded ability ceiling and screening resolution

| Ability | Score | Baseline | Oracle ceiling | Headroom | Conversations | SD assumption | Normal MDE | Exact minimum p | Discrimination |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| event_ordering | graded primary | 0.1873 | 0.8988 | 0.7115 | 3 | 0.250 | 0.429 | 0.25 | not lever-discriminating at this sample |
| event_ordering | graded primary | 0.1873 | 0.8988 | 0.7115 | 3 | 0.500 | 0.858 | 0.25 | not lever-discriminating at this sample |
| event_ordering | graded primary | 0.1873 | 0.8988 | 0.7115 | 3 | 1.000 | 1.716 | 0.25 | not lever-discriminating at this sample |
| event_ordering | binary secondary q=0.1 | 0.0000 | 0.0000 | 0.0000 | 3 | 0.316 | 0.543 | 0.25 | not lever-discriminating at this sample |
| event_ordering | binary secondary q=0.25 | 0.0000 | 0.0000 | 0.0000 | 3 | 0.500 | 0.858 | 0.25 | not lever-discriminating at this sample |
| event_ordering | binary secondary q=0.5 | 0.0000 | 0.0000 | 0.0000 | 3 | 0.707 | 1.213 | 0.25 | not lever-discriminating at this sample |
| summarization | graded primary | 0.3750 | 0.8375 | 0.4625 | 4 | 0.250 | 0.350 | 0.125 | not lever-discriminating at this sample |
| summarization | graded primary | 0.3750 | 0.8375 | 0.4625 | 4 | 0.500 | 0.700 | 0.125 | not lever-discriminating at this sample |
| summarization | graded primary | 0.3750 | 0.8375 | 0.4625 | 4 | 1.000 | 1.401 | 0.125 | not lever-discriminating at this sample |
| summarization | binary secondary q=0.1 | 0.0000 | 0.5000 | 0.5000 | 4 | 0.316 | 0.443 | 0.125 | not lever-discriminating at this sample |
| summarization | binary secondary q=0.25 | 0.0000 | 0.5000 | 0.5000 | 4 | 0.500 | 0.700 | 0.125 | not lever-discriminating at this sample |
| summarization | binary secondary q=0.5 | 0.0000 | 0.5000 | 0.5000 | 4 | 0.707 | 0.991 | 0.125 | not lever-discriminating at this sample |

Normal MDE=(z_.975+z_.8)*paired_SD/sqrt(N_eff), ICC=1; SD=.25/.5/1 is sensitivity, not an estimate from four answers. With 3/4 clusters, the smallest two-sided sign-flip p is .25/.125 even for a perfect lever: **no finite detectable difference** at .05 (JSON minimumDetectableDifference=null). Holm can only reduce resolution. These abilities cannot silently open or close levers; descriptive scores and failure-stage evidence remain reportable.

## Provenance and next boundary

Protocol hash: 14c3e37cd51d56da2654f2474bed580af0f8b7469ab3d11029659bdcd97c046c. Criteria hash: dd1add49cd1d4f023c8ecf027145ac69d10d764137db87cb015166bd80e80ea7. JSON pins analysis source, dataset bytes/draws, adapter normalization, binary/graded judges, context policy and current product. New run/checkpoint fingerprints include the analysis revision and graded template; historical cells cannot be reused as current evidence.

This prospective protocol is a prerequisite, not a resumed campaign manifest. Task 4.7 must name its answer model/configuration and panel; Task 4.8 must reconcile live limits and readiness, refresh hashes and freeze the executable manifest before broad resumption. Task 4 remains unchecked.

Reproduce locally: `timeout 60 bun scripts/memory-bench/paired-sizing.mjs`. Only frozen ids, counts, scores and source hashes are read; no held-out text or model calls. Existing audit is model-assisted and does not meet human calibration.
