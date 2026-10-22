# Memory benchmark: longmemeval-s / om+fabric

Status: token-ceiling. Input: 3001610; cache read: 2142464; ratio: 0.7138.
Attempt: accept-lme-om+fabric@1; usage complete: true; resumed results: 0.
Tool calls: 1 (0.50/q); recall calls: 2; snippet tokens: 0; recall@k: 0.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 0.5000 | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
