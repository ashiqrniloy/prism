# Memory benchmark: locomo / fabric-x-tools

Status: completed. Input: 1763249; cache read: 51840; ratio: 0.0294.
Attempt: 202-task5.control.locomo.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: false; resumed results: 0.
Tool calls: 127 (2.12/q); recall calls: 162; snippet tokens: 182107; recall@k: 0.7833.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 6512547.8 ms at concurrency 1 (initial 1); end-to-end questions p50 100991.8 ms / p95 197642.7 ms; ingestion n=60 p50/p95/mean 574.4/651.2/548 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=60 p50/p95/mean 68519.6/165436.4/77415.5 ms; evaluation n=60 p50/p95/mean 30892.4/39084.7/30452.9 ms; judge 114x p50 4826ms, solver 186x p50 22384.6ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | 0.2500 | 0.21261618170634936 | 0.8333 | 0.574404761904762 | 0.3333333333333333 | 0.0000 |
| temporal | 12 | 0.6667 | 0.08912244682955207 | 0.6667 | 0.5694444444444444 | 0.5 | 0.0000 |
| open-domain | 12 | 0.4167 | 0.027802116174371515 | 0.6667 | 0.4166666666666667 | 0.16666666666666666 | 0.0833 |
| single-hop | 12 | 0.9167 | 0.1283204789117742 | 0.9167 | 0.9166666666666666 | 0.9166666666666666 | 0.0000 |
| adversarial | 12 | 0.5833 | 0.08333333333333333 | 0.8333 | 0.8333333333333334 | 0.8333333333333334 | 0.1667 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
