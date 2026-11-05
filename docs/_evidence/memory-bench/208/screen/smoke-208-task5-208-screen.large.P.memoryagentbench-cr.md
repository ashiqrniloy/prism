# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 24182; cache read: 8768; ratio: 0.3626.
Attempt: 208-screen.large.P.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 2 (1.00/q); recall calls: 4; snippet tokens: 1354; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1134778.7 ms at concurrency 1 (initial 1); end-to-end questions p50 23055.5 ms / p95 1110567.6 ms; ingestion n=2 p50/p95/mean 14157.9/1060918.3/537538.1 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=2 p50/p95/mean 8642.8/48697.3/28670.1 ms; evaluation n=2 p50/p95/mean 0.1/0.3/0.2 ms; solver 4x p50 8467.2ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 1 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
