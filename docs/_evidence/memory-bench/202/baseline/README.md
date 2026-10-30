**Owner-accepted screen is closed with 23 completed cells.** See the [final accepted report](../muse13-screen-final/README.md) and [validation](../muse13-screen-final/validation.json). The coverage below deliberately retains the original 25-cell denominator; it does not undo the separate accepted 23-cell scope. Partial BEAM-1M full-truncated data is excluded and lexical-topk is absent. The full multi-model Task 4 remains deferred; no further run is active.

# Plan 202 Task 4 baseline

Status: closed-by-owner

Coverage: 23/25 selected cells completed. Screen complete: false. Full baseline complete: false.

Gate 1: Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)

Compute: paid via commandcode; 64107356 tokens; $6.827977000000002 list-price equivalent. Muse BEAM-100K pilot extrapolation only, not a bound for other suites; excludes unknown usage, failed attempts, quota waits and larger-store ingestion. Only Muse 1.3 and the named judges are active; per-cell and aggregate bounds remain hard stops.

Some retained cells have incomplete usage. Their original reservations remain charged; measured token totals are lower bounds. See summary.json and the journal.

Complete-history comparator gaps require explicit eligibility for every question. Equivalent rendered contexts are repeats, not independent treatments.
beam-100k / commandcode/meta/muse-spark-1.3-contributor / full: 40/40 scored questions prove complete history; 0 ineligible, 0 unscored.
beam-100k / commandcode/meta/muse-spark-1.3-contributor / full-truncated: repeat of full.
beam-1m / commandcode/meta/muse-spark-1.3-contributor / full: 9/9 scored questions prove complete history; 31 ineligible, 31 unscored.
locomo / commandcode/meta/muse-spark-1.3-contributor / full: 60/60 scored questions prove complete history; 0 ineligible, 0 unscored.
locomo / commandcode/meta/muse-spark-1.3-contributor / full-truncated: repeat of full.
longmemeval-m / commandcode/meta/muse-spark-1.3-contributor / full: 4/4 scored questions prove complete history; 46 ineligible, 46 unscored.
memoryagentbench-cr / commandcode/meta/muse-spark-1.3-contributor / full: 20/20 scored questions prove complete history; 0 ineligible, 0 unscored.
memoryagentbench-cr / commandcode/meta/muse-spark-1.3-contributor / full-truncated: repeat of full.

