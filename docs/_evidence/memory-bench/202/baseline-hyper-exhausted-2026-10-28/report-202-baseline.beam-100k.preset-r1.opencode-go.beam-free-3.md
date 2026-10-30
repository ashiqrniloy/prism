# Memory benchmark: beam-100k / fabric-x-tools

Status: running. Input: 1966826; cache read: 302656; ratio: 0.1539.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@3; usage complete: true; resumed results: 21.
Tool calls: 63 (2.63/q); recall calls: 26; snippet tokens: 143962; recall@k: 0.6667.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.

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

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
