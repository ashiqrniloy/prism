# Memory benchmark: longmemeval-s / fabric-x-tools

Status: completed. Input: 2966891; cache read: 965504; ratio: 0.3254.
Attempt: accept18810-x-tools@1; usage complete: true; resumed results: 0.
Tool calls: 152 (1.52/q); recall calls: 100; snippet tokens: 496088; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 3180029.8 ms at concurrency 4 (initial 4); questions p50 102367.2 ms / p95 275453.3 ms; injection-label 1496x p50 13278.5ms, judge 1594x p50 4446ms, solver 215x p50 6516.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 40 | 0.7000 | n/a | 1.0000 | 0.8591666666666666 | 0.725 | 0.0000 |
| knowledge-update | 20 | 0.8500 | n/a | 1.0000 | 0.875 | 0.8 | 0.0000 |
| temporal-reasoning | 20 | 0.6000 | n/a | 1.0000 | 0.9 | 0.8666666666666667 | 0.1000 |
| single-session-user | 14 | 0.9286 | n/a | 1.0000 | 0.8571428571428571 | 0.8571428571428571 | 0.0000 |
| single-session-assistant | 6 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
