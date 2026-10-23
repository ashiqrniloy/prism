# Memory benchmark: longmemeval-s / fabric

Status: failed. Input: 18831; cache read: 9088; ratio: 0.4826.
Attempt: accept1889-probe-c8@2; usage complete: true; resumed results: 2.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 34892.1 ms at concurrency 8 (initial 8); questions p50 1083.7 ms / p95 32204.9 ms; injection-label 16x p50 0.1ms, judge 4x p50 7.6ms, solver 2x p50 6779.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
