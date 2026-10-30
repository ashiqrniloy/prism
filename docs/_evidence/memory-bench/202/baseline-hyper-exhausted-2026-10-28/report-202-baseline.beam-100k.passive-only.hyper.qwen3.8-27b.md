# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 43048; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.beam-100k.passive-only.hyper.qwen3.8-27b@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 5; snippet tokens: 17921; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 136551.5 ms at concurrency 8 (initial 8); questions p50 65469.3 ms / p95 134713.1 ms; injection-label 31x p50 46768.1ms, judge 37x p50 988.6ms, solver 8x p50 9563.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
