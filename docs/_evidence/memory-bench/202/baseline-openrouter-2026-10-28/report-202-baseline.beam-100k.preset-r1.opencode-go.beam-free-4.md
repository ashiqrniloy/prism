# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 562217; cache read: 110592; ratio: 0.1967.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@4; usage complete: true; resumed results: 4.
Tool calls: 18 (3.60/q); recall calls: 6; snippet tokens: 32567; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 456121 ms at concurrency 1 (initial 4); questions p50 0.9 ms / p95 454384.3 ms; injection-label 94x p50 20569.2ms, judge 261x p50 2286.9ms, solver 8x p50 3154.3ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |
| contradiction_resolution | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
