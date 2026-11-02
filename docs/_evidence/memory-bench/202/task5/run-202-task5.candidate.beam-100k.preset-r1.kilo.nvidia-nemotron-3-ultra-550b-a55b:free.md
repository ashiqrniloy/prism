# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1553659; cache read: 259200; ratio: 0.1668.
Attempt: 202-task5.candidate.beam-100k.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: false; resumed results: 0.
Tool calls: 55 (1.38/q); recall calls: 93; snippet tokens: 204447; recall@k: 0.6944.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4686756.1 ms at concurrency 1 (initial 1); end-to-end questions p50 100100.6 ms / p95 213782.6 ms; ingestion n=40 p50/p95/mean 324/428.4/327.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 57734/184238.2/70552.6 ms; evaluation n=40 p50/p95/mean 34806.9/103012.4/46120.3 ms; judge 93x p50 11217.2ms, solver 93x p50 22853.7ms.
USD: campaign unknown; product measured/cold/warm 0/0/0; evaluation unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.14166666666666666 | 0 | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.7500 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 1.0000 | 0.75 | 0.5 | 0.2500 |
| multi_session_reasoning | 4 | 0.2500 | n/a | 1.0000 | 0.4333333333333333 | 0.25 | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | 0.2500 | 0.08333333333333333 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.5000 | 0.10416666666666666 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | 1.0000 | 1 | 1 | 0.2500 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.1884 | 0.0000 | 0.0000 |
| summarization | 4 | 0.2625 | 0.0000 | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
