# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 40725; cache read: 384; ratio: 0.0094.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 6; snippet tokens: 23024; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 139899 ms at concurrency 4 (initial 4); questions p50 64435.2 ms / p95 110476.6 ms; injection-label 28x p50 27483.5ms, judge 41x p50 1062.6ms, solver 7x p50 3638.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
