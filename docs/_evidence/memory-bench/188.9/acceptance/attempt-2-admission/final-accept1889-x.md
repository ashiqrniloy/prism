# Memory benchmark: longmemeval-s / fabric-x

Status: running. Input: 194768; cache read: 1472; ratio: 0.0076.
Attempt: accept1889-x@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 27; snippet tokens: 100545; recall@k: 0.9630.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.9500 | n/a | 1.0000 | 0.925 | 0.85 | 0.0000 |
| multi-session | 7 | 0.4286 | n/a | 0.8571 | 0.4880952380952381 | 0.2857142857142857 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
