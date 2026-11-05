# Memory benchmark: locomo / fabric-x-tools

Status: completed. Input: 3383526; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.muse.P+O.series-readtime.locomo@1; usage complete: false; resumed results: 0.
Tool calls: 84 (2.00/q); recall calls: 58; snippet tokens: 134916; recall@k: 0.7381.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1744298.8 ms at concurrency 1 (initial 1); end-to-end questions p50 37598.4 ms / p95 64680 ms; ingestion n=42 p50/p95/mean 17831.1/31869.8/19200.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=42 p50/p95/mean 6/9.8/6.5 ms; answer n=42 p50/p95/mean 5947.5/20298.6/8318.8 ms; evaluation n=42 p50/p95/mean 9927.2/28244.1/13910.1 ms; judge 84x p50 4662.1ms, solver 371x p50 2684.2ms.
USD: campaign 0.366676; product measured/cold/warm 0.366676/0.366676/0.366676; evaluation 0.
Ontology (P+O.series-readtime.muse): 42 histories; 0 concepts, 0 claims (n/a per concept); bound-note share 0.000; 0 passes, 0 model calls, 0 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 6/10/15 ms (not in answer latency), 0 timeouts; concept stage {"concept":0,"note":31,"none":11}.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| temporal | 7 | 0.5714 | 0.06495726495726495 | 0.7143 | 0.7142857142857143 | 0.7142857142857143 | 0.0000 |
| adversarial | 12 | 0.9167 | 0.9166666666666666 | 0.7500 | 0.75 | 0.75 | 0.0000 |
| open-domain | 10 | 0.4000 | 0.04670196744388314 | 0.6000 | 0.4 | 0.2 | 0.0000 |
| single-hop | 12 | 0.7500 | 0.22193822209806865 | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.0000 |
| multi-hop | 1 | 1.0000 | 0.2361111111111111 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
