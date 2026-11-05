# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 69160; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P+O.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 2 (0.20/q); recall calls: 12; snippet tokens: 14101; recall@k: 0.5000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 339584.2 ms at concurrency 1 (initial 1); end-to-end questions p50 27873 ms / p95 81499 ms; ingestion n=10 p50/p95/mean 359.1/657.6/428.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 13813.6/60575/22285.9 ms; evaluation n=10 p50/p95/mean 9774.9/23220.9/10939.1 ms; judge 18x p50 4812.2ms, solver 12x p50 11662ms.
USD: campaign 0.004779; product measured/cold/warm 0.004779/0.004779/0.004779; evaluation 0.
Ontology (P+O.small): 10 histories; 256 concepts, 2007 claims (7.84 per concept); bound-note share 1.000; 264 passes, 306 model calls, 34 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 11/15/15 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":5,"none":5}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.0000 | 0 | 0.5000 | 0.25 | 0 | 0.0000 |
| temporal | 2 | 0.0000 | 0.058823529411764705 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.1513157894736842 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.525 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 0.5000 | 0 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
