# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 431896; cache read: 86848; ratio: 0.2011.
Attempt: 202-baseline.beam-100k.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 17 (4.25/q); recall calls: 5; snippet tokens: 27738; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 159791.7 ms at concurrency 1 (initial 4); questions p50 62272.3 ms / p95 123067.3 ms; injection-label 56x p50 18625ms, judge 138x p50 2227.7ms, solver 27x p50 2002.5ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
