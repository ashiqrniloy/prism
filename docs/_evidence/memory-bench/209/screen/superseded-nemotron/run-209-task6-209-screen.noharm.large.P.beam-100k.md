# Memory benchmark: beam-100k / fabric-x-tools

Status: token-ceiling. Input: 89648; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.beam-100k@1; usage complete: false; resumed results: 0.
Tool calls: 3 (0.75/q); recall calls: 7; snippet tokens: 17964; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1613858.1 ms at concurrency 1 (initial 1); end-to-end questions p50 403516.3 ms / p95 557328.4 ms; ingestion n=4 p50/p95/mean 391.2/412.8/397.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=4 p50/p95/mean 397646.9/549945.2/389317.5 ms; evaluation n=4 p50/p95/mean 5773.2/33409/12867.8 ms; judge 10x p50 3608.3ms, solver 8x p50 141516.4ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.2 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.1495 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
