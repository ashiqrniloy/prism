# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1855245; cache read: 379883; ratio: 0.2048.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.minimax-m3@1; usage complete: true; resumed results: 0.
Tool calls: 113 (2.83/q); recall calls: 40; snippet tokens: 207977; recall@k: 0.3333.
Judge: opencode-go/qwen3.7-plus. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1787603.9 ms at concurrency 10 (initial 10); questions p50 376012.4 ms / p95 642630.8 ms; injection-label 405x p50 152595.5ms, judge 483x p50 7557.5ms, solver 94x p50 3442ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 0.3333 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
