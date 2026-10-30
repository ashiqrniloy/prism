# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 251228; cache read: 29952; ratio: 0.1192.
Attempt: 202-baseline.beam-100k.preset-r1.hyper.qwen3.8-27b@1; usage complete: true; resumed results: 0.
Tool calls: 8 (0.89/q); recall calls: 7; snippet tokens: 32228; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 368871.3 ms at concurrency 8 (initial 8); questions p50 102445.6 ms / p95 323264.7 ms; injection-label 87x p50 67434.6ms, judge 97x p50 840.7ms, solver 19x p50 13014.8ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
