# Memory benchmark: beam-1m / fabric-x-tools

Status: completed. Input: 1229917; cache read: 34560; ratio: 0.0281.
Attempt: 202-task5.control.beam-1m.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free@1; usage complete: true; resumed results: 0.
Tool calls: 54 (1.35/q); recall calls: 93; snippet tokens: 199138; recall@k: 0.5882.
Judge: kilo/dots-studio/dots-3-note-preview:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 4919038.4 ms at concurrency 1 (initial 1); end-to-end questions p50 88472.9 ms / p95 267713.3 ms; ingestion n=40 p50/p95/mean 5192.6/15698.8/6969.6 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=40 p50/p95/mean 45177.2/145431.6/63829 ms; evaluation n=40 p50/p95/mean 31848.9/133229.5/51729.3 ms; judge 99x p50 10307.2ms, solver 94x p50 20684.7ms.
USD: campaign 0; product measured/cold/warm 0/0/0; evaluation 0.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 4 | 0.7500 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 4 | 0.0000 | n/a | 0.7500 | 0.29166666666666663 | 0 | 0.0000 |
| event_ordering | 4 | 0.0000 | n/a | 0.7500 | 0.10210027100271003 | 0 | 0.0000 |
| information_extraction | 4 | 0.7500 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| instruction_following | 4 | 0.2500 | n/a | 0.2500 | 0.16666666666666666 | 0 | 0.0000 |
| knowledge_update | 4 | 0.5000 | n/a | 0.7500 | 0.5 | 0.25 | 0.0000 |
| multi_session_reasoning | 4 | 0.7500 | n/a | 1.0000 | 0.5873015873015873 | 0.3333333333333333 | 0.0000 |
| preference_following | 4 | 0.7500 | n/a | 0.2500 | 0.125 | 0 | 0.0000 |
| summarization | 4 | 0.0000 | n/a | 0.7500 | 0.06823607427055703 | 0 | 0.0000 |
| temporal_reasoning | 4 | 0.7500 | n/a | 0.7500 | 0.29166666666666663 | 0 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 4 | 0.3284 | 0.0000 | 0.2500 |
| summarization | 4 | 0.2401 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
