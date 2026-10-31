# Memory benchmark: beam-100k / fabric-x-tools

Status: running. Input: 272170; cache read: 0; ratio: 0.0000.
Attempt: 202-task5.control.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 11 (0.79/q); recall calls: 23; snippet tokens: 61546; recall@k: 0.7000.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.07083333333333333 | 0 | 0.0000 |
| information_extraction | 2 | 1.0000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.1523 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
