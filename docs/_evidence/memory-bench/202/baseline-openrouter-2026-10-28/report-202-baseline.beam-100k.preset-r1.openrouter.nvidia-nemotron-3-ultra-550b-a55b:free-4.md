# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 508742; cache read: 47520; ratio: 0.0934.
Attempt: 202-baseline.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@4; usage complete: true; resumed results: 1.
Tool calls: 8 (8.00/q); recall calls: 2; snippet tokens: 13178; recall@k: n/a.
Judge: hyper/qwen3.8-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 20332.6 ms at concurrency 1 (initial 4); questions p50 15940.2 ms / p95 17493.6 ms; solver 12x p50 834.6ms.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 0.0000 | n/a | n/a | n/a | n/a | 1.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
