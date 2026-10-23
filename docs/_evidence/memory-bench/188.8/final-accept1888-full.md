# Memory benchmark: longmemeval-s / full

Status: completed. Input: 11500702; cache read: 384; ratio: 0.0000.
Attempt: accept1888-full@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.7000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi-session | 20 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal-reasoning | 20 | 0.6000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-user | 20 | 0.9000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-session-assistant | 20 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
