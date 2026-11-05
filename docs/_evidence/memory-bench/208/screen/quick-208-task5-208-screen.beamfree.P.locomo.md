# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 687344; cache read: 125056; ratio: 0.1819.
Attempt: 208-screen.beamfree.P.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 58 (5.80/q); recall calls: 59; snippet tokens: 68934; recall@k: 0.7000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 490963.5 ms at concurrency 1 (initial 1); end-to-end questions p50 55900.8 ms / p95 61462.3 ms; ingestion n=10 p50/p95/mean 991.7/1622.5/1051.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 45425.6/51213.2/40002.6 ms; evaluation n=10 p50/p95/mean 8426.1/10865.3/7883.1 ms; judge 18x p50 4369.4ms, solver 68x p50 6038.3ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.5000 | 0.125 | 1.0000 | 0.75 | 0.5 | 0.0000 |
| temporal | 2 | 0.0000 | 0.016666666666666666 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.0000 | 0.06666666666666667 | 0.5000 | 0.05 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.14074074074074072 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 1.0000 | 0.5 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
