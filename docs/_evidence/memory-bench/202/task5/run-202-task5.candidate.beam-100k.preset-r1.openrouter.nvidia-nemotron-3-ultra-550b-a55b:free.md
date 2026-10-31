# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1601646; cache read: 159840; ratio: 0.0998.
Attempt: 202-task5.candidate.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 62 (1.55/q); recall calls: 100; snippet tokens: 201527; recall@k: 0.6389.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2422927.8 ms at concurrency 1 (initial 1); end-to-end questions p50 42581.3 ms / p95 180468.7 ms; ingestion n=40 p50/p95/mean 367/607.7/402.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 19377.9/143331.8/35313.4 ms; evaluation n=40 p50/p95/mean 17787.5/67684.3/24758.4 ms; judge 90x p50 9518ms, solver 100x p50 7590.5ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.14166666666666666 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.7500 | 0.75 | 0.75 | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | 0.75 | 0.5 | 0.0000 |
| multi_session_reasoning | 4 | 0.5000 | n/a | 0.7500 | 0.43333333333333335 | 0.25 | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | 0.2500 | 0.08333333333333333 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.2500 |
| temporal_reasoning | 4 | 0.7500 | n/a | 1.0000 | 1 | 1 | 0.2500 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.2759 | 0.0000 | 0.2500 |
| summarization | 4 | 0.2167 | 0.0000 | 0.3333 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
