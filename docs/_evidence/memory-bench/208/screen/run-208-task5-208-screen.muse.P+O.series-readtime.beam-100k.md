# Memory benchmark: beam-100k / fabric-x-tools

Status: completed. Input: 1125366; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-readtime.beam-100k@1; usage complete: true; resumed results: 0.
Tool calls: 16 (1.78/q); recall calls: 14; snippet tokens: 51569; recall@k: 0.6667.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 419367.7 ms at concurrency 1 (initial 1); end-to-end questions p50 44014.7 ms / p95 72340.6 ms; ingestion n=9 p50/p95/mean 15236.3/36538/21047.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=9 p50/p95/mean 7.9/11.5/8.2 ms; answer n=9 p50/p95/mean 10494.8/13806/9910.6 ms; evaluation n=9 p50/p95/mean 9189.6/42963.9/15449.9 ms; curator 1x p50 10293.3ms, judge 22x p50 4646.1ms, solver 76x p50 3207.6ms.
USD: campaign 0.120111; product measured/cold/warm 0.118876/0.118876/0.118876; evaluation 0.
Ontology (P+O.series-readtime.muse): 9 histories; 1 concepts, 12 claims (12.00 per concept); bound-note share 0.004; 1 passes, 1 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 8/11/11 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":6,"none":3}.
Curator (product-ontology): 1 exchanges; input 6818, output 2765, cache read 0, cache write 0; measured USD 0.001235.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 1.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| multi_session_reasoning | 2 | 0.0000 | n/a | 1.0000 | 0.35 | 0 | 0.0000 |
| summarization | 3 | 0.0000 | n/a | 0.3333 | 0.05555555555555555 | 0 | 0.0000 |
| temporal_reasoning | 2 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| summarization | 3 | 0.1500 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
