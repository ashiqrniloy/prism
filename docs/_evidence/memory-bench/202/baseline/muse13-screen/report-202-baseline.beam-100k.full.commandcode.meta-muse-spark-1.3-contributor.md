# Memory benchmark: beam-100k / full

Status: failed. Input: 4347873; cache read: 7632; ratio: 0.0018.
Attempt: 202-baseline.beam-100k.full.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 798416.7 ms at concurrency 1 (initial 1); end-to-end questions p50 22783 ms / p95 45442.6 ms; ingestion n=32 p50/p95/mean 5.3/8/5.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=32 p50/p95/mean 16502.9/31865.6/18308.5 ms; evaluation n=32 p50/p95/mean 3602.7/13385.7/5664.3 ms; judge 73x p50 1745.8ms, solver 33x p50 16825.4ms.
USD: campaign 0.448907; product measured/cold/warm 0.441496/0.441496/0.018365; evaluation 0.007411.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2034 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
