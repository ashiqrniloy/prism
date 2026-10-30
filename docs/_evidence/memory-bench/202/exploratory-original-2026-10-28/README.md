# Plan 202 Task 4 baseline

Status: gate-recorded

Gate 1: Complete - [ ] Task 4: Baseline of preset revision 1 on every development partition (owner gate 1, paid)

Compute: subscription via opencode-go; 195697530 tokens; $36.04 list-price equivalent. Subscription usage: no per-token charge. USD is the list-price equivalent for comparison only. Token totals still size plan quotas and per-job reservations; wall time is measured by the first real write arm, never assumed zero.

| Suite | Model | Arm | n | Accuracy | 95% CI | Cost USD | Wall p50/p95 (s) | Failures by stage |
| --- | --- | --- | ---: | ---: | --- | ---: | --- | --- |
| beam-100k | opencode-go/beam-free | fabric-x | 40 | 0.225 | 0.111–0.361 | 0.0000 | 120.0/307.0 | abstention_error 3, gold_unknown 25, candidate_gap 2, answer_gap 1 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | 40 | 0.350 | 0.217–0.500 | 0.0000 | 279.7/587.5 | abstention_error 3, gold_unknown 22, answer_gap 1 |
| beam-100k | opencode-go/beam-free | full | 40 | 0.350 | 0.217–0.514 | 0.0000 | 52.1/88.6 | gold_unknown 26 |
| beam-100k | opencode-go/beam-free | full-truncated | 40 | 0.425 | 0.262–0.606 | 0.0000 | 47.1/68.3 | abstention_error 1, gold_unknown 22 |
| beam-100k | opencode-go/beam-free | lexical-topk | 40 | 0.325 | 0.213–0.462 | 0.0000 | 47.1/65.9 | gold_unknown 25, candidate_gap 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | 40 | 0.350 | 0.222–0.488 | 0.0000 | 209.3/253.4 | abstention_error 1, gold_unknown 23, candidate_gap 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | 40 | 0.425 | 0.289–0.576 | 0.0000 | 392.4/642.6 | abstention_error 2, gold_unknown 19, candidate_gap 2 |

| Suite | Model | Arm | Ability | n | Accuracy | Failures |
| --- | --- | --- | --- | ---: | ---: | ---: |
| beam-100k | opencode-go/beam-free | fabric-x | abstention | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | fabric-x | contradiction_resolution | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x | information_extraction | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x | instruction_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x | knowledge_update | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x | multi_session_reasoning | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x | temporal_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | abstention | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | contradiction_resolution | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | information_extraction | 4 | 0.750 | 1 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | instruction_following | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | knowledge_update | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | multi_session_reasoning | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | temporal_reasoning | 4 | 0.750 | 1 |
| beam-100k | opencode-go/beam-free | full | abstention | 4 | 1.000 | 0 |
| beam-100k | opencode-go/beam-free | full | contradiction_resolution | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | full | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | full | information_extraction | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | full | instruction_following | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | full | knowledge_update | 4 | 0.750 | 1 |
| beam-100k | opencode-go/beam-free | full | multi_session_reasoning | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | full | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | full | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | full | temporal_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | full-truncated | abstention | 4 | 0.750 | 1 |
| beam-100k | opencode-go/beam-free | full-truncated | contradiction_resolution | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | full-truncated | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | full-truncated | information_extraction | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | full-truncated | instruction_following | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | full-truncated | knowledge_update | 4 | 1.000 | 0 |
| beam-100k | opencode-go/beam-free | full-truncated | multi_session_reasoning | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | full-truncated | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | full-truncated | summarization | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | full-truncated | temporal_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | lexical-topk | abstention | 4 | 1.000 | 0 |
| beam-100k | opencode-go/beam-free | lexical-topk | contradiction_resolution | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | lexical-topk | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | lexical-topk | information_extraction | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | lexical-topk | instruction_following | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | lexical-topk | knowledge_update | 4 | 0.250 | 3 |
| beam-100k | opencode-go/beam-free | lexical-topk | multi_session_reasoning | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | lexical-topk | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/beam-free | lexical-topk | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/beam-free | lexical-topk | temporal_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | abstention | 4 | 0.750 | 1 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | contradiction_resolution | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | information_extraction | 4 | 0.750 | 1 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | instruction_following | 4 | 0.750 | 1 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | knowledge_update | 4 | 0.250 | 3 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | multi_session_reasoning | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x | temporal_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | abstention | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | contradiction_resolution | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | event_ordering | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | information_extraction | 4 | 1.000 | 0 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | instruction_following | 4 | 0.750 | 1 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | knowledge_update | 4 | 0.250 | 3 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | multi_session_reasoning | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | preference_following | 4 | 0.500 | 2 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | summarization | 4 | 0.000 | 4 |
| beam-100k | opencode-go/minimax-m3 | fabric-x-tools | temporal_reasoning | 4 | 0.750 | 1 |


| Suite | Model | Arm | Comparator | Gap |
| --- | --- | --- | --- | ---: |
| beam-100k | opencode-go/beam-free | fabric-x-tools | full | +0.000 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | full-truncated | -0.075 |
| beam-100k | opencode-go/beam-free | fabric-x-tools | lexical-topk | +0.025 |
| beam-100k | opencode-go/beam-free | fabric-x | full | -0.125 |
| beam-100k | opencode-go/beam-free | fabric-x | full-truncated | -0.200 |
| beam-100k | opencode-go/beam-free | fabric-x | lexical-topk | -0.100 |

| Lever task | Target stages | Recoverable | Best share | Decision |
| --- | --- | ---: | ---: | --- |
| 9 | answer_gap, abstention_error | 12 | 15.4% | needed |
| 5 | candidate_gap | 8 | 8.7% | needed |
| 6 | temporal_gap | 0 | 0.0% | unmeasurable |
| 7 | supersession_gap | 0 | 0.0% | unmeasurable |
| 8 | partial_evidence | 0 | 0.0% | not needed |
| 10 | tool_protocol_gap | 0 | 0.0% | unmeasurable |
| 13 | fine_selection_gap | 0 | 0.0% | not needed |
| 16 | capacity_gap | 0 | 0.0% | unmeasurable |
| 17 | extraction_gap | 0 | 0.0% | unmeasurable |
