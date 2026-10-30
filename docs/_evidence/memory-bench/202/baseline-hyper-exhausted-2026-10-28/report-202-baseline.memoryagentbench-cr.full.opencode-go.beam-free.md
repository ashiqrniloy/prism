# Memory benchmark: memoryagentbench-cr / full

Status: failed. Input: 1285232; cache read: 218752; ratio: 0.1702.
Attempt: 202-baseline.memoryagentbench-cr.full.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 7. Metric version: 2.
Phase: all. Timing: arm 473855 ms at concurrency 6 (initial 6); questions p50 146609.6 ms / p95 466485.9 ms; solver 12x p50 8754.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 9 | 0.2222 | n/a | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
