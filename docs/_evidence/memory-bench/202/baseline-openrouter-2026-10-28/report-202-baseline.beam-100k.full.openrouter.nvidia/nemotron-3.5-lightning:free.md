# Memory benchmark: beam-100k / full

Status: failed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.beam-100k.full.openrouter.nvidia/nemotron-3.5-lightning:free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 59174.4 ms at concurrency 1 (initial 4); questions p50 14380.1 ms / p95 15394.1 ms; solver 14x p50 1144.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 3 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
