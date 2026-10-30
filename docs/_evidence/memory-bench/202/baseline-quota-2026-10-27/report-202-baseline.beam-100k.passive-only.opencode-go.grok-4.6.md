# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.grok-4.6@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/deepseek-v4-pro. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 10320.8 ms at concurrency 1 (initial 4); questions p50 6456.3 ms / p95 7925.8 ms; solver 4x p50 2266.8ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
