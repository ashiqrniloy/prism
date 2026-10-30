# Memory benchmark: beam-100k / fabric-x-tools

Status: running. Input: 1183108; cache read: 200832; ratio: 0.1697.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 41 (2.73/q); recall calls: 16; snippet tokens: 87247; recall@k: n/a.
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
| information_extraction | 3 | 0.6667 | n/a | n/a | n/a | n/a | 0.3333 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
