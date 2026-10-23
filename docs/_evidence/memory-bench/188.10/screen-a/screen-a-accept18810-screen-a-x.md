# Memory benchmark: longmemeval-s / fabric-x

Status: completed. Input: 239050; cache read: 896; ratio: 0.0037.
Attempt: accept18810-screen-a-x@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 60; snippet tokens: 217584; recall@k: 0.9153.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 540608.8 ms at concurrency 4 (initial 4); questions p50 16122.3 ms / p95 128791.2 ms; judge 60x p50 3419ms, solver 60x p50 6217.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 30 | 0.2667 | n/a | 0.8667 | 0.5205555555555555 | 0.3333333333333333 | 0.0000 |
| abstention | 5 | 0.4000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| single-session-assistant | 5 | 0.8000 | n/a | 1.0000 | 0.8 | 0.8 | 0.0000 |
| single-session-preference | 5 | 0.4000 | n/a | 0.8000 | 0.5 | 0.4 | 0.0000 |
| single-session-user | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| temporal-reasoning | 5 | 0.4000 | n/a | 1.0000 | 0.75 | 0.75 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
