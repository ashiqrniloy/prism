# Memory benchmark: longmemeval-s / fabric-x

Status: failed. Input: 23223; cache read: 128; ratio: 0.0055.
Attempt: accept18810-x@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 3; snippet tokens: 10935; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 46864.1 ms at concurrency 4 (initial 4); questions p50 40297.7 ms / p95 44920.6 ms; injection-label 28x p50 8344.4ms, judge 30x p50 4630ms, solver 4x p50 3454.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 4 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
