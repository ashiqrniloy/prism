# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 186426; cache read: 70784; ratio: 0.3797.
Attempt: 208-screen.beamfree.P.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 19 (9.50/q); recall calls: 14; snippet tokens: 12555; recall@k: 0.5000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 106333.1 ms at concurrency 1 (initial 1); end-to-end questions p50 52402.4 ms / p95 52963.6 ms; ingestion n=2 p50/p95/mean 708.4/811.5/760 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=2 p50/p95/mean 44009.3/44587/44298.2 ms; evaluation n=2 p50/p95/mean 7066.1/8132.9/7599.5 ms; judge 4x p50 2540.7ms, solver 16x p50 5792.9ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 1 | 0.0000 | 0 | 1.0000 | 0.5 | 0 | 0.0000 |
| temporal | 1 | 0.0000 | 0 | 0.0000 | 0 | 0 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
