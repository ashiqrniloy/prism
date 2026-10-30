# Memory benchmark: locomo / full-truncated

Status: failed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.locomo.full-truncated.opencode-go.qwen3.7-plus@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/deepseek-v4-pro. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4211.5 ms at concurrency 1 (initial 4); questions p50 2949.8 ms / p95 3261 ms; solver 4x p50 2711ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
