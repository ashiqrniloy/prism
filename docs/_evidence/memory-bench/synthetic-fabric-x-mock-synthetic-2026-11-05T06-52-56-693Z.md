# Memory benchmark: synthetic / fabric-x

Status: completed. Input: 37930; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 14; snippet tokens: 1752; recall@k: 1.0000.
Judge: mock/synthetic-judge. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 557.7 ms at concurrency 1 (initial 1); end-to-end questions p50 34 ms / p95 109.5 ms; ingestion n=14 p50/p95/mean 22.1/63.1/25 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=14 p50/p95/mean 2.3/2.5/2.3 ms; answer n=14 p50/p95/mean 5.9/24.3/7.6 ms; evaluation n=14 p50/p95/mean 0.2/1/0.3 ms; curator 14x p50 0.1ms, injection-label 56x p50 0ms, judge 56x p50 0ms, solver 14x p50 0.1ms.
Ontology (fabric-x+O): 14 histories; 14 concepts, 14 claims (1.00 per concept); bound-note share 0.667; 14 passes, 14 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 2/2/2 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":12,"none":2}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knowledge-update | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| multi-session | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| single-session-assistant | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| single-session-preference | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| single-session-user | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| temporal-reasoning | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| single-hop | 1 | 1.0000 | 1 | 1.0000 | n/a | n/a | 0.0000 |
| multi-hop | 1 | 1.0000 | 1 | 1.0000 | n/a | n/a | 0.0000 |
| temporal | 1 | 1.0000 | 1 | 1.0000 | n/a | n/a | 0.0000 |
| open-domain | 1 | 1.0000 | 1 | 1.0000 | n/a | n/a | 0.0000 |
| adversarial | 1 | 1.0000 | 1 | n/a | n/a | n/a | 0.0000 |
| conflict-resolution-single-hop | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
