# Memory benchmark: synthetic / full

Status: completed. Input: 5104; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: mock/synthetic-judge. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 52.1 ms at concurrency 1 (initial 1); end-to-end questions p50 1.7 ms / p95 22.4 ms; ingestion n=14 p50/p95/mean 0.5/5.6/1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=14 p50/p95/mean 0.7/11.3/1.6 ms; evaluation n=14 p50/p95/mean 0.1/0.6/0.1 ms; solver 14x p50 0ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi-session | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-preference | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-hop | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| multi-hop | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| temporal | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| open-domain | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| adversarial | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-single-hop | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
