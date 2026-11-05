# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 539249; cache read: 105216; ratio: 0.1951.
Attempt: 208-screen.large.P.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 19 (1.90/q); recall calls: 29; snippet tokens: 56124; recall@k: 0.8889.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 500462 ms at concurrency 1 (initial 1); end-to-end questions p50 33043 ms / p95 108052.9 ms; ingestion n=10 p50/p95/mean 575.4/1006.9/658.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 25091.4/94117.8/36554.9 ms; evaluation n=10 p50/p95/mean 8317.1/32808.3/12503.5 ms; judge 20x p50 4195.2ms, solver 29x p50 9198.4ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.2 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| knowledge_update | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 1.0000 | 0.16666666666666666 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.0000 | 0.0000 | 0.0000 |
| summarization | 1 | 0.4000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
