# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 215717; cache read: 28032; ratio: 0.1299.
Attempt: accept1889-baseline@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 99; snippet tokens: 56050; recall@k: 0.9072.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1738723.5 ms at concurrency 4 (initial 4); questions p50 47690.3 ms / p95 190198.7 ms; injection-label 208x p50 10617.3ms, judge 301x p50 5073.4ms, solver 99x p50 7740ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 20 | 0.4500 | n/a | 1.0000 | 0.39473684210526316 | 0.05263157894736842 | 0.0000 |
| multi-session | 20 | 0.1500 | n/a | 0.8000 | 0.17916666666666667 | 0 | 0.0000 |
| temporal-reasoning | 20 | 0.2500 | n/a | 0.7222 | 0.4074074074074074 | 0.3333333333333333 | 0.0000 |
| single-session-user | 20 | 0.8500 | n/a | 1.0000 | 0.85 | 0.85 | 0.0000 |
| single-session-assistant | 20 | 0.8500 | n/a | 1.0000 | 0.85 | 0.85 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
