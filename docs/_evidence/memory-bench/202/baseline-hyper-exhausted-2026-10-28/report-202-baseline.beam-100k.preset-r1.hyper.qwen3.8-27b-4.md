# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 332976; cache read: 48000; ratio: 0.1442.
Attempt: 202-baseline.beam-100k.preset-r1.hyper.qwen3.8-27b@4; usage complete: true; resumed results: 0.
Tool calls: 13 (0.93/q); recall calls: 13; snippet tokens: 58336; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 567931.2 ms at concurrency 6 (initial 6); questions p50 220050.8 ms / p95 347584 ms; injection-label 120x p50 57395.4ms, judge 147x p50 1032.6ms, solver 28x p50 10621.6ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 2 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
