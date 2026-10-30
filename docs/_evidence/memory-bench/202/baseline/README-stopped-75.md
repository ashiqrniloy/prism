# Plan 202 Task 4 baseline

Status: stopped-by-owner

Coverage: 3/75 selected cells completed. Screen complete: false. Full baseline complete: false.

Gate 1: Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)

Compute: paid via commandcode; 192322068 tokens; $23.434319 list-price equivalent. Muse BEAM-100K pilot extrapolation only, not a bound for other suites/models; excludes unknown usage, failed attempts, quota waits and larger-store ingestion. Owner authorized only the named Muse paid route; per-cell and aggregate bounds remain hard stops.

Complete-history comparator gaps require explicit eligibility for every question. Equivalent rendered contexts are repeats, not independent treatments.
beam-100k / commandcode/meta/muse-spark-1.2-contributor / full: 40/40 scored questions prove complete history; 0 ineligible, 0 unscored.

| Suite | Model | Arm | n | Accuracy | 95% CI | Campaign cost USD | Product measured/cold/warm USD | Evaluation USD | Answer p50/p95/mean (s) | Ingestion p50/p95/mean (s) | Evaluation p50/p95/mean (s) | Failures by stage |
| --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 40 | 0.300 | 0.190–0.417 | 0.0472 | 0.0308/0.0308/0.0308 | 0.0164 | 6.0/11.7/6.8 | 0.2/0.3/0.2 | 4.1/19.5/9.2 | abstention_error 2, answer_gap 1, partial_evidence 9, candidate_gap 15, run_limit 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 40 | 0.425 | 0.279–0.600 | 0.1920 | 0.1762/0.1762/0.1762 | 0.0159 | 8.2/28.2/12.7 | 0.2/0.3/0.2 | 4.3/26.8/8.6 | abstention_error 2, answer_gap 2, partial_evidence 11, run_limit 3, candidate_gap 5 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | 40 | 0.450 | 0.308–0.581 | 0.5515 | 0.5340/0.5340/0.0202 | 0.0175 | 8.9/14.6/9.6 | 0.0/0.0/0.0 | 4.5/27.9/8.4 | abstention_error 1, candidate_gap 21 |

| Suite | Model | Arm | Ability | n | Binary accuracy | Graded primary (n) | Failures |
| --- | --- | --- | --- | ---: | ---: | --- | ---: |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | abstention | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | event_ordering | 4 | 0.000 | 0.072 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | instruction_following | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | knowledge_update | 4 | 0.250 | n/a | 3 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | summarization | 4 | 0.000 | 0.200 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | temporal_reasoning | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | abstention | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | event_ordering | 4 | 0.000 | 0.195 (3) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | information_extraction | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | instruction_following | 4 | 1.000 | n/a | 0 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | knowledge_update | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | summarization | 4 | 0.000 | 0.337 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | temporal_reasoning | 4 | 1.000 | n/a | 0 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | abstention | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | event_ordering | 4 | 0.000 | 0.283 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | information_extraction | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | instruction_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | knowledge_update | 4 | 1.000 | n/a | 0 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | summarization | 4 | 0.000 | 0.525 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | full | temporal_reasoning | 4 | 1.000 | n/a | 0 |


descriptive only; item-weighted paired differences, whole-conversation bootstrap 95% CIs; marginal CI overlap is not a test
Holm across every emitted overall, ability-binary and ability-graded test in this summary; CIs are pointwise, no acceptance verdict
| Suite | Model | Arm | Comparator | Paired gap / 95% CI | Wins / losses | Independent clusters | Holm p / status |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | full | -0.025 / -0.163..0.118 | 3 / 4 | 18 | 1 / paired-descriptive |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | full | -0.150 / -0.261..-0.048 | 1 / 7 | 18 | 1 / paired-descriptive |

| Suite | Model | Arm / comparator | Ability | Score | Paired difference / 95% CI | Wins / losses | Clusters | Holm p |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | abstention | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | event_ordering | graded | -0.137 / -0.375..0.002 | 1 / 3 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | information_extraction | binary | 0.000 / -1.000..0.500 | 1 / 1 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | instruction_following | binary | 0.500 / 0.000..1.000 | 2 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | knowledge_update | binary | -0.500 / -1.000..0.000 | 0 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | summarization | graded | -0.188 / -0.475..0.100 | 2 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools / full | temporal_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | abstention | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | event_ordering | graded | -0.211 / -0.241..-0.178 | 0 / 4 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | information_extraction | binary | -0.250 / -1.000..0.000 | 0 / 1 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | instruction_following | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | knowledge_update | binary | -0.750 / -1.000..-0.250 | 0 / 3 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | summarization | graded | -0.325 / -0.550..-0.100 | 0 / 4 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x / full | temporal_reasoning | binary | -0.500 / -1.000..0.000 | 0 / 2 | 4 | 1 |

Stages identify candidate levers, not promised recoveries. Only product arms are eligible; failures shared across arms are counted once per suite/model/question. The JSON screeningLimits disclose rubric abilities that cannot support a lever-effect decision; stage-based needed is only a descriptive candidate flag.

| Lever task | Target stages | Unique candidate questions | Arm occurrences | Shared across arms | Best share | Decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5 | candidate_gap | 15 | 20 | 5 | 53.6% | needed |
| 8 | partial_evidence | 14 | 20 | 6 | 47.8% | needed |
| 9 | answer_gap, abstention_error | 4 | 7 | 3 | 17.4% | needed |
| 6 | temporal_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 7 | supersession_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 10 | tool_protocol_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 13 | fine_selection_gap | 0 | 0 | 0 | 0.0% | insufficient-evidence |
| 16 | capacity_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 17 | extraction_gap | 0 | 0 | 0 | 0.0% | unmeasurable |

| Task | Suite | Model | Eligible arm | Candidate failures / all failures | Share | Attributed / unknown / operational / invalid | Coverage | Provenance |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| 5 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 5/23 | 21.7% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 5 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 15/28 | 53.6% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 8 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 11/23 | 47.8% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 8 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 9/28 | 32.1% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 9 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 4/23 | 17.4% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 9 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 3/28 | 10.7% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 6 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 6 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 7 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 7 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 10 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 10 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 13 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 13 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 16 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 16 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
| 17 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x-tools | 0/23 | 0.0% | 20/0/3/0 | 87.0% | {"source_chat_ids":20,"outcome":3} |
| 17 | beam-100k | commandcode/meta/muse-spark-1.2-contributor | fabric-x | 0/28 | 0.0% | 27/0/1/0 | 96.4% | {"source_chat_ids":27,"outcome":1} |
