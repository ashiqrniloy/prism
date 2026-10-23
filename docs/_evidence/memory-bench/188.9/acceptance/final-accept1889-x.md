# Memory benchmark: longmemeval-s / fabric-x

Status: completed. Input: 661681; cache read: 5888; ratio: 0.0089.
Attempt: accept1889-x@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 100; snippet tokens: 366478; recall@k: 0.9796.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2242428.9 ms at concurrency 4 (initial 4); questions p50 79766 ms / p95 158787.5 ms; injection-label 796x p50 12318.6ms, judge 896x p50 5210.8ms, solver 100x p50 7525.9ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.9500 | n/a | 1.0000 | 0.925 | 0.85 | 0.0000 |
| multi-session | 20 | 0.4000 | n/a | 0.9000 | 0.5225 | 0.3 | 0.0000 |
| temporal-reasoning | 20 | 0.5000 | n/a | 1.0000 | 0.6759259259259259 | 0.6111111111111112 | 0.0000 |
| single-session-user | 20 | 1.0000 | n/a | 1.0000 | 0.95 | 0.95 | 0.0000 |
| single-session-assistant | 20 | 0.9500 | n/a | 1.0000 | 0.95 | 0.95 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
