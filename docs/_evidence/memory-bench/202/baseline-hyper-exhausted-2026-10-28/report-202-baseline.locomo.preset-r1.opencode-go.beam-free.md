# Memory benchmark: locomo / fabric-x-tools

Status: running. Input: 639952; cache read: 164224; ratio: 0.2566.
Attempt: 202-baseline.locomo.preset-r1.opencode-go.beam-free@1; usage complete: true; resumed results: 0.
Tool calls: 32 (4.00/q); recall calls: 7; snippet tokens: 27407; recall@k: 1.0000.
Judge: hyper/glm-5.3-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 8 | 0.1250 | 0.07352941176470588 | 1.0000 | 0.8857142857142858 | 0.8 | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
