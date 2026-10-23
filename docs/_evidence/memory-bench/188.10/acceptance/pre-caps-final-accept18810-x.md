# Memory benchmark: longmemeval-s / fabric-x

Status: failed. Input: 16610; cache read: 0; ratio: 0.0000.
Attempt: accept18810-x@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 23341.9 ms at concurrency 4 (initial 4); questions p50 18225.7 ms / p95 21222 ms; injection-label 18x p50 0.1ms, judge 11x p50 3113.6ms, solver 4x p50 3765.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
