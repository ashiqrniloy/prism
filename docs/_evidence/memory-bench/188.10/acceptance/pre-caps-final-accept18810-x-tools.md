# Memory benchmark: longmemeval-s / fabric-x-tools

Status: failed. Input: 2114975; cache read: 646912; ratio: 0.3059.
Attempt: accept18810-x-tools@1; usage complete: false; resumed results: 0.
Tool calls: 111 (1.41/q); recall calls: 75; snippet tokens: 381621; recall@k: 0.9859.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4209978.3 ms at concurrency 4 (initial 4); questions p50 174785.8 ms / p95 462353.7 ms; injection-label 1231x p50 18063ms, judge 1315x p50 5263.7ms, solver 171x p50 7298.3ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 40 | 0.6250 | n/a | 0.9750 | 0.8245833333333333 | 0.7 | 0.0000 |
| knowledge-update | 20 | 0.7500 | n/a | 1.0000 | 0.8947368421052632 | 0.8421052631578947 | 0.0000 |
| temporal-reasoning | 19 | 0.4737 | n/a | 1.0000 | 0.8333333333333334 | 0.8333333333333334 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
