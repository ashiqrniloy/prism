# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 249108; cache read: 17536; ratio: 0.0704.
Attempt: 208-screen.large.P+O.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 10 (1.25/q); recall calls: 18; snippet tokens: 6241; recall@k: 0.7500.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1572227.3 ms at concurrency 1 (initial 1); end-to-end questions p50 177002.7 ms / p95 338570 ms; ingestion n=8 p50/p95/mean 83424.9/305992.8/139964.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=5 p50/p95/mean 193.6/168793.6/56994.5 ms; answer n=8 p50/p95/mean 33171.9/102791.9/46982.8 ms; evaluation n=8 p50/p95/mean 0.1/0.3/0.1 ms; curator 47x p50 19351.5ms, solver 18x p50 19058.8ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.
Ontology (P+O.large): 8 histories; 7 concepts, 75 claims (10.71 per concept); bound-note share 0.006; 11 passes, 43 model calls, 2 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 89/168793/168793 ms (not in answer latency), 1 timeouts; concept stage {"concept":0,"note":6,"none":2}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 0.5000 | n/a | 0.5000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