| Suite | Model | Arm | n | Accuracy | 95% CI | Campaign cost USD | Product measured/cold/warm USD | Evaluation USD | Answer p50/p95/mean (s) | Ingestion p50/p95/mean (s) | Evaluation p50/p95/mean (s) | Failures by stage |
| --- | --- | --- | ---: | ---: | --- | ---: | --- | ---: | --- | --- | --- | --- |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 40 | 0.300 | 0.190–0.417 | 0.0334 | 0.0223/0.0223/0.0223 | 0.0112 | 10.1/26.5/11.7 | 0.2/0.3/0.2 | 3.9/20.2/6.8 | abstention_error 2, answer_gap 1, partial_evidence 9, candidate_gap 16 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 40 | 0.325 | 0.178–0.500 | 0.1356 | 0.1118/0.1118/0.1118 | 0.0238 | 13.1/45.6/18.8 | 0.2/0.3/0.2 | 4.0/36.0/11.8 | abstention_error 3, answer_gap 3, partial_evidence 9, candidate_gap 11, run_limit 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | 40 | 0.325 | 0.196–0.471 | 0.5676 | 0.5510/0.5510/0.0227 | 0.0166 | 16.4/31.1/17.8 | 0.0/0.0/0.0 | 3.6/23.0/7.4 | abstention_error 2, candidate_gap 25 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | 40 | 0.350 | 0.217–0.487 | 0.5463 | 0.5341/0.5341/0.5341 | 0.0122 | 15.0/24.0/16.7 | 0.0/0.0/0.0 | 3.9/26.5/7.1 | abstention_error 2, candidate_gap 24 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | 40 | 0.275 | 0.154–0.395 | 0.0394 | 0.0246/0.0246/0.0246 | 0.0148 | 13.5/25.6/14.9 | 0.0/0.0/0.0 | 4.2/27.9/7.7 | abstention_error 1, candidate_gap 28 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 40 | 0.325 | 0.186–0.463 | 0.0371 | 0.0221/0.0221/0.0221 | 0.0151 | 8.5/14.7/9.2 | 4.6/9.2/5.1 | 3.7/24.5/7.5 | abstention_error 3, partial_evidence 9, candidate_gap 12, gold_unknown 3 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 40 | 0.350 | 0.205–0.488 | 0.1386 | 0.1056/0.1056/0.1056 | 0.0331 | 12.1/33.9/14.3 | 5.0/9.4/5.2 | 3.4/47.2/11.2 | abstention_error 4, partial_evidence 11, candidate_gap 9, gold_unknown 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | 9 | 0.444 | 0.143–0.800 | 0.8240 | 0.8219/0.8219/0.0182 | 0.0022 | 3.4/41.1/13.1 | 0.0/0.1/0.0 | 2.4/14.5/4.0 | abstention_error 1, candidate_gap 4 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 60 | 0.567 | 0.516–0.627 | 0.0255 | 0.0199/0.0199/0.0199 | 0.0056 | 7.9/13.1/8.4 | 0.5/0.8/0.6 | 3.5/6.5/4.3 | fine_selection_gap 15, candidate_gap 11 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 60 | 0.650 | 0.528–0.784 | 0.1252 | 0.1191/0.1191/0.1191 | 0.0060 | 11.6/30.4/16.5 | 0.5/0.7/0.5 | 3.5/6.4/6.7 | fine_selection_gap 13, candidate_gap 5, run_limit 3 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | 60 | 0.767 | 0.656–0.891 | 0.2171 | 0.2133/0.2133/0.0139 | 0.0038 | 7.9/20.9/9.5 | 0.0/0.0/0.0 | 3.3/5.4/3.5 | candidate_gap 14 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | 60 | 0.817 | 0.701–0.940 | 0.2164 | 0.2132/0.2132/0.2132 | 0.0032 | 6.9/17.3/8.2 | 0.0/0.0/0.0 | 3.1/6.4/2.6 | candidate_gap 11 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | 60 | 0.517 | 0.434–0.587 | 0.0173 | 0.0143/0.0143/0.0143 | 0.0030 | 6.9/12.7/7.5 | 0.0/0.0/0.0 | 3.2/5.8/2.8 | candidate_gap 29 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 50 | 0.600 | 0.460–0.740 | 0.0299 | 0.0257/0.0257/0.0257 | 0.0042 | 6.5/17.5/8.0 | 23.3/27.2/22.4 | 2.8/4.9/3.0 | answer_gap 15, candidate_gap 4, abstention_error 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 50 | 0.700 | 0.560–0.820 | 0.1665 | 0.1618/0.1618/0.1618 | 0.0046 | 9.6/40.6/16.0 | 23.7/27.0/22.5 | 3.0/7.9/3.5 | answer_gap 9, run_limit 2, candidate_gap 4 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full | 4 | 0.750 | 0.250–1.000 | 0.2271 | 0.2268/0.2268/0.0064 | 0.0003 | 9.8/25.2/12.5 | 0.1/0.3/0.2 | 3.7/5.2/3.9 | candidate_gap 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | 50 | 0.620 | 0.480–0.760 | n/a | n/a/n/a/n/a | 0.0037 | 47.0/114.7/56.0 | 0.1/0.1/0.1 | 3.0/6.4/3.2 | candidate_gap 18, abstention_error 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | 50 | 0.580 | 0.440–0.720 | 0.0266 | 0.0228/0.0228/0.0228 | 0.0038 | 7.8/16.4/8.4 | 0.4/0.4/0.3 | 2.6/7.5/2.9 | candidate_gap 21 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 20 | 0.000 | 0.000–0.000 | 0.0028 | 0.0028/0.0028/0.0028 | 0.0000 | 6.5/8.5/6.8 | 0.1/0.5/0.2 | 0.0/0.0/0.0 | candidate_gap 20 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 20 | 0.000 | 0.000–0.000 | 0.0211 | 0.0211/0.0211/0.0211 | 0.0000 | 9.1/14.9/9.9 | 0.1/0.5/0.2 | 0.0/0.0/0.0 | candidate_gap 20 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full | 20 | 0.200 | 0.045–0.375 | 0.4373 | 0.4373/0.4373/0.0123 | 0.0000 | 9.6/24.7/13.6 | 0.1/0.2/0.1 | 0.0/0.0/0.0 | candidate_gap 16 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full-truncated | 20 | 0.250 | 0.045–0.500 | 0.4369 | 0.4369/0.4369/0.4369 | 0.0000 | 9.2/26.0/12.4 | 0.1/0.2/0.1 | 0.0/0.0/0.0 | candidate_gap 15 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | 20 | 0.200 | 0.045–0.375 | 0.0044 | 0.0044/0.0044/0.0044 | 0.0000 | 7.8/14.7/8.6 | 0.0/0.1/0.0 | 0.0/0.0/0.0 | candidate_gap 16 |

