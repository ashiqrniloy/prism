# Memory benchmark: longmemeval-s / fabric

Status: failed. Input: 50872; cache read: 30464; ratio: 0.5988.
Attempt: accept1889-probe-c16@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 3; snippet tokens: 11822; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 66042.5 ms at concurrency 16 (initial 16); questions p50 26237.7 ms / p95 63347.8 ms; injection-label 74x p50 5010ms, judge 46x p50 8007.3ms, solver 8x p50 6711.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 3 | 0.6667 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| knowledge-update | 3 | 0.3333 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
