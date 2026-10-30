# Memory benchmark: locomo / fabric-x

Status: completed. Input: 130394; cache read: 12187; ratio: 0.0935.
Attempt: 202-baseline.locomo.passive-only.commandcode.meta/muse-spark-1.3-contributor@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 60; snippet tokens: 71018; recall@k: 0.6833.
Judge: commandcode/minimax/minimax-m3.1-flash. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 799873 ms at concurrency 1 (initial 1); end-to-end questions p50 12553.9 ms / p95 19446.1 ms; ingestion n=60 p50/p95/mean 533.7/802.9/561.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 7915/13078.9/8437.7 ms; evaluation n=60 p50/p95/mean 3525.9/6489/4259.3 ms; judge 118x p50 1527ms, solver 60x p50 7887.4ms.
USD: campaign 0.02555; product measured/cold/warm 0.019924/0.019924/0.019924; evaluation 0.005626.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.1667 | 0.1739938000865776 | 0.6667 | 0.44940476190476186 | 0.25 | 0.0000 |
| temporal | 12 | 0.6667 | 0.11631699913433657 | 0.6667 | 0.5694444444444444 | 0.5 | 0.0000 |
| open-domain | 12 | 0.3333 | 0.09137178825646318 | 0.5000 | 0.2916666666666667 | 0.08333333333333333 | 0.0000 |
| single-hop | 12 | 0.7500 | 0.361713427474297 | 0.9167 | 0.9166666666666666 | 0.9166666666666666 | 0.0000 |
| adversarial | 12 | 0.9167 | 0.9166666666666666 | 0.6667 | 0.6666666666666666 | 0.6666666666666666 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
