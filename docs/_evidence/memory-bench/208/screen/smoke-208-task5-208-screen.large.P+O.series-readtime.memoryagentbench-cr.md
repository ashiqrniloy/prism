# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 46386; cache read: 4384; ratio: 0.0945.
Attempt: 208-screen.large.P+O.series-readtime.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 1 (0.50/q); recall calls: 1; snippet tokens: 1559; recall@k: 1.0000.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 196053.8 ms at concurrency 1 (initial 1); end-to-end questions p50 82818.7 ms / p95 111123.6 ms; ingestion n=2 p50/p95/mean 68895.9/75236.3/72066.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=2 p50/p95/mean 30.2/37.2/33.7 ms; answer n=2 p50/p95/mean 13487.3/35467.2/24477.3 ms; evaluation n=2 p50/p95/mean 0.4/0.8/0.6 ms; solver 8x p50 8615ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.
Ontology (P+O.series-readtime.large): 2 histories; 0 concepts, 0 claims (n/a per concept); bound-note share 0.000; 0 passes, 0 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 30/37/37 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":2,"none":0}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 2 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
