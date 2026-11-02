# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: completed. Input: 311854; cache read: 0; ratio: 0.0000.
Attempt: 202-task5.control.memoryagentbench-cr.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 30 (1.50/q); recall calls: 44; snippet tokens: 17074; recall@k: 0.7500.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 5197677.8 ms at concurrency 1 (initial 1); end-to-end questions p50 81005.4 ms / p95 1000871.8 ms; ingestion n=20 p50/p95/mean 52180.1/978715.4/214452.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=20 p50/p95/mean 31193.1/107276.7/44560.3 ms; evaluation n=20 p50/p95/mean 0.1/0.2/0.1 ms; solver 50x p50 17750.1ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 10 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 10 | 0.3000 | n/a | 0.5000 | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
