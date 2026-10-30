# Memory benchmark: locomo / lexical-topk

Status: failed. Input: 5661; cache read: 320; ratio: 0.0565.
Attempt: 202-baseline.locomo.lexical-topk.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 24943.5 ms at concurrency 6 (initial 6); questions p50 11378.1 ms / p95 23347.6 ms; judge 6x p50 375.5ms, solver 6x p50 1713.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
