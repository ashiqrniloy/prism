# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 142177; cache read: 1856; ratio: 0.0131.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.beam-free@4; usage complete: true; resumed results: 13.
Tool calls: 0 (0.00/q); recall calls: 13; snippet tokens: 47110; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 184841.4 ms at concurrency 1 (initial 4); questions p50 0 ms / p95 183084.5 ms; injection-label 12x p50 66424.5ms, judge 116x p50 1815.7ms, solver 4x p50 1777.7ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
