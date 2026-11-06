# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 679578; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P+W.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 27 (2.70/q); recall calls: 27; snippet tokens: 72611; recall@k: 0.7778.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 266839.9 ms at concurrency 1 (initial 1); end-to-end questions p50 20084.1 ms / p95 66435.9 ms; ingestion n=10 p50/p95/mean 422.6/496/421.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 13714.2/34442/16547.4 ms; evaluation n=10 p50/p95/mean 4630/31440.5/9592.2 ms; judge 24x p50 2633.9ms, solver 37x p50 3931.2ms.
USD: campaign 0.07014; product measured/cold/warm 0.07014/0.07014/0.07014; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.4 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| knowledge_update | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.6666666666666666 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.1200 | 0.0000 | 0.0000 |
| summarization | 1 | 0.1000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
