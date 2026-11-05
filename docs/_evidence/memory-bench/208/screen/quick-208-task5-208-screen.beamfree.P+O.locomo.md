# Memory benchmark: locomo / fabric-x-tools

Status: running. Input: 491453; cache read: 79424; ratio: 0.1616.
Attempt: 208-screen.beamfree.P+O.locomo@1; usage complete: false; resumed results: 0.
Tool calls: 7 (7.00/q); recall calls: 5; snippet tokens: 8955; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: not recorded.
USD: campaign unknown; product measured/cold/warm 0/0/0; evaluation 0.
Ontology (P+O.beamfree): 1 histories; 1 concepts, 13 claims (13.00 per concept); bound-note share 0.706; 37 passes, 81 model calls, 39 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 735047/735047/735047 ms (not in answer latency), 1 timeouts; concept stage {"concept":0,"note":1,"none":0}.
Curator (product-ontology): 81 exchanges; input 389625, output 586346, cache read 77632, cache write 0; measured USD unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 1 | n/a | n/a | 1.0000 | 0.5 | 0 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
