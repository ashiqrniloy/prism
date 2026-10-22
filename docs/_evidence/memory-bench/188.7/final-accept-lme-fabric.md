# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 329669; cache read: 5696; ratio: 0.0173.
Attempt: accept-lme-fabric@1; usage complete: false; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 140; snippet tokens: 81169; recall@k: 0.7319.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 20 | 0.8500 | n/a | 0.6842 |
| knowledge-update | 20 | 0.3500 | n/a | 0.9000 |
| multi-session | 20 | 0.0500 | n/a | 0.7500 |
| single-session-assistant | 20 | 0.9500 | n/a | 1.0000 |
| single-session-preference | 20 | 0.3000 | n/a | 0.2500 |
| single-session-user | 20 | 0.5000 | n/a | 0.8500 |
| temporal-reasoning | 20 | 0.1000 | n/a | 0.6842 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
