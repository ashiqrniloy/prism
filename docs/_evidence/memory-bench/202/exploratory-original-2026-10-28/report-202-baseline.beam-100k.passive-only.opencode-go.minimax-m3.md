# Memory benchmark: beam-100k / fabric-x

Status: completed. Input: 270634; cache read: 11935; ratio: 0.0441.
Attempt: 202-baseline.beam-100k.passive-only.opencode-go.minimax-m3@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 40; snippet tokens: 143675; recall@k: 0.3333.
Judge: opencode-go/qwen3.7-plus. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 918920.6 ms at concurrency 10 (initial 10); questions p50 225116.4 ms / p95 253405.1 ms; injection-label 187x p50 109568.1ms, judge 267x p50 7454.8ms, solver 40x p50 2786.7ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 0.3333 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
