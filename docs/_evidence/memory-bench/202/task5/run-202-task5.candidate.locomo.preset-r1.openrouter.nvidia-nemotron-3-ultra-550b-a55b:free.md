# Memory benchmark: locomo / fabric-x-tools

Status: failed. Input: 996167; cache read: 120960; ratio: 0.1214.
Attempt: 202-task5.candidate.locomo.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 62 (1.13/q); recall calls: 105; snippet tokens: 115580; recall@k: 0.7273.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 1611647.1 ms at concurrency 1 (initial 1); end-to-end questions p50 23791.8 ms / p95 68564.9 ms; ingestion n=55 p50/p95/mean 656.5/1114.6/709.5 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=55 p50/p95/mean 12117.2/57880.2/16408.6 ms; evaluation n=55 p50/p95/mean 10020.5/31288.3/11753.9 ms; judge 106x p50 4530.4ms, solver 119x p50 5166.6ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.1667 | 0.10788332165987395 | 0.6667 | 0.4771825396825397 | 0.3333333333333333 | 0.0000 |
| temporal | 12 | 0.5000 | 0.07558417385820312 | 0.6667 | 0.5694444444444444 | 0.5 | 0.0000 |
| open-domain | 12 | 0.2500 | 0.033615909529795214 | 0.5833 | 0.375 | 0.16666666666666666 | 0.1667 |
| single-hop | 12 | 0.8333 | 0.11724687016956026 | 0.9167 | 0.9166666666666666 | 0.9166666666666666 | 0.0000 |
| adversarial | 7 | 0.7143 | 0.14285714285714285 | 0.8571 | 0.8571428571428571 | 0.8571428571428571 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
