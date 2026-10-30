# Memory benchmark: beam-100k / fabric-x

Status: completed. Input: 187967; cache read: 0; ratio: 0.0000.
Attempt: 202-baseline.beam-100k.passive-only.openrouter.nvidia/nemotron-3.5-lightning:free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 40; snippet tokens: 143675; recall@k: 0.4444.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2387034.2 ms at concurrency 1 (initial 1); end-to-end questions p50 38996.6 ms / p95 146596.2 ms; ingestion n=40 p50/p95/mean 268/366.9/272.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 20416.3/106118.7/32171.3 ms; evaluation n=40 p50/p95/mean 15854.4/75509.4/27162.3 ms; judge 96x p50 8793ms, solver 40x p50 20368.7ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.625 | 0.25 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.2500 | 0.020833333333333332 | 0 | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | 0.5000 | 0.5 | 0.5 | 0.0000 |
| instruction_following | 4 | 0.0000 | n/a | 0.2500 | 0.25 | 0.25 | 0.0000 |
| knowledge_update | 4 | 0.2500 | n/a | 0.7500 | 0.375 | 0 | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | 0.2500 | 0.1 | 0 | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.2500 | 0.041666666666666664 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.5000 | n/a | 0.7500 | 0.625 | 0.5 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.0915 | 0.0000 | 0.0000 |
| summarization | 4 | 0.1750 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
