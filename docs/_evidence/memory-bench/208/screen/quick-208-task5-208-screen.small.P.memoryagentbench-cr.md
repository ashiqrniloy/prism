# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 357333; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 31 (3.88/q); recall calls: 35; snippet tokens: 23928; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 156451.9 ms at concurrency 1 (initial 1); end-to-end questions p50 12783 ms / p95 38284.6 ms; ingestion n=8 p50/p95/mean 1287.8/12561.5/2947.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 11359.7/25196.3/15742 ms; evaluation n=8 p50/p95/mean 0.1/0.6/0.1 ms; solver 39x p50 3081.5ms.
USD: campaign 0.038473; product measured/cold/warm 0.038473/0.038473/0.038473; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
