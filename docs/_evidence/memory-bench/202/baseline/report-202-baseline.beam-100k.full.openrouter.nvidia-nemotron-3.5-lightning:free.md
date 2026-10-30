# Memory benchmark: beam-100k / full

Status: completed. Input: 5655195; cache read: 1328864; ratio: 0.2350.
Attempt: 202-baseline.beam-100k.full.openrouter.nvidia/nemotron-3.5-lightning:free@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4655083.6 ms at concurrency 1 (initial 1); end-to-end questions p50 116936.1 ms / p95 283986.2 ms; ingestion n=40 p50/p95/mean 6.5/10.3/7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 96194.8/264681.8/98299.9 ms; evaluation n=40 p50/p95/mean 14518.8/38886.3/18015.1 ms; judge 92x p50 6994ms, solver 40x p50 96176.6ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| information_extraction | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| knowledge_update | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| multi_session_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| preference_following | 4 | 0.2500 | n/a | n/a | n/a | n/a | 0.0000 |
| summarization | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| temporal_reasoning | 4 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.0000 | 0.0000 | 0.0000 |
| summarization | 4 | 0.0000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
