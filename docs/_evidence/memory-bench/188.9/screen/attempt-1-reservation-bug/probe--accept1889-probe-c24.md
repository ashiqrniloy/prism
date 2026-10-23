# Memory benchmark: longmemeval-s / fabric

Status: failed. Input: 9030; cache read: 3584; ratio: 0.3969.
Attempt: accept1889-probe-c24@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 15506.5 ms at concurrency 24 (initial 24); questions p50 1368.6 ms / p95 12618.7 ms; injection-label 17x p50 0.1ms, judge 4x p50 11.2ms, solver 2x p50 5051.9ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
