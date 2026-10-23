# Memory benchmark: longmemeval-s / fabric

Status: failed. Input: 35000; cache read: 7552; ratio: 0.2158.
Attempt: accept1888-prefix@2; usage complete: true; resumed results: 8.
Tool calls: 0 (0.00/q); recall calls: 15; snippet tokens: 9157; recall@k: 1.0000.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 15 | 0.4000 | n/a | 1.0000 | 0.4 | 0.06666666666666667 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
