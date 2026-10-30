# Memory benchmark: beam-100k / fabric-x

Status: failed. Input: 80723; cache read: 2137; ratio: 0.0265.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.mimo-v2.5@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 11; snippet tokens: 39534; recall@k: n/a.
Judge: opencode-go/deepseek-v4-pro. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 440325.6 ms at concurrency 1 (initial 4); questions p50 116937.7 ms / p95 191814.3 ms; injection-label 55x p50 8179.9ms, judge 81x p50 4987ms, solver 15x p50 6125.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 3 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
