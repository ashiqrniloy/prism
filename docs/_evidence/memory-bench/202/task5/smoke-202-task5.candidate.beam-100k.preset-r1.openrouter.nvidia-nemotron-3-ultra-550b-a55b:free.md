# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 48586; cache read: 0; ratio: 0.0000.
Attempt: 202-task5.candidate.beam-100k.preset-r1.openrouter.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 2 (2.00/q); recall calls: 3; snippet tokens: 5763; recall@k: n/a.
Judge: openrouter/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 40545.3 ms at concurrency 1 (initial 1); end-to-end questions p50 39250.6 ms / p95 39250.6 ms; ingestion n=1 p50/p95/mean 293.4/293.4/293.4 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=1 p50/p95/mean 21440.5/21440.5/21440.5 ms; evaluation n=1 p50/p95/mean 17439.5/17439.5/17439.5 ms; judge 2x p50 3769.2ms, solver 3x p50 8087.4ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 1.0000 | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
