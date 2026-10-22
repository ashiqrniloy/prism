# Memory benchmark: longmemeval-s / fabric-agentic

Status: failed. Input: 294925; cache read: 202432; ratio: 0.6864.
Attempt: accept-lme-fabric-agentic@1; usage complete: true; resumed results: 0.
Tool calls: 13 (6.50/q); recall calls: 12; snippet tokens: 985; recall@k: 0.5000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 1.0000 | n/a | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
