# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 3478272; cache read: 686976; ratio: 0.1975.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@4; usage complete: true; resumed results: 24.
Tool calls: 116 (2.90/q); recall calls: 44; snippet tokens: 250317; recall@k: 0.6667.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1666162.9 ms at concurrency 1 (initial 4); questions p50 0 ms / p95 651532.3 ms; injection-label 235x p50 17120.8ms, judge 365x p50 1679ms, solver 67x p50 1852.9ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.2500 |
| contradiction_resolution | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.2500 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.6667 | n/a | n/a | 0.2500 |
| multi_session_reasoning | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
