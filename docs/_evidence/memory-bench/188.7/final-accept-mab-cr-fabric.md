# Memory benchmark: memoryagentbench-cr / fabric

Status: completed. Input: 82309; cache read: 1280; ratio: 0.0156.
Attempt: accept-mab-cr-fabric@2; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 40; snippet tokens: 5409; recall@k: 0.5000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 20 | 0.9000 | n/a | 1.0000 |
| conflict-resolution-multi-hop | 20 | 0.0000 | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
