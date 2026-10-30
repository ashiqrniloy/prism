# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 562217; cache read: 110592; ratio: 0.1967.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@3; usage complete: true; resumed results: 4.
Tool calls: 17 (4.25/q); recall calls: 5; snippet tokens: 27738; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 37525.1 ms at concurrency 1 (initial 4); questions p50 1 ms / p95 35839.9 ms; judge 32x p50 1773.5ms, solver 8x p50 1905.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
