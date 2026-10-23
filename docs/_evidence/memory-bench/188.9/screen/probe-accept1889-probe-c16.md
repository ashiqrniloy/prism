# Memory benchmark: longmemeval-s / fabric

Status: partial. Input: 36647; cache read: 34816; ratio: 0.9500.
Attempt: accept1889-probe-c16@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 8; snippet tokens: 30917; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 44197.1 ms at concurrency 16 (initial 16); questions p50 17645.9 ms / p95 41449.6 ms; judge 7x p50 2693.9ms, solver 8x p50 5749.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 0.6000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 3 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