| Suite | Model | Arm | Ability | n | Binary accuracy | Graded primary (n) | Failures |
| --- | --- | --- | --- | ---: | ---: | --- | ---: |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | abstention | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | event_ordering | 4 | 0.000 | 0.121 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | instruction_following | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | knowledge_update | 4 | 0.250 | n/a | 3 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | summarization | 4 | 0.000 | 0.313 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | temporal_reasoning | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | abstention | 4 | 0.250 | n/a | 3 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | event_ordering | 4 | 0.000 | 0.287 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | instruction_following | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | knowledge_update | 4 | 0.250 | n/a | 3 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | summarization | 4 | 0.000 | 0.350 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | temporal_reasoning | 4 | 1.000 | n/a | 0 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | abstention | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | event_ordering | 4 | 0.000 | 0.203 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | instruction_following | 4 | 0.250 | n/a | 3 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | knowledge_update | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | summarization | 4 | 0.000 | 0.500 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full | temporal_reasoning | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | abstention | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | event_ordering | 4 | 0.000 | 0.222 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | instruction_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | knowledge_update | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | summarization | 4 | 0.000 | 0.375 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | full-truncated | temporal_reasoning | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | abstention | 4 | 0.750 | n/a | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | event_ordering | 4 | 0.000 | 0.088 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | instruction_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | knowledge_update | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | multi_session_reasoning | 4 | 0.000 | n/a | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | preference_following | 4 | 0.500 | n/a | 2 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | summarization | 4 | 0.000 | 0.300 (4) | 4 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | temporal_reasoning | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | abstention | 4 | 0.250 | n/a | 3 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | event_ordering | 4 | 0.000 | 0.088 (4) | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | information_extraction | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | instruction_following | 4 | 0.750 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | knowledge_update | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | multi_session_reasoning | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | preference_following | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | summarization | 4 | 0.000 | 0.307 (4) | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | temporal_reasoning | 4 | 0.250 | n/a | 3 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | abstention | 4 | 0.000 | n/a | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | contradiction_resolution | 4 | 0.000 | n/a | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | event_ordering | 4 | 0.000 | 0.289 (4) | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | information_extraction | 4 | 0.750 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | instruction_following | 4 | 0.750 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | knowledge_update | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | multi_session_reasoning | 4 | 0.250 | n/a | 3 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | preference_following | 4 | 0.500 | n/a | 2 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | summarization | 4 | 0.000 | 0.427 (4) | 4 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | temporal_reasoning | 4 | 0.750 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | abstention | 2 | 0.500 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | information_extraction | 1 | 1.000 | n/a | 0 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | instruction_following | 1 | 0.000 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | knowledge_update | 1 | 1.000 | n/a | 0 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | preference_following | 2 | 0.500 | n/a | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | summarization | 1 | 0.000 | 0.900 (1) | 1 |
| beam-1m | commandcode/meta/muse-spark-1.3-contributor | full | temporal_reasoning | 1 | 0.000 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | adversarial | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | multi-hop | 12 | 0.167 | n/a | 10 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | open-domain | 12 | 0.333 | n/a | 8 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | single-hop | 12 | 0.750 | n/a | 3 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | temporal | 12 | 0.667 | n/a | 4 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | adversarial | 12 | 0.833 | n/a | 2 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | multi-hop | 12 | 0.167 | n/a | 10 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | open-domain | 12 | 0.583 | n/a | 5 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | single-hop | 12 | 1.000 | n/a | 0 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | temporal | 12 | 0.667 | n/a | 4 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | adversarial | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | multi-hop | 12 | 0.500 | n/a | 6 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | open-domain | 12 | 0.500 | n/a | 6 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | single-hop | 12 | 1.000 | n/a | 0 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full | temporal | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | adversarial | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | multi-hop | 12 | 0.667 | n/a | 4 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | open-domain | 12 | 0.583 | n/a | 5 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | single-hop | 12 | 1.000 | n/a | 0 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | full-truncated | temporal | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | adversarial | 12 | 0.917 | n/a | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | multi-hop | 12 | 0.167 | n/a | 10 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | open-domain | 12 | 0.250 | n/a | 9 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | single-hop | 12 | 0.667 | n/a | 4 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | temporal | 12 | 0.583 | n/a | 5 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | abstention | 8 | 0.875 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | knowledge-update | 8 | 0.625 | n/a | 3 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | multi-session | 12 | 0.500 | n/a | 6 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | single-session-assistant | 4 | 1.000 | n/a | 0 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | single-session-preference | 4 | 0.250 | n/a | 3 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | single-session-user | 6 | 0.833 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | temporal-reasoning | 8 | 0.250 | n/a | 6 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | abstention | 8 | 0.875 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | knowledge-update | 8 | 0.750 | n/a | 2 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | multi-session | 12 | 0.667 | n/a | 4 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | single-session-assistant | 4 | 1.000 | n/a | 0 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | single-session-preference | 4 | 0.250 | n/a | 3 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | single-session-user | 6 | 0.833 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | temporal-reasoning | 8 | 0.500 | n/a | 4 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full | abstention | 2 | 1.000 | n/a | 0 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full | temporal-reasoning | 2 | 0.500 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | abstention | 8 | 0.875 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | knowledge-update | 8 | 0.625 | n/a | 3 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | multi-session | 12 | 0.500 | n/a | 6 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | single-session-assistant | 4 | 0.750 | n/a | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | single-session-preference | 4 | 0.500 | n/a | 2 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | single-session-user | 6 | 0.667 | n/a | 2 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | full-truncated | temporal-reasoning | 8 | 0.500 | n/a | 4 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | abstention | 8 | 1.000 | n/a | 0 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | knowledge-update | 8 | 0.750 | n/a | 2 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | multi-session | 12 | 0.333 | n/a | 8 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | single-session-assistant | 4 | 1.000 | n/a | 0 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | single-session-preference | 4 | 0.250 | n/a | 3 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | single-session-user | 6 | 0.667 | n/a | 2 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | temporal-reasoning | 8 | 0.250 | n/a | 6 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | conflict-resolution-multi-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | conflict-resolution-single-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | conflict-resolution-multi-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | conflict-resolution-single-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full | conflict-resolution-multi-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full | conflict-resolution-single-hop | 10 | 0.400 | n/a | 6 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full-truncated | conflict-resolution-multi-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | full-truncated | conflict-resolution-single-hop | 10 | 0.500 | n/a | 5 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | conflict-resolution-multi-hop | 10 | 0.000 | n/a | 10 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | lexical-topk | conflict-resolution-single-hop | 10 | 0.400 | n/a | 6 |


