# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 249736; cache read: 36352; ratio: 0.1456.
Attempt: accept1888-postfix@2; usage complete: true; resumed results: 8.
Tool calls: 0 (0.00/q); recall calls: 99; snippet tokens: 60455; recall@k: 0.9072.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.4500 | n/a | 1.0000 | 0.47368421052631576 | 0.15789473684210525 | 0.0000 |
| multi-session | 20 | 0.2000 | n/a | 0.8000 | 0.2208333333333333 | 0 | 0.0000 |
| temporal-reasoning | 20 | 0.2000 | n/a | 0.7222 | 0.4074074074074074 | 0.3333333333333333 | 0.0000 |
| single-session-user | 20 | 0.7000 | n/a | 1.0000 | 0.95 | 0.95 | 0.0000 |
| single-session-assistant | 20 | 0.8000 | n/a | 1.0000 | 0.85 | 0.85 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
