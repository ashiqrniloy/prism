# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 45393; cache read: 3904; ratio: 0.0860.
Attempt: accept1889-screen-baseline@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 35; snippet tokens: 19829; recall@k: 0.7941.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 206654.1 ms at concurrency 4 (initial 4); questions p50 24605.1 ms / p95 42182.8 ms; judge 35x p50 2992ms, solver 35x p50 7654.8ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 5 | 0.8000 | n/a | 0.6000 | 0.5 | 0 | 0.0000 |
| knowledge-update | 5 | 0.2000 | n/a | 1.0000 | 0.3 | 0 | 0.0000 |
| multi-session | 5 | 0.0000 | n/a | 0.8000 | 0.16666666666666666 | 0 | 0.0000 |
| single-session-assistant | 5 | 0.8000 | n/a | 0.8000 | 0.8 | 0.8 | 0.0000 |
| single-session-preference | 5 | 0.8000 | n/a | 0.6000 | 0.2 | 0.2 | 0.0000 |
| single-session-user | 5 | 0.8000 | n/a | 1.0000 | 0.6 | 0.6 | 0.0000 |
| temporal-reasoning | 5 | 0.0000 | n/a | 0.7500 | 0.125 | 0 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
