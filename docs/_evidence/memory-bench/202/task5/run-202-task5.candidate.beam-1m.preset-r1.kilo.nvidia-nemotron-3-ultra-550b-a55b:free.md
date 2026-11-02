# Memory benchmark: beam-1m / fabric-x-tools

Status: failed. Input: 1030571; cache read: 51840; ratio: 0.0503.
Attempt: 202-task5.candidate.beam-1m.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: false; resumed results: 0.
Tool calls: 44 (1.42/q); recall calls: 75; snippet tokens: 150098; recall@k: 0.5600.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 3097257 ms at concurrency 1 (initial 1); end-to-end questions p50 82323.3 ms / p95 252115.2 ms; ingestion n=31 p50/p95/mean 5720/12938/8059.3 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=31 p50/p95/mean 43920/150569.7/52785.9 ms; evaluation n=30 p50/p95/mean 30226.4/126174.9/38710.2 ms; judge 62x p50 8443.4ms, solver 73x p50 19424.7ms.
USD: campaign unknown; product measured/cold/warm unknown/unknown/unknown; evaluation unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.5000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 1.0000 | 0.4583333333333333 | 0 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.5000 | 0.061822493224932246 | 0 | 0.5000 |
| information_extraction | 4 | 0.7500 | n/a | 0.3333 | 0.3333333333333333 | 0.3333333333333333 | 0.2500 |
| instruction_following | 4 | 0.0000 | n/a | 0.2500 | 0.16666666666666666 | 0 | 0.0000 |
| knowledge_update | 4 | 0.7500 | n/a | 0.7500 | 0.5625 | 0.25 | 0.0000 |
| multi_session_reasoning | 4 | 0.5000 | n/a | 1.0000 | 0.6984126984126983 | 0.3333333333333333 | 0.0000 |
| preference_following | 3 | 0.5000 | n/a | 0.0000 | 0 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.3727 | 0.0000 | 0.5000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
