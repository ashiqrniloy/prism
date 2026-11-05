# Memory benchmark: locomo / fabric-x-tools

Status: partial. Input: 59457; cache read: 0; ratio: 0.0000.
Attempt: 208-screen.small.P.locomo@1; usage complete: true; resumed results: 0.
Tool calls: 2 (0.20/q); recall calls: 12; snippet tokens: 13628; recall@k: 0.6000.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 243147.7 ms at concurrency 1 (initial 1); end-to-end questions p50 19604.5 ms / p95 49836.8 ms; ingestion n=10 p50/p95/mean 934.3/1896.3/968.8 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=10 p50/p95/mean 9748.3/41335.8/14705.7 ms; evaluation n=10 p50/p95/mean 8591.8/16177.1/8534.2 ms; judge 18x p50 3782.3ms, solver 12x p50 9276.6ms.
USD: campaign 0.003477; product measured/cold/warm 0.003477/0.003477/0.003477; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 2 | 0.0000 | 0.027777777777777776 | 1.0000 | 0.5 | 0 | 0.0000 |
| temporal | 2 | 0.0000 | 0.07692307692307693 | 0.0000 | 0 | 0 | 0.0000 |
| open-domain | 2 | 0.5000 | 0.14224137931034483 | 0.0000 | 0 | 0 | 0.0000 |
| single-hop | 2 | 1.0000 | 0.26785714285714285 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 2 | 0.5000 | 0 | 1.0000 | 1 | 1 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
