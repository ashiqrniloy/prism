# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 268629; cache read: 47156; ratio: 0.1755.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.mimo-v2.5@1; usage complete: true; resumed results: 0.
Tool calls: 6 (1.50/q); recall calls: 2; snippet tokens: 14118; recall@k: n/a.
Judge: opencode-go/deepseek-v4-pro. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 464726.2 ms at concurrency 1 (initial 4); questions p50 177833.4 ms / p95 444980.6 ms; injection-label 57x p50 32995.9ms, judge 67x p50 4719.5ms, solver 17x p50 7165.3ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 3 | 0.6667 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