descriptive only; item-weighted paired differences, whole-conversation bootstrap 95% CIs; marginal CI overlap is not a test
Holm across every emitted overall, ability-binary and ability-graded test in this summary; CIs are pointwise, no acceptance verdict
| Suite | Model | Arm | Comparator | Paired gap / 95% CI | Wins / losses | Independent clusters | Holm p / status |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | full | 0.000 / -0.108..0.098 | 3 / 3 | 18 | 1 / paired-descriptive |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | lexical-topk | 0.050 / -0.065..0.171 | 4 / 2 | 18 | 1 / paired-descriptive |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | full | -0.025 / -0.143..0.081 | 4 / 5 | 18 | 1 / paired-descriptive |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | lexical-topk | 0.025 / -0.050..0.116 | 2 / 1 | 18 | 1 / paired-descriptive |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | full | -0.117 / -0.197..-0.036 | 1 / 8 | 9 | 1 / paired-descriptive |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | lexical-topk | 0.133 / -0.015..0.327 | 10 / 2 | 9 | 1 / paired-descriptive |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | full | -0.200 / -0.340..-0.084 | 0 / 12 | 9 | 1 / paired-descriptive |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | lexical-topk | 0.050 / -0.019..0.145 | 5 / 2 | 9 | 1 / paired-descriptive |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | full-truncated | 0.080 / -0.080..0.240 | 10 / 6 | 50 | 1 / paired-descriptive |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | lexical-topk | 0.120 / -0.020..0.260 | 9 / 3 | 50 | 1 / paired-descriptive |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | full-truncated | -0.020 / -0.160..0.140 | 7 / 8 | 50 | 1 / paired-descriptive |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | lexical-topk | 0.020 / -0.080..0.120 | 4 / 3 | 50 | 1 / paired-descriptive |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | full | -0.200 / -0.375..-0.045 | 0 / 4 | 7 | 1 / paired-descriptive |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | lexical-topk | -0.200 / -0.375..-0.045 | 0 / 4 | 7 | 1 / paired-descriptive |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | full | -0.200 / -0.375..-0.045 | 0 / 4 | 7 | 1 / paired-descriptive |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | lexical-topk | -0.200 / -0.375..-0.045 | 0 / 4 | 7 | 1 / paired-descriptive |

