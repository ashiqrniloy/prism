# Memory benchmark: beam-100k / fabric-x-tools

Status: failed. Input: 199094; cache read: 0; ratio: 0.0000.
Attempt: 202-task5.candidate.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 8 (0.89/q); recall calls: 16; snippet tokens: 44606; recall@k: 1.0000.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 521568.6 ms at concurrency 1 (initial 1); end-to-end questions p50 29710.7 ms / p95 218926.6 ms; ingestion n=9 p50/p95/mean 313.7/429.6/339.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=9 p50/p95/mean 16538.7/53609.1/23310.5 ms; evaluation n=9 p50/p95/mean 15565.2/165679.2/32362.5 ms; judge 21x p50 9868.9ms, solver 20x p50 6620.2ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.4 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.1415 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
