# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 566836; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 23 (2.30/q); recall calls: 28; snippet tokens: 74065; recall@k: 0.7778.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 266994.9 ms at concurrency 1 (initial 1); end-to-end questions p50 21829.9 ms / p95 57141 ms; ingestion n=10 p50/p95/mean 452.3/507.5/436.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 13822.8/30566.3/16703.2 ms; evaluation n=10 p50/p95/mean 5536.7/26080.9/9450.2 ms; judge 24x p50 2755.7ms, solver 33x p50 4159ms.
USD: campaign 0.059066; product measured/cold/warm 0.059066/0.059066/0.059066; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.4 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge_update | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.1495 | 0.0000 | 0.0000 |
| summarization | 1 | 0.0500 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
