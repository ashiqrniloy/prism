# Memory benchmark: locomo / fabric-x-tools

Status: failed. Input: 213867; cache read: 36608; ratio: 0.1712.
Attempt: 202-baseline.locomo.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 8 (8.00/q); recall calls: 1; snippet tokens: 6746; recall@k: 1.0000.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 74261.5 ms at concurrency 1 (initial 4); questions p50 33546.2 ms / p95 41769.8 ms; judge 32x p50 1755.1ms, solver 20x p50 1248ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 1.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
