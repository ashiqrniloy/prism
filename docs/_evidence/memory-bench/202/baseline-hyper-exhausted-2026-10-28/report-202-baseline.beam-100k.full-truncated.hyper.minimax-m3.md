# Memory benchmark: beam-100k / full-truncated

Status: completed. Input: 5282768; cache read: 5236198; ratio: 0.9912.
Attempt: 202-baseline.beam-100k.full-truncated.hyper.minimax-m3@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 168897.8 ms at concurrency 8 (initial 8); questions p50 32797.1 ms / p95 45291.4 ms; judge 76x p50 1796.1ms, solver 40x p50 4643ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