| Suite | Model | Arm / comparator | Ability | Score | Paired difference / 95% CI | Wins / losses | Clusters | Holm p |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | abstention | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | event_ordering | graded | 0.084 / -0.105..0.152 | 3 / 1 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | information_extraction | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | instruction_following | binary | 0.500 / 0.000..1.000 | 2 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | knowledge_update | binary | -0.500 / -1.000..0.000 | 0 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | summarization | graded | -0.150 / -0.338..0.025 | 1 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | temporal_reasoning | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | abstention | binary | -0.500 / -1.000..0.000 | 0 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | event_ordering | graded | 0.199 / 0.009..0.418 | 4 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | information_extraction | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | instruction_following | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | knowledge_update | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | summarization | graded | 0.050 / 0.000..0.100 | 2 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | temporal_reasoning | binary | 0.500 / 0.000..1.000 | 2 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | abstention | binary | 0.000 / -0.750..0.750 | 1 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | event_ordering | graded | -0.083 / -0.375..0.075 | 1 / 3 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | information_extraction | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | instruction_following | binary | 0.500 / 0.000..1.000 | 2 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | knowledge_update | binary | -0.500 / -1.000..0.000 | 0 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | summarization | graded | -0.188 / -0.388..-0.025 | 0 / 4 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | temporal_reasoning | binary | -0.250 / -1.000..0.500 | 1 / 2 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | abstention | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | contradiction_resolution | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | event_ordering | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | event_ordering | graded | 0.033 / -0.093..0.108 | 2 / 2 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | information_extraction | binary | 0.000 / 0.000..0.000 | 0 / 0 | 3 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | instruction_following | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | knowledge_update | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | multi_session_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | preference_following | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | summarization | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | summarization | graded | 0.013 / -0.025..0.050 | 2 / 1 | 4 | 1 |
| beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | temporal_reasoning | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | multi-hop | binary | -0.333 / -0.600..-0.100 | 0 / 4 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | temporal | binary | -0.250 / -0.400..-0.083 | 0 / 3 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | open-domain | binary | 0.083 / 0.000..0.214 | 1 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | single-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | adversarial | binary | -0.083 / -0.158..0.000 | 0 / 1 | 6 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | multi-hop | binary | 0.000 / -0.188..0.300 | 1 / 1 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | temporal | binary | 0.083 / 0.000..0.333 | 1 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | open-domain | binary | 0.333 / 0.091..0.714 | 4 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | single-hop | binary | 0.333 / 0.083..0.583 | 4 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | adversarial | binary | -0.083 / -0.158..0.000 | 0 / 1 | 6 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | multi-hop | binary | -0.333 / -0.700..-0.071 | 0 / 4 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | temporal | binary | -0.250 / -0.400..-0.083 | 0 / 3 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | open-domain | binary | -0.167 / -0.400..0.000 | 0 / 2 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | single-hop | binary | -0.250 / -0.462..-0.077 | 0 / 3 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | adversarial | binary | 0.000 / 0.000..0.000 | 0 / 0 | 6 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | multi-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | temporal | binary | 0.083 / 0.000..0.333 | 1 / 0 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | open-domain | binary | 0.083 / -0.154..0.500 | 2 / 1 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | single-hop | binary | 0.083 / -0.214..0.308 | 2 / 1 | 7 | 1 |
| locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | adversarial | binary | 0.000 / 0.000..0.000 | 0 / 0 | 6 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | multi-session | binary | 0.167 / -0.167..0.500 | 3 / 1 | 12 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | knowledge-update | binary | 0.125 / -0.250..0.500 | 2 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | temporal-reasoning | binary | 0.000 / -0.500..0.500 | 2 / 2 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | single-session-user | binary | 0.167 / -0.333..0.667 | 2 / 1 | 6 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | single-session-assistant | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | single-session-preference | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full-truncated | abstention | binary | 0.000 / 0.000..0.000 | 0 / 0 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | multi-session | binary | 0.333 / 0.083..0.583 | 4 / 0 | 12 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | knowledge-update | binary | 0.000 / -0.375..0.375 | 1 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | temporal-reasoning | binary | 0.250 / -0.250..0.625 | 3 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | single-session-user | binary | 0.167 / 0.000..0.500 | 1 / 0 | 6 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | single-session-assistant | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | single-session-preference | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | abstention | binary | -0.125 / -0.375..0.000 | 0 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | multi-session | binary | 0.000 / -0.250..0.250 | 1 / 1 | 12 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | knowledge-update | binary | 0.000 / -0.500..0.500 | 2 / 2 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | temporal-reasoning | binary | -0.250 / -0.625..0.250 | 1 / 3 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | single-session-user | binary | 0.167 / -0.333..0.667 | 2 / 1 | 6 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | single-session-assistant | binary | 0.250 / 0.000..0.750 | 1 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | single-session-preference | binary | -0.250 / -0.750..0.000 | 0 / 1 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full-truncated | abstention | binary | 0.000 / 0.000..0.000 | 0 / 0 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | multi-session | binary | 0.167 / 0.000..0.417 | 2 / 0 | 12 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | knowledge-update | binary | -0.125 / -0.375..0.000 | 0 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | temporal-reasoning | binary | 0.000 / -0.375..0.375 | 1 / 1 | 8 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | single-session-user | binary | 0.167 / 0.000..0.500 | 1 / 0 | 6 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | single-session-assistant | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | single-session-preference | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | abstention | binary | -0.125 / -0.375..0.000 | 0 / 1 | 8 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | conflict-resolution-single-hop | binary | -0.400 / -0.500..-0.250 | 0 / 4 | 3 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / full | conflict-resolution-multi-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | conflict-resolution-single-hop | binary | -0.400 / -0.500..-0.250 | 0 / 4 | 3 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools / lexical-topk | conflict-resolution-multi-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | conflict-resolution-single-hop | binary | -0.400 / -0.500..-0.250 | 0 / 4 | 3 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x / full | conflict-resolution-multi-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | conflict-resolution-single-hop | binary | -0.400 / -0.500..-0.250 | 0 / 4 | 3 | 1 |
| memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x / lexical-topk | conflict-resolution-multi-hop | binary | 0.000 / 0.000..0.000 | 0 / 0 | 4 | 1 |

