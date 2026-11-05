# Memory benchmark: beam-100k / fabric-x-tools

Status: partial. Input: 2115484; cache read: 214816; ratio: 0.1015.
Attempt: 208-screen.large.P+O.beam-100k@1; usage complete: false; resumed results: 0.
Tool calls: 22 (2.20/q); recall calls: 30; snippet tokens: 58105; recall@k: 0.7778.
Judge: commandcode/stealth/glyph-cluster:free. Truncated questions: 0. Metric version: 2.
Phase: all. Timing: arm 6832171.2 ms at concurrency 1 (initial 1); end-to-end questions p50 526441.8 ms / p95 1106253.7 ms; ingestion n=10 p50/p95/mean 424592.4/598088.2/447671.7 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; ontologySettle n=10 p50/p95/mean 2.6/50296/5031.9 ms; answer n=10 p50/p95/mean 145212.2/477030.4/205187.5 ms; evaluation n=10 p50/p95/mean 10939.9/35756.1/14767.5 ms; curator 38x p50 64552.5ms, judge 22x p50 5264.5ms, solver 32x p50 17590.9ms.
USD: campaign unknown; product measured/cold/warm 0/0/0; evaluation 0.
Ontology (P+O.large): 10 histories; 11 concepts, 132 claims (12.00 per concept); bound-note share 0.370; 18 passes, 22 model calls, 2 repairs; rejected trust/secret/invalid 0/0/0; settle p50/p95/max 2/50296/50296 ms (not in answer latency), 10 timeouts; concept stage {"concept":1,"note":6,"none":3}.
Curator (product-ontology): 57 exchanges; input 1483438, output 211086, cache read 144672, cache write 0; measured USD unknown.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 1 | 0.0000 | n/a | n/a | n/a | n/a | 0.0000 |
| contradiction_resolution | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| event_ordering | 1 | 0.0000 | n/a | 1.0000 | 0.4 | 0 | 0.0000 |
| information_extraction | 1 | 1.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |
| instruction_following | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| knowledge_update | 1 | 0.0000 | n/a | 1.0000 | 0.5 | 0 | 0.0000 |
| multi_session_reasoning | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| preference_following | 1 | 0.0000 | n/a | 1.0000 | 0.3333333333333333 | 0 | 0.0000 |
| summarization | 1 | 0.0000 | n/a | 0.0000 | 0 | 0 | 0.0000 |
| temporal_reasoning | 1 | 0.0000 | n/a | 1.0000 | 1 | 1 | 0.0000 |

Graded rubric score (Plan 202 Task 4.5.1, primary for BEAM rubric abilities; binary accuracy secondary):

| Ability | Questions | Graded mean | Binary accuracy | Judge disagreement rate |
| --- | ---: | ---: | ---: | ---: |
| event_ordering | 1 | 0.0000 | 0.0000 | 0.0000 |
| summarization | 1 | 0.3000 | 0.0000 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
