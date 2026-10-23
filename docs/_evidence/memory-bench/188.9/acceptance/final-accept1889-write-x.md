# Memory benchmark: longmemeval-s / fabric-x

Status: completed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: write. Timing: arm 33870.8 ms at concurrency 4 (initial 4); questions p50 1345.3 ms / p95 1598.1 ms; no calls.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| multi-session | 20 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 20 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 20 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 20 | n/a | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
