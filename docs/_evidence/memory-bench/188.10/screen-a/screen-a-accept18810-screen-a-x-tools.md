# Memory benchmark: longmemeval-s / fabric-x-tools

Status: completed. Input: 1399977; cache read: 408896; ratio: 0.2921.
Attempt: accept18810-screen-a-x-tools@1; usage complete: true; resumed results: 0.
Tool calls: 89 (1.48/q); recall calls: 60; snippet tokens: 305618; recall@k: 0.9831.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 618376.7 ms at concurrency 4 (initial 4); questions p50 33860.7 ms / p95 78673.9 ms; judge 59x p50 2832.1ms, solver 129x p50 8033.6ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 30 | 0.7333 | n/a | 0.9667 | 0.8472222222222221 | 0.7333333333333333 | 0.0000 |
| abstention | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| single-session-assistant | 5 | 1.0000 | n/a | 1.0000 | 0.8 | 0.8 | 0.0000 |
| single-session-preference | 5 | 1.0000 | n/a | 1.0000 | 0.8 | 0.6 | 0.0000 |
| single-session-user | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| temporal-reasoning | 5 | 0.6000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
