# Memory benchmark: locomo / full-truncated

Status: failed. Input: 251582; cache read: 219392; ratio: 0.8720.
Attempt: 202-baseline.locomo.full-truncated.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 26514.6 ms at concurrency 6 (initial 6); questions p50 12578.4 ms / p95 24663.7 ms; judge 6x p50 345.2ms, solver 6x p50 2945.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
