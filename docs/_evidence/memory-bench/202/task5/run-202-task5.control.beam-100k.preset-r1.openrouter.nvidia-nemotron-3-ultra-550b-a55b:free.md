# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1187435; cache read: 17280; ratio: 0.0146.
Attempt: 202-task5.control.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 53 (1.32/q); recall calls: 86; snippet tokens: 199191; recall@k: 0.5833.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2361171.2 ms at concurrency 1 (initial 1); end-to-end questions p50 44448.1 ms / p95 131163.1 ms; ingestion n=40 p50/p95/mean 292.6/400.2/316.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 19698/68623/29479.3 ms; evaluation n=40 p50/p95/mean 16053.3/79754.2/29123.2 ms; judge 97x p50 8561.8ms, solver 93x p50 7278.8ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.07083333333333333 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | 1.0000 | 0.875 | 0.75 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.5000 | 0.225 | 0 | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | 1.0000 | 0.875 | 0.75 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.1523 | 0.0000 | 0.0000 |
| summarization | 4 | 0.2250 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
