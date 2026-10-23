# Memory benchmark: longmemeval-s / full

Status: completed. Input: 11295518; cache read: 320; ratio: 0.0000.
Attempt: accept18810-full@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2601701.6 ms at concurrency 4 (initial 4); questions p50 85960 ms / p95 235661.9 ms; judge 100x p50 2725.6ms, solver 100x p50 18787.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 40 | 0.5750 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 20 | 0.8500 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 20 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 14 | 0.9286 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 6 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
