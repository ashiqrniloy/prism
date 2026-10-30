# Memory benchmark: beam-1m / fabric-x

Status: completed. Input: 200901; cache read: 9744; ratio: 0.0485.
Attempt: 202-baseline.beam-1m.passive-only.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 40; snippet tokens: 146866; recall@k: 0.4412.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 879662.4 ms at concurrency 1 (initial 1); end-to-end questions p50 17212.8 ms / p95 46488.3 ms; ingestion n=40 p50/p95/mean 4559.8/9230.6/5064.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 8508.6/14723.3/9163.9 ms; evaluation n=40 p50/p95/mean 3673.9/24452.1/7516.1 ms; judge 94x p50 1873.8ms, solver 40x p50 8192.4ms.
USD: campaign 0.037147; product measured/cold/warm 0.022075/0.022075/0.022075; evaluation 0.015072.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 0.7500 | 0.29166666666666663 | 0 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.019139566395663957 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | 0.2500 | 0.16666666666666666 | 0 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.7500 | 0.4375 | 0 | 0.0000 |
| multi_session_reasoning | 4 | 0.5000 | n/a | 1.0000 | 0.42063492063492064 | 0 | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.05 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.2500 | n/a | 0.5000 | 0.10416666666666666 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.0883 | 0.0000 | 0.0000 |
| summarization | 4 | 0.3066 | 0.0000 | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
