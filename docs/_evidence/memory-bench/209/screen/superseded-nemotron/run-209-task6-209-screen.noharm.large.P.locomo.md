# Memory benchmark: locomo / fabric-x-tools

Status: token-ceiling. Input: 9667; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P.locomo@1; usage complete: false; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 167035 ms at concurrency 1 (initial 1); end-to-end questions p50 166337.7 ms / p95 166337.7 ms; ingestion n=0 p50/p95/mean n/a/n/a/n/a ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=0 p50/p95/mean n/a/n/a/n/a ms; evaluation n=0 p50/p95/mean n/a/n/a/n/a ms; solver 3x p50 60834.3ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
