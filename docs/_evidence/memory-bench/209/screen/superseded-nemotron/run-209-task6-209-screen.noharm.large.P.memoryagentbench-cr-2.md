# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.memoryagentbench-cr@2; usage complete: true; resumed results: 8.
Tool calls: 11 (1.38/q); recall calls: 19; snippet tokens: 6827; recall@k: 0.8750.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1146 ms at concurrency 1 (initial 1); end-to-end questions p50 0 ms / p95 1 ms; ingestion n=8 p50/p95/mean 2174.4/926156.2/131751.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 103834.6/464711.5/160500.5 ms; evaluation n=8 p50/p95/mean 0.1/0.3/0.1 ms; no calls.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 0.7500 | n/a | 0.7500 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
