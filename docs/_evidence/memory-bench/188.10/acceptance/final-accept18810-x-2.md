# Memory benchmark: longmemeval-s / fabric-x

Status: completed. Input: 637815; cache read: 8192; ratio: 0.0128.
Attempt: accept18810-x@2; usage complete: true; resumed results: 4.
Tool calls: 0 (0.00/q); recall calls: 99; snippet tokens: 354138; recall@k: 0.9468.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2421008.9 ms at concurrency 2 (initial 2); questions p50 45433.5 ms / p95 97192.5 ms; injection-label 761x p50 5545.4ms, judge 857x p50 3527.8ms, solver 96x p50 5583.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-session | 40 | 0.2500 | n/a | 0.9231 | 0.5457264957264957 | 0.3333333333333333 | 0.0000 |
| knowledge-update | 20 | 0.7500 | n/a | 1.0000 | 0.825 | 0.7 | 0.0000 |
| temporal-reasoning | 20 | 0.3500 | n/a | 0.9333 | 0.6 | 0.6 | 0.0000 |
| single-session-user | 14 | 0.8571 | n/a | 0.9286 | 0.7857142857142857 | 0.7857142857142857 | 0.0000 |
| single-session-assistant | 6 | 0.8333 | n/a | 1.0000 | 0.8333333333333334 | 0.8333333333333334 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
