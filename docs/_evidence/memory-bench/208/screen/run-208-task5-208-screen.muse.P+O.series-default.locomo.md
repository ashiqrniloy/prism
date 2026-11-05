# Memory benchmark: locomo / fabric-x-tools

Status: running. Input: 1297542; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-default.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 6 (1.50/q); recall calls: 6; snippet tokens: 11774; recall@k: 0.7500.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.
USD: campaign unknown; product measured/cold/warm 0.024775/0.024775/0.024775; evaluation 0.
Ontology (P+O.series-default.muse): 4 histories; 93 concepts, 929 claims (9.99 per concept); bound-note share 0.965; 144 passes, 236 model calls, 77 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 17144/180682/180682 ms (not in answer latency), 3 timeouts; concept stage {"concept":2,"note":1,"none":1}.
Curator (product-ontology): 236 exchanges; input 1074029, output 1207687, cache read 0, cache write 0; measured USD unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| temporal | 2 | 0.0000 | 0 | 0.5000 | 0.5 | 0.5 | 0.0000 |
| adversarial | 2 | 1.0000 | 1 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
