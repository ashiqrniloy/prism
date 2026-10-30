# Memory benchmark: beam-100k / full

Status: completed. Input: 5301023; cache read: 9877; ratio: 0.0019.
Attempt: 202-baseline.beam-100k.full.commandcode.meta/muse-spark-1.2-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 722705.8 ms at concurrency 1 (initial 1); end-to-end questions p50 13964.1 ms / p95 37427.8 ms; ingestion n=40 p50/p95/mean 4.8/6.3/5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 8923.1/14645.3/9633.7 ms; evaluation n=40 p50/p95/mean 4478.8/27935.2/8413.2 ms; judge 96x p50 2047ms, solver 40x p50 8911.9ms.
USD: campaign 0.551473; product measured/cold/warm 0.533979/0.533979/0.020157; evaluation 0.017494.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2831 | 0.0000 | 0.2500 |
| summarization | 4 | 0.5250 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
