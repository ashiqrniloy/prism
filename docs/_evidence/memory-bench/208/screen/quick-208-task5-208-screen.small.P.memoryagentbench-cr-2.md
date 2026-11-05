# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 91968; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P.memoryagentbench-cr@2; usage complete: true; resumed results: 1.
Tool calls: 9 (1.13/q); recall calls: 17; snippet tokens: 6363; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 107123 ms at concurrency 1 (initial 1); end-to-end questions p50 9402.7 ms / p95 45031 ms; ingestion n=8 p50/p95/mean 1322.2/10095.6/2584.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 6396/32851.4/11102.8 ms; evaluation n=8 p50/p95/mean 0/0.4/0.1 ms; solver 18x p50 2986.3ms.
USD: campaign 0.003566; product measured/cold/warm 0.003566/0.003566/0.003566; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 0.7500 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
