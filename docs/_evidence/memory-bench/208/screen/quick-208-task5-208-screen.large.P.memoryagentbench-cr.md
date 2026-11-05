# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: partial. Input: 229192; cache read: 65760; ratio: 0.2869.
Attempt: 208-screen.large.P.memoryagentbench-cr@1; usage complete: true; resumed results: 0.
Tool calls: 18 (2.25/q); recall calls: 26; snippet tokens: 9682; recall@k: 1.0000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 606669.7 ms at concurrency 1 (initial 1); end-to-end questions p50 36379.8 ms / p95 204195.6 ms; ingestion n=8 p50/p95/mean 1083.5/9612.6/2322 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=8 p50/p95/mean 33956/193407.8/72931.8 ms; evaluation n=8 p50/p95/mean 0.1/0.3/0.1 ms; solver 26x p50 21517.4ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 4 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
