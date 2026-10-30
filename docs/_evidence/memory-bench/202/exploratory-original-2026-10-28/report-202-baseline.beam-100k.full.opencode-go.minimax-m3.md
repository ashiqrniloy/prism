# Memory benchmark: beam-100k / full

Status: failed. Input: 1929533; cache read: 380301; ratio: 0.1971.
Attempt: 202-baseline.beam-100k.full.opencode-go.minimax-m3@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: opencode-go/qwen3.7-plus. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 232454.6 ms at concurrency 1 (initial 10); questions p50 45512.1 ms / p95 206798.3 ms; judge 80x p50 2047.5ms, solver 21x p50 4445.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
