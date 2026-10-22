# Memory benchmark: synthetic / full

Status: completed. Input: 6694; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: mock/synthetic-judge. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 1 | 1.0000 | n/a | n/a |
| multi-session | 1 | 1.0000 | n/a | n/a |
| single-session-assistant | 1 | 1.0000 | n/a | n/a |
| single-session-preference | 1 | 1.0000 | n/a | n/a |
| single-session-user | 1 | 1.0000 | n/a | n/a |
| temporal-reasoning | 1 | 1.0000 | n/a | n/a |
| abstention | 1 | 1.0000 | n/a | n/a |
| single-hop | 1 | 1.0000 | 1 | n/a |
| multi-hop | 1 | 1.0000 | 1 | n/a |
| temporal | 1 | 1.0000 | 1 | n/a |
| open-domain | 1 | 1.0000 | 1 | n/a |
| adversarial | 1 | 1.0000 | 1 | n/a |
| conflict-resolution-single-hop | 1 | 1.0000 | n/a | n/a |
| conflict-resolution-multi-hop | 1 | 1.0000 | n/a | n/a |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
