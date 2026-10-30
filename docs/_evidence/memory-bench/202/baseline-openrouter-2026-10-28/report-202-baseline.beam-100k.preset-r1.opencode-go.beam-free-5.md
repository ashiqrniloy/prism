# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 2665707; cache read: 346752; ratio: 0.1301.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@5; usage complete: true; resumed results: 5.
Tool calls: 101 (2.52/q); recall calls: 43; snippet tokens: 243349; recall@k: 1.0000.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1844606.3 ms at concurrency 1 (initial 4); questions p50 62750.1 ms / p95 132996.1 ms; injection-label 532x p50 10683.3ms, judge 616x p50 6579.8ms, solver 116x p50 1941.7ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |
| contradiction_resolution | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.5000 |
| temporal_reasoning | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
