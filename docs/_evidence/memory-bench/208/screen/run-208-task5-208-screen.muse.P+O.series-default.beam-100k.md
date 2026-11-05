# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 6133021; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-default.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 15 (1.67/q); recall calls: 15; snippet tokens: 50063; recall@k: 0.6667.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 5764489.3 ms at concurrency 1 (initial 1); end-to-end questions p50 673855.4 ms / p95 918691.7 ms; ingestion n=9 p50/p95/mean 583196.5/816249.8/580563.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=9 p50/p95/mean 128918.7/173079.2/123059 ms; answer n=9 p50/p95/mean 45122.9/74857.4/40004.8 ms; evaluation n=9 p50/p95/mean 12538.9/39194.4/19739.5 ms; curator 206x p50 25141.6ms, judge 24x p50 5510.8ms, solver 77x p50 3257.1ms.
USD: campaign 0.879872; product measured/cold/warm 0.121367/0.121367/0.121367; evaluation 0.
Ontology (P+O.series-default.muse): 9 histories; 56 concepts, 814 claims (14.54 per concept); bound-note share 0.768; 109 passes, 201 model calls, 78 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 128919/173079/173079 ms (not in answer latency), 9 timeouts; concept stage {"concept":1,"note":6,"none":2}.
Curator (product-ontology): 207 exchanges; input 4989235, output 1297855, cache read 0, cache write 0; measured USD 0.758505.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| information_extraction | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 1.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| multi_session_reasoning | 2 | 0.0000 | n/a | 1.0000 | 0.35 | 0 | 0.0000 |
| summarization | 3 | 0.0000 | n/a | 0.3333 | 0.05555555555555555 | 0 | 0.0000 |
| temporal_reasoning | 2 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| summarization | 3 | 0.2833 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
