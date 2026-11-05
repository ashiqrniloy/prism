# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 1806009; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P+O.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 4 (0.40/q); recall calls: 14; snippet tokens: 40055; recall@k: 0.6667.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4894119 ms at concurrency 1 (initial 1); end-to-end questions p50 430401 ms / p95 789647.8 ms; ingestion n=10 p50/p95/mean 316861.8/578838.6/374057 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=10 p50/p95/mean 2.6/3.8/2.8 ms; answer n=10 p50/p95/mean 36674.2/158828/67962.8 ms; evaluation n=10 p50/p95/mean 11235.1/42596.2/14367.4 ms; curator 57x p50 65780.3ms, judge 22x p50 5471.6ms, solver 14x p50 10209ms.
USD: campaign 0.133917; product measured/cold/warm 0.005432/0.005432/0.005432; evaluation 0.
Ontology (P+O.small): 10 histories; 33 concepts, 497 claims (15.06 per concept); bound-note share 0.718; 17 passes, 19 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 3/3/3 ms (not in answer latency), 10 timeouts; concept stage {"concept":0,"note":6,"none":4}.
Curator (product-ontology): 74 exchanges; input 1679745, output 600713, cache read 0, cache write 0; measured USD 0.128485.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.2 | 0 | 0.0000 |
| information_extraction | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| knowledge_update | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.0000 | 0.0000 | 0.0000 |
| summarization | 1 | 0.1000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
