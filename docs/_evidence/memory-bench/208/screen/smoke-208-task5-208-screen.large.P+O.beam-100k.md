# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 606879; cache read: 223584; ratio: 0.3684.
Attempt: 208-screen.large.P+O.beam-100k@1; usage complete: false; resumed results: 0.
Tool calls: 11 (5.50/q); recall calls: 11; snippet tokens: 19766; recall@k: n/a.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1351750.3 ms at concurrency 1 (initial 1); end-to-end questions p50 483646.5 ms / p95 865060 ms; ingestion n=2 p50/p95/mean 275121.5/376447.4/325784.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=2 p50/p95/mean 2.5/3.4/3 ms; answer n=2 p50/p95/mean 82299.2/589907/336103.1 ms; evaluation n=2 p50/p95/mean 0/24788.4/12394.2 ms; curator 10x p50 64618.8ms, judge 2x p50 4157.8ms, solver 12x p50 12161ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.
Ontology (P+O.large): 2 histories; 2 concepts, 26 claims (13.00 per concept); bound-note share 0.471; 5 passes, 8 model calls, 2 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 2/3/3 ms (not in answer latency), 2 timeouts; concept stage {"concept":0,"note":0,"none":2}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 2 | 0.0000 | n/a | n/a | n/a | n/a | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
