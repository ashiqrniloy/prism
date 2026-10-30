# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 1701263; cache read: 262144; ratio: 0.1541.
Attempt: 202-baseline.beam-100k.preset-r1.hyper.qwen3.8-27b@2; usage complete: true; resumed results: 9.
Tool calls: 68 (1.74/q); recall calls: 38; snippet tokens: 193022; recall@k: 0.6667.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 3335635.1 ms at concurrency 1 (initial 4); questions p50 74190 ms / p95 545035.2 ms; injection-label 344x p50 15868.1ms, judge 414x p50 982.1ms, solver 81x p50 9497ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.2500 |
| instruction_following | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.6667 | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 3 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
