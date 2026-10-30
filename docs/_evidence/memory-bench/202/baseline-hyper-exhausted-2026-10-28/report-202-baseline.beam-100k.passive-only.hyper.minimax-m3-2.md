# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 27616; cache read: 2341; ratio: 0.0848.
Attempt: 202-baseline.beam-100k.passive-only.hyper.minimax-m3@2; usage complete: true; resumed results: 5.
Tool calls: 0 (0.00/q); recall calls: 9; snippet tokens: 33430; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 153279.4 ms at concurrency 8 (initial 8); questions p50 17729.9 ms / p95 151452.6 ms; injection-label 47x p50 49053.4ms, judge 45x p50 988.3ms, solver 8x p50 1355.9ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 3 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
