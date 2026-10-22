# Memory benchmark: longmemeval-s / om

Status: running. Input: 2475590; cache read: 1696576; ratio: 0.6853.
Attempt: accept-lme-om@1; usage complete: true; resumed results: 0.
Tool calls: 1 (1.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 1.0000 | n/a | n/a |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
