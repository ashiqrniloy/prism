# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 864678; cache read: 4320; ratio: 0.0050.
Attempt: 202-task5.control.beam-100k.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 42 (1.27/q); recall calls: 71; snippet tokens: 173665; recall@k: 0.6207.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 3967608.3 ms at concurrency 1 (initial 1); end-to-end questions p50 95332.8 ms / p95 213153.8 ms; ingestion n=33 p50/p95/mean 293.9/383.1/293.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=33 p50/p95/mean 53605.8/146057.7/69314.2 ms; evaluation n=32 p50/p95/mean 35827.1/141181/48318 ms; judge 77x p50 10944.4ms, solver 75x p50 22792ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.09166666666666667 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.5000 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | 0.75 | 0.5 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.7500 | 0.30833333333333335 | 0 | 0.0000 |
| preference_following | 4 | 0.7500 | n/a | 0.2500 | 0.16666666666666666 | 0 | 0.0000 |
| summarization | 1 | n/a | n/a | 1.0000 | 0.16666666666666666 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.3090 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
