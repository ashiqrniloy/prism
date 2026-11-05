# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 142594; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-readtime.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 5 (2.50/q); recall calls: 5; snippet tokens: 3267; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 64087.8 ms at concurrency 1 (initial 1); end-to-end questions p50 27529.2 ms / p95 35870.2 ms; ingestion n=2 p50/p95/mean 18542.3/28114.6/23328.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=2 p50/p95/mean 24.1/29.1/26.6 ms; answer n=2 p50/p95/mean 7174.9/8835.2/8005.1 ms; evaluation n=2 p50/p95/mean 0.1/0.6/0.4 ms; solver 20x p50 2463.7ms.
USD: campaign 0.015712; product measured/cold/warm 0.015712/0.015712/0.015712; evaluation 0.
Ontology (P+O.series-readtime.muse): 2 histories; 0 concepts, 0 claims (n/a per concept); bound-note share 0.000; 0 passes, 0 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 24/29/29 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":2,"none":0}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 2 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
