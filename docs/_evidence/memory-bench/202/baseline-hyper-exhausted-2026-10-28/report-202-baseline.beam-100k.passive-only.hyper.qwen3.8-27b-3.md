# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 35616; cache read: 256; ratio: 0.0072.
Attempt: 202-baseline.beam-100k.passive-only.hyper.qwen3.8-27b@3; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 5; snippet tokens: 18575; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 123807.6 ms at concurrency 6 (initial 6); questions p50 71017.8 ms / p95 122938.5 ms; injection-label 23x p50 49046ms, judge 33x p50 1106.9ms, solver 6x p50 10097.2ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