Stages identify candidate levers, not promised recoveries. Only product arms are eligible; failures shared across arms are counted once per suite/model/question. The JSON screeningLimits disclose rubric abilities that cannot support a lever-effect decision; stage-based needed is only a descriptive candidate flag.

| Lever task | Target stages | Unique candidate questions | Arm occurrences | Shared across arms | Best share | Decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 5 | candidate_gap | 63 | 112 | 49 | 100.0% | needed |
| 9 | answer_gap, abstention_error | 26 | 41 | 15 | 80.0% | needed |
| 8 | partial_evidence | 23 | 38 | 15 | 42.3% | needed |
| 13 | fine_selection_gap | 17 | 28 | 11 | 61.9% | needed |
| 6 | temporal_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 7 | supersession_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 10 | tool_protocol_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 16 | capacity_gap | 0 | 0 | 0 | 0.0% | unmeasurable |
| 17 | extraction_gap | 0 | 0 | 0 | 0.0% | unmeasurable |

| Task | Suite | Model | Eligible arm | Candidate failures / all failures | Share | Attributed / unknown / operational / invalid | Coverage | Provenance |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| 5 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 11/27 | 40.7% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 5 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 16/28 | 57.1% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 5 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 5/21 | 23.8% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 5 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 11/26 | 42.3% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 5 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 20/20 | 100.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 5 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 20/20 | 100.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 5 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 4/15 | 26.7% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 5 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 4/20 | 20.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 5 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 9/26 | 34.6% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 5 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 12/27 | 44.4% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 9 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 6/27 | 22.2% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 9 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 3/28 | 10.7% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 9 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 9 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 9 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 9 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 9 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 9/15 | 60.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 9 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 16/20 | 80.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 9 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 4/26 | 15.4% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 9 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 3/27 | 11.1% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 8 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 9/27 | 33.3% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 8 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 9/28 | 32.1% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 8 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 8 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 8 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 8 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 8 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 8 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 8 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 11/26 | 42.3% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 8 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 9/27 | 33.3% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 13 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 13 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 13 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 13/21 | 61.9% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 13 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 15/26 | 57.7% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 13 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 13 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 13 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 13 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 13 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 13 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 6 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 6 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 6 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 6 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 6 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 6 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 6 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 6 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 6 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 6 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 7 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 7 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 7 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 7 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 7 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 7 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 7 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 7 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 7 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 7 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 10 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 10 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 10 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 10 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 10 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 10 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 10 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 10 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 10 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 10 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 16 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 16 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 16 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 16 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 16 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 16 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 16 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 16 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 16 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 16 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
| 17 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/27 | 0.0% | 26/0/1/0 | 96.3% | {"source_chat_ids":26,"outcome":1} |
| 17 | beam-100k | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/28 | 0.0% | 28/0/0/0 | 100.0% | {"source_chat_ids":28} |
| 17 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/21 | 0.0% | 18/0/3/0 | 85.7% | {"message_annotations":18,"outcome":3} |
| 17 | locomo | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/26 | 0.0% | 26/0/0/0 | 100.0% | {"message_annotations":26} |
| 17 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 17 | memoryagentbench-cr | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 17 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/15 | 0.0% | 13/0/2/0 | 86.7% | {"answer_text_or_session":13,"outcome":2} |
| 17 | longmemeval-m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/20 | 0.0% | 20/0/0/0 | 100.0% | {"answer_text_or_session":20} |
| 17 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x-tools | 0/26 | 0.0% | 24/2/0/0 | 92.3% | {"source_chat_ids":26} |
| 17 | beam-1m | commandcode/meta/muse-spark-1.3-contributor | fabric-x | 0/27 | 0.0% | 24/3/0/0 | 88.9% | {"source_chat_ids":27} |
