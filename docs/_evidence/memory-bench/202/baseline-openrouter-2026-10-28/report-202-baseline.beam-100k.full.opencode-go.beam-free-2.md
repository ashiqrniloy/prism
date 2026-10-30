# Memory benchmark: beam-100k / full

Status: failed. Input: 938260; cache read: 937984; ratio: 0.9997.
Attempt: 202-baseline.beam-100k.full.opencode-go.beam-free@2; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 37751.5 ms at concurrency 1 (initial 4); questions p50 34149.6 ms / p95 36070 ms; judge 32x p50 1802.7ms, solver 4x p50 2979.1ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
