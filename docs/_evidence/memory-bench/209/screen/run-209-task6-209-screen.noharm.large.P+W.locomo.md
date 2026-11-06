# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 238524; cache read: 0; ratio: 0.0000.
Attempt: 209-screen.noharm.large.P+W.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 21 (2.10/q); recall calls: 28; snippet tokens: 28111; recall@k: 0.7000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 183874.1 ms at concurrency 1 (initial 1); end-to-end questions p50 16821.7 ms / p95 29407 ms; ingestion n=10 p50/p95/mean 672/861.7/655.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 9544.6/19615.2/11723 ms; evaluation n=10 p50/p95/mean 4853.6/12953.8/5929.2 ms; judge 20x p50 1979.8ms, solver 31x p50 3603.7ms.
USD: campaign 0.025514; product measured/cold/warm 0.025514/0.025514/0.025514; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.0000 | 0.35460992907801414 | 1.0000 | 0.5 | 0 | 0.0000 |
| temporal | 2 | 0.0000 | 0 | 0.5000 | 0.5 | 0.5 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.04714912280701754 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.3666666666666667 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 1.0000 | 1 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
