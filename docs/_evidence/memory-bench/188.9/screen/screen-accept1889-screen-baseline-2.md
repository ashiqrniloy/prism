# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 157005; cache read: 28096; ratio: 0.1789.
Attempt: accept1889-screen-baseline@2; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 35; snippet tokens: 134395; recall@k: 0.9706.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 235179 ms at concurrency 4 (initial 4); questions p50 25099.1 ms / p95 60414.6 ms; judge 35x p50 3607.4ms, solver 35x p50 7311.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge-update | 5 | 0.8000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| multi-session | 5 | 0.2000 | n/a | 1.0000 | 0.55 | 0.2 | 0.0000 |
| single-session-assistant | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| single-session-preference | 5 | 0.8000 | n/a | 0.8000 | 0.5 | 0.4 | 0.0000 |
| single-session-user | 5 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| temporal-reasoning | 5 | 0.4000 | n/a | 1.0000 | 0.75 | 0.75 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
