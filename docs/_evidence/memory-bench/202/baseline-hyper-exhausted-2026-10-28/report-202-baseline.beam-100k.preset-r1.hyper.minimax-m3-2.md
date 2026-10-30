# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1896045; cache read: 1058173; ratio: 0.5581.
Attempt: 202-baseline.beam-100k.preset-r1.hyper.minimax-m3@2; usage complete: true; resumed results: 0.
Tool calls: 150 (3.75/q); recall calls: 42; snippet tokens: 214063; recall@k: 0.6667.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1977729.2 ms at concurrency 4 (initial 4); questions p50 173158.4 ms / p95 402284.7 ms; injection-label 449x p50 51473.5ms, judge 522x p50 966.1ms, solver 129x p50 1638.3ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.2500 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.6667 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.5000 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
