# Memory benchmark: longmemeval-s / fabric-agentic

Status: completed. Input: 5438935; cache read: 3498496; ratio: 0.6432.
Attempt: accept1888-agentic@1; usage complete: false; resumed results: 0.
Tool calls: 677 (6.77/q); recall calls: 385; snippet tokens: 20073; recall@k: 0.3608.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.2000 | n/a | 0.4211 | 0.23684210526315788 | 0.10526315789473684 | 0.1500 |
| multi-session | 20 | 0.2000 | n/a | 0.3500 | 0.16999999999999998 | 0.05 | 0.3000 |
| temporal-reasoning | 20 | 0.4000 | n/a | 0.3889 | 0.2777777777777778 | 0.2777777777777778 | 0.2500 |
| single-session-user | 20 | 0.4500 | n/a | 0.4000 | 0.35 | 0.35 | 0.1000 |
| single-session-assistant | 20 | 0.6500 | n/a | 0.2500 | 0.25 | 0.25 | 0.1000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
