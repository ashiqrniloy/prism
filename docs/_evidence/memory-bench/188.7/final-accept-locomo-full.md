# Memory benchmark: locomo / full

Status: failed. Input: 4598896; cache read: 4360704; ratio: 0.9482.
Attempt: accept-locomo-full@2; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| open-domain | 13 | 0.7692 | 0.09768489030352663 | n/a |
| temporal | 34 | 0.6471 | 0.07949505274400885 | n/a |
| multi-hop | 20 | 0.8500 | 0.25710163440332934 | n/a |
| single-hop | 35 | 0.9143 | 0.1819614578157758 | n/a |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
