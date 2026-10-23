# Memory benchmark: longmemeval-s / fabric

Status: failed. Input: 49346; cache read: 8704; ratio: 0.1764.
Attempt: accept1889-screen-baseline@1; usage complete: false; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 11; snippet tokens: 42239; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 57589.7 ms at concurrency 4 (initial 4); questions p50 16413.4 ms / p95 24599.8 ms; judge 11x p50 4197.1ms, solver 12x p50 6770.6ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 0.6000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 4 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| multi-session | 2 | 0.5000 | n/a | 1.0000 | 0.6666666666666666 | 0.5 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
