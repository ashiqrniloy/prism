# Memory benchmark: longmemeval-s / fabric

Status: partial. Input: 36745; cache read: 34688; ratio: 0.9440.
Attempt: accept1889-probe-c24@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 8; snippet tokens: 30917; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 70027.5 ms at concurrency 24 (initial 24); questions p50 62178.2 ms / p95 67299 ms; judge 8x p50 3207.4ms, solver 8x p50 5421.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 0.8000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 3 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
