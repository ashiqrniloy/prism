# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 298312; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 21 (2.10/q); recall calls: 27; snippet tokens: 30026; recall@k: 0.6000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 168397.5 ms at concurrency 1 (initial 1); end-to-end questions p50 13404 ms / p95 29650.2 ms; ingestion n=10 p50/p95/mean 681.7/847.5/638.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 7863.6/24920.4/11556.2 ms; evaluation n=10 p50/p95/mean 4693.3/5427.6/4571.4 ms; judge 20x p50 1791.2ms, solver 31x p50 3556.7ms.
USD: campaign 0.031421; product measured/cold/warm 0.031421/0.031421/0.031421; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.5000 | 0.0273972602739726 | 1.0000 | 0.75 | 0.5 | 0.0000 |
| temporal | 2 | 0.0000 | 0 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.07142857142857142 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.3666666666666667 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 1.0000 | 1 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
