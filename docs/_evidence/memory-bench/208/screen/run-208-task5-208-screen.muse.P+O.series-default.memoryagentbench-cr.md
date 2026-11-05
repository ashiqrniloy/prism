# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: completed. Input: 1087094; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-default.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 31 (4.43/q); recall calls: 30; snippet tokens: 20344; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1425082.7 ms at concurrency 1 (initial 1); end-to-end questions p50 190608.5 ms / p95 420212.2 ms; ingestion n=7 p50/p95/mean 176055.7/412911.1/191161.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=7 p50/p95/mean 70759/155724.3/76910.5 ms; answer n=7 p50/p95/mean 12184.9/16541.8/11873.5 ms; evaluation n=7 p50/p95/mean 0.1/0.5/0.2 ms; curator 80x p50 12234.1ms, solver 95x p50 2471.2ms.
USD: campaign 0.160071; product measured/cold/warm 0.092877/0.092877/0.092877; evaluation 0.
Ontology (P+O.series-default.muse): 7 histories; 22 concepts, 208 claims (9.45 per concept); bound-note share 0.016; 25 passes, 80 model calls, 15 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 70759/155724/155724 ms (not in answer latency), 3 timeouts; concept stage {"concept":0,"note":7,"none":0}.
Curator (product-ontology): 80 exchanges; input 224118, output 223894, cache read 0, cache write 0; measured USD 0.067194.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 3 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
