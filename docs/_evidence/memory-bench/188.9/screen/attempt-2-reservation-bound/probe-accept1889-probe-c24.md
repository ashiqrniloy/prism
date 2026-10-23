# Memory benchmark: longmemeval-s / fabric

Status: partial. Input: 61949; cache read: 31040; ratio: 0.5011.
Attempt: accept1889-probe-c24@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 7; snippet tokens: 26938; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 80567.2 ms at concurrency 24 (initial 24); questions p50 51143.6 ms / p95 77817.9 ms; injection-label 74x p50 23206.5ms, judge 81x p50 5158.6ms, solver 8x p50 6260.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 3 | 0.6667 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
