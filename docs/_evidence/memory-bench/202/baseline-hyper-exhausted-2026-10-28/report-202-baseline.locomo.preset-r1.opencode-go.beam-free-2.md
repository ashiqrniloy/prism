# Memory benchmark: locomo / fabric-x-tools

Status: failed. Input: 1077343; cache read: 319232; ratio: 0.2963.
Attempt: 202-baseline.locomo.preset-r1.opencode-go.beam-free@2; usage complete: true; resumed results: 8.
Tool calls: 56 (5.09/q); recall calls: 11; snippet tokens: 43607; recall@k: 0.7500.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 167333 ms at concurrency 6 (initial 6); questions p50 26669.7 ms / p95 149707.4 ms; injection-label 44x p50 50475.9ms, judge 47x p50 721.9ms, solver 37x p50 1575.3ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 9 | 0.1111 | 0.06535947712418301 | 1.0000 | 0.8492063492063493 | 0.6666666666666666 | 0.5556 |
| temporal | 2 | 0.0000 | n/a | 0.0000 | 0 | 0 | 1.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
