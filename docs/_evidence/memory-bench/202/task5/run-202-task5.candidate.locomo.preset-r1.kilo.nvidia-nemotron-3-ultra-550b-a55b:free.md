# Memory benchmark: locomo / fabric-x-tools

Status: completed. Input: 1248487; cache read: 90720; ratio: 0.0727.
Attempt: 202-task5.candidate.locomo.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: false; resumed results: 0.
Tool calls: 85 (1.42/q); recall calls: 136; snippet tokens: 143629; recall@k: 0.7667.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 6002619.7 ms at concurrency 1 (initial 1); end-to-end questions p50 80079.9 ms / p95 182121.8 ms; ingestion n=60 p50/p95/mean 670.1/1167.7/702.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 45662.5/161455.1/67869.2 ms; evaluation n=60 p50/p95/mean 33265.8/40725.3/31319.8 ms; judge 116x p50 5232.5ms, solver 147x p50 22057.5ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.3333 | 0.18564825826599876 | 0.6667 | 0.4771825396825397 | 0.3333333333333333 | 0.0000 |
| temporal | 12 | 0.6667 | 0.09024002904325219 | 0.7500 | 0.6527777777777778 | 0.5833333333333334 | 0.0000 |
| open-domain | 12 | 0.4167 | 0.028311526410162585 | 0.5833 | 0.375 | 0.16666666666666666 | 0.0833 |
| single-hop | 12 | 0.9167 | 0.12813730633962783 | 1.0000 | 1 | 1 | 0.0000 |
| adversarial | 12 | 0.5833 | 0.3333333333333333 | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.0833 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
