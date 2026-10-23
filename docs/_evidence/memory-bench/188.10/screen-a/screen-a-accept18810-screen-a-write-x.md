# Memory benchmark: longmemeval-s / fabric-x

Status: completed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: write. Timing: arm 22468.5 ms at concurrency 4 (initial 4); questions p50 1424.1 ms / p95 1599.9 ms; no calls.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 30 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| abstention | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge-update | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-preference | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 5 | n/a | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
