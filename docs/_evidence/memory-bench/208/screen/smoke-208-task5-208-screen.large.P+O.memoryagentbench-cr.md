# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 40236; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.large.P+O.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 2; snippet tokens: 698; recall@k: 1.0000.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 185543.8 ms at concurrency 1 (initial 1); end-to-end questions p50 62040.7 ms / p95 120026.7 ms; ingestion n=2 p50/p95/mean 55725.8/115143.7/85434.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=2 p50/p95/mean 155.3/25401.2/12778.3 ms; answer n=2 p50/p95/mean 4496.5/5957.1/5226.8 ms; evaluation n=2 p50/p95/mean 0.1/0.5/0.3 ms; curator 11x p50 8071.6ms, solver 2x p50 4214.1ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.
Ontology (P+O.large): 2 histories; 1 concepts, 17 claims (17.00 per concept); bound-note share 0.004; 3 passes, 11 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 155/25401/25401 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":2,"none":0}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 2 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
