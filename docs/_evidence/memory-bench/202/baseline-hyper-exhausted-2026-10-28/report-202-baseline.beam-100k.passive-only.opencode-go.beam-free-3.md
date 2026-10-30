# Memory benchmark: beam-100k / fabric-x

Status: completed. Input: 251787; cache read: 3264; ratio: 0.0130.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.beam-free@3; usage complete: true; resumed results: 36.
Tool calls: 0 (0.00/q); recall calls: 40; snippet tokens: 143675; recall@k: 0.3333.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 306181.8 ms at concurrency 1 (initial 4); questions p50 0 ms / p95 269334.7 ms; injection-label 19x p50 108757.2ms, judge 32x p50 1349ms, solver 4x p50 5489.4ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 0.3333 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
