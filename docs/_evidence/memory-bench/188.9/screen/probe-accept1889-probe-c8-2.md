# Memory benchmark: longmemeval-s / fabric

Status: partial. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: accept1889-probe-c8@2; usage complete: true; resumed results: 8.
Tool calls: 0 (0.00/q); recall calls: 8; snippet tokens: 30917; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2155.2 ms at concurrency 8 (initial 8); questions p50 0.1 ms / p95 1.1 ms; no calls.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 0.8000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 3 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
