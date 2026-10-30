# Memory benchmark: beam-100k / full

Status: running. Input: 5312654; cache read: 3378176; ratio: 0.6359.
Attempt: 202-baseline.beam-100k.full.opencode-go.beam-free@4; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 31. Metric version: 2.
Phase: all. Timing: not recorded.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 2 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
