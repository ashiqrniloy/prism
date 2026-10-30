# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1369671; cache read: 320688; ratio: 0.2341.
Attempt: 202-baseline.beam-100k.preset-r1.openrouter.nvidia/nemotron-3.5-lightning:free@1; usage complete: true; resumed results: 0.
Tool calls: 89 (2.23/q); recall calls: 96; snippet tokens: 189369; recall@k: 0.6389.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 3263287.7 ms at concurrency 1 (initial 1); end-to-end questions p50 57084.9 ms / p95 270557 ms; ingestion n=40 p50/p95/mean 315.9/960.5/390.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 34830.6/150193.2/51723.5 ms; evaluation n=40 p50/p95/mean 16492.8/93185.7/29383.8 ms; judge 90x p50 10137.4ms, solver 127x p50 7368.9ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.07083333333333333 | 0 | 0.2500 |
| information_extraction | 4 | 0.5000 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 1.0000 | 0.875 | 0.75 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.5000 | 0.225 | 0 | 0.2500 |
| preference_following | 4 | 0.2500 | n/a | 0.5000 | 0.3333333333333333 | 0.25 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.7500 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.1573 | 0.0000 | 0.0000 |
| summarization | 4 | 0.2375 | 0.0000 | 0.2500 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
