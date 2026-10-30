# Memory benchmark: beam-100k / full-truncated

Status: failed. Input: 3758870; cache read: 3737541; ratio: 0.9943.
Attempt: 202-baseline.beam-100k.full-truncated.opencode-go.mimo-v2.5@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/deepseek-v4-pro. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 430293.1 ms at concurrency 1 (initial 4); questions p50 49793 ms / p95 140806.6 ms; judge 56x p50 3192.2ms, solver 28x p50 16979.8ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
