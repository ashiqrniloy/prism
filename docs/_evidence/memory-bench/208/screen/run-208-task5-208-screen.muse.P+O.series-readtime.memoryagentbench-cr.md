# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: completed. Input: 992620; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-readtime.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 31 (4.43/q); recall calls: 27; snippet tokens: 24945; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 310319.3 ms at concurrency 1 (initial 1); end-to-end questions p50 35877.8 ms / p95 78404.4 ms; ingestion n=7 p50/p95/mean 25417.6/56977.7/30264.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=7 p50/p95/mean 27.5/62.7/34.1 ms; answer n=7 p50/p95/mean 14127.1/19644.4/13463.8 ms; evaluation n=7 p50/p95/mean 0.1/0.4/0.1 ms; solver 105x p50 2252.8ms.
USD: campaign 0.106105; product measured/cold/warm 0.106105/0.106105/0.106105; evaluation 0.
Ontology (P+O.series-readtime.muse): 7 histories; 0 concepts, 0 claims (n/a per concept); bound-note share 0.000; 0 passes, 0 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 27/63/63 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":7,"none":0}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 3 | 0.6667 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
