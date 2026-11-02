# Memory benchmark: memoryagentbench-cr / fabric-x-tools

Status: completed. Input: 428354; cache read: 21600; ratio: 0.0504.
Attempt: 202-task5.candidate.memoryagentbench-cr.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 35 (1.75/q); recall calls: 51; snippet tokens: 23382; recall@k: 0.8000.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 6425233.8 ms at concurrency 1 (initial 1); end-to-end questions p50 82163.5 ms / p95 1038913.4 ms; ingestion n=20 p50/p95/mean 51299.3/1002427.8/270160.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=20 p50/p95/mean 35851.2/156765.6/50130.9 ms; evaluation n=20 p50/p95/mean 0.1/0.3/0.1 ms; solver 53x p50 19059.9ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| conflict-resolution-single-hop | 10 | 1.0000 | n/a | 1.0000 | n/a | n/a | 0.0000 |
| conflict-resolution-multi-hop | 10 | 0.3000 | n/a | 0.6000 | n/a | n/a | 0.2000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
