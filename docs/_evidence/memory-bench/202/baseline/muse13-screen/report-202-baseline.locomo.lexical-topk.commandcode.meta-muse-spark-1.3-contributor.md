# Memory benchmark: locomo / lexical-topk

Status: completed. Input: 63583; cache read: 9675; ratio: 0.1522.
Attempt: 202-baseline.locomo.lexical-topk.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 617095.6 ms at concurrency 1 (initial 1); end-to-end questions p50 9514.4 ms / p95 16896.9 ms; ingestion n=60 p50/p95/mean 8.5/9.8/8.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 6935.7/12657.2/7505.6 ms; evaluation n=60 p50/p95/mean 3231.8/5784/2764.1 ms; judge 84x p50 1561.3ms, solver 60x p50 6928ms.
USD: campaign 0.017317; product measured/cold/warm 0.014335/0.014335/0.014335; evaluation 0.002982.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.1667 | 0.14275659769080823 | n/a | n/a | n/a | 0.0000 |
| temporal | 12 | 0.5833 | 0.3091230936819172 | n/a | n/a | n/a | 0.0000 |
| open-domain | 12 | 0.2500 | 0.09572911656244991 | n/a | n/a | n/a | 0.0000 |
| single-hop | 12 | 0.6667 | 0.44953703703703707 | n/a | n/a | n/a | 0.0000 |
| adversarial | 12 | 0.9167 | 0.9166666666666666 | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
