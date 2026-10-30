# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 3405257; cache read: 422621; ratio: 0.1241.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 130 (3.25/q); recall calls: 48; snippet tokens: 266781; recall@k: 1.0000.
Judge: opencode-go/qwen3.7-plus. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1928106 ms at concurrency 6 (initial 6); questions p50 232580.7 ms / p95 587498.4 ms; injection-label 443x p50 79106.4ms, judge 507x p50 7906.1ms, solver 161x p50 1827.8ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.5000 |
| contradiction_resolution | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.2500 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.2500 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.7500 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
