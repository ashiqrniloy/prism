# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 155019; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 5 (0.50/q); recall calls: 14; snippet tokens: 41747; recall@k: 0.6667.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 535591.8 ms at concurrency 1 (initial 1); end-to-end questions p50 20134.2 ms / p95 178285.6 ms; ingestion n=10 p50/p95/mean 580.2/775.5/577.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 15553.7/87513/27698.7 ms; evaluation n=10 p50/p95/mean 7026.3/111058.8/25129.2 ms; judge 20x p50 4560.7ms, solver 14x p50 12726.6ms.
USD: campaign 0.007898; product measured/cold/warm 0.007898/0.007898/0.007898; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.2 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| knowledge_update | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.0000 | 0.0000 | 0.0000 |
| summarization | 1 | 0.1000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
