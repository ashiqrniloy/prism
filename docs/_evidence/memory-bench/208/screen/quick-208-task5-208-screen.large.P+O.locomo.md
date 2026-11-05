# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 833863; cache read: 96448; ratio: 0.1157.
Attempt: 208-screen.large.P+O.locomo@1; usage complete: false; resumed results: 0.
Tool calls: 18 (1.80/q); recall calls: 27; snippet tokens: 31650; recall@k: 0.6000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 8023576.6 ms at concurrency 1 (initial 1); end-to-end questions p50 165342.7 ms / p95 2545052.5 ms; ingestion n=10 p50/p95/mean 314/2444072.1/695300.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=5 p50/p95/mean 2.7/70254/14058.9 ms; answer n=10 p50/p95/mean 82864.7/247908.2/98052.6 ms; evaluation n=10 p50/p95/mean 8233.9/12175.5/8830.1 ms; curator 97x p50 42746.1ms, judge 20x p50 3782.3ms, solver 28x p50 20387.7ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.
Ontology (P+O.large): 10 histories; 138 concepts, 1036 claims (7.51 per concept); bound-note share 0.890; 186 passes, 232 model calls, 38 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 16/70254/70254 ms (not in answer latency), 5 timeouts; concept stage {"concept":1,"note":6,"none":3}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.0000 | 0.05263157894736842 | 1.0000 | 0.5 | 0 | 0.0000 |
| temporal | 2 | 0.0000 | 0.03854639844256976 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.020833333333333332 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.10331632653061223 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 0.0000 | 0 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
