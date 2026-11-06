# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: token-ceiling. Input: 43350; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P+W.memoryagentbench-cr@1; usage complete: false; resumed results: 0.
Tool calls: 2 (0.67/q); recall calls: 5; snippet tokens: 2549; recall@k: 0.6667.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1470809.8 ms at concurrency 1 (initial 1); end-to-end questions p50 125086.9 ms / p95 1104856.8 ms; ingestion n=3 p50/p95/mean 11528.6/928883.7/313825.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=3 p50/p95/mean 175098/235681.8/174697 ms; evaluation n=3 p50/p95/mean 0.1/0.3/0.2 ms; solver 6x p50 89472.6ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 2 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 1 | 0.0000 | n/a | 0.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
