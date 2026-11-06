# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 331613; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 28 (3.50/q); recall calls: 34; snippet tokens: 21436; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 151189.9 ms at concurrency 1 (initial 1); end-to-end questions p50 15385.8 ms / p95 40763.5 ms; ingestion n=8 p50/p95/mean 1240.5/10873/2619.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 13373.8/24719.1/15310.7 ms; evaluation n=8 p50/p95/mean 0/0.3/0.1 ms; solver 36x p50 2888.2ms.
USD: campaign 0.0354; product measured/cold/warm 0.0354/0.0354/0.0354; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
