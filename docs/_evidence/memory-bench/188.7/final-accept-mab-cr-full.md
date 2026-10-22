# Memory benchmark: memoryagentbench-cr / full

Status: completed. Input: 11032677; cache read: 6838848; ratio: 0.6199.
Attempt: accept-mab-cr-full@2; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 10. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 20 | 0.8000 | n/a | n/a |
| conflict-resolution-multi-hop | 20 | 0.1000 | n/a | n/a |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
