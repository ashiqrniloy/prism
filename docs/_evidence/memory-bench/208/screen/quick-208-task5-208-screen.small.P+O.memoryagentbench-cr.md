# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 634824; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P+O.memoryagentbench-cr@1; usage complete: false; resumed results: 0.
Tool calls: 34 (4.25/q); recall calls: 40; snippet tokens: 27951; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1357595.3 ms at concurrency 1 (initial 1); end-to-end questions p50 115265 ms / p95 338034.4 ms; ingestion n=8 p50/p95/mean 104252.3/305880.2/133678.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=6 p50/p95/mean 78233.9/141311.9/87159.9 ms; answer n=8 p50/p95/mean 20569.3/65453.8/29130.6 ms; evaluation n=8 p50/p95/mean 0.1/0.5/0.2 ms; curator 78x p50 10835.4ms, solver 42x p50 3011.4ms.
USD: campaign unknown; product measured/cold/warm 0.044553/0.044553/0.044553; evaluation 0.
Ontology (P+O.small): 8 histories; 24 concepts, 245 claims (10.21 per concept); bound-note share 0.014; 23 passes, 75 model calls, 11 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 39947/141312/141312 ms (not in answer latency), 2 timeouts; concept stage {"concept":1,"note":7,"none":0}.
Curator (product-ontology): 81 exchanges; input 218924, output 212566, cache read 0, cache write 0; measured USD unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
