# Memory benchmark: locomo / fabric-x-tools

Status: completed. Input: 1653810; cache read: 155520; ratio: 0.0940.
Attempt: 202-task5.control.locomo.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 124 (2.07/q); recall calls: 149; snippet tokens: 179925; recall@k: 0.7667.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 2545407.5 ms at concurrency 1 (initial 1); end-to-end questions p50 30631.9 ms / p95 81353.8 ms; ingestion n=60 p50/p95/mean 789.8/1084.3/783.2 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 18758.1/62149/30118.2 ms; evaluation n=60 p50/p95/mean 9640.6/24539.8/11427.5 ms; judge 110x p50 4353.8ms, solver 179x p50 5071ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.1667 | 0.0731855678700993 | 0.6667 | 0.4771825396825397 | 0.3333333333333333 | 0.1667 |
| temporal | 12 | 0.6667 | 0.08698789661431751 | 0.6667 | 0.5694444444444444 | 0.5 | 0.0833 |
| open-domain | 12 | 0.6667 | 0.049222850991385535 | 0.7500 | 0.4583333333333333 | 0.16666666666666666 | 0.0000 |
| single-hop | 12 | 0.8333 | 0.1142989125706404 | 0.9167 | 0.9166666666666666 | 0.9166666666666666 | 0.0000 |
| adversarial | 12 | 0.6667 | 0.08333333333333333 | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.1667 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
