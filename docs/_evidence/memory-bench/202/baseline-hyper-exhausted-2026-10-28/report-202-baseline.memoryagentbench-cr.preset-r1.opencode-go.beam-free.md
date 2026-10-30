# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: failed. Input: 26269; cache read: 13696; ratio: 0.5214.
Attempt: 202-baseline.memoryagentbench-cr.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 60146 ms at concurrency 6 (initial 6); questions p50 14642.3 ms / p95 58616.7 ms; injection-label 15x p50 22850ms, judge 15x p50 344.6ms, solver 20x p50 1311.7ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
