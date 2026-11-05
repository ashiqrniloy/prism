# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 162576; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.large.P.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 12 (1.20/q); recall calls: 19; snippet tokens: 21952; recall@k: 0.6000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 494681.8 ms at concurrency 1 (initial 1); end-to-end questions p50 56237.9 ms / p95 73516 ms; ingestion n=10 p50/p95/mean 1031.9/1595.6/1032.9 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 38599.9/58439.4/36393.7 ms; evaluation n=10 p50/p95/mean 9685.8/21405.3/11681.8 ms; judge 21x p50 4336.9ms, solver 22x p50 15160.4ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.0000 | 0.13734567901234568 | 1.0000 | 0.5 | 0 | 0.0000 |
| temporal | 2 | 0.0000 | 0.021505376344086023 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.011363636363636364 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.11010558069381599 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 0.5000 | 0 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
