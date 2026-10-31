# Memory benchmark: locomo / fabric-x

Status: completed. Input: 0; cache read: 0; ratio: 0.0000.
Attempt: none; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: litellm/prism-free/gpt-oss-20b@groq. Truncated questions: 0. Metric version: 2.
Phase: write. Timing: arm 26041.2 ms at concurrency 4 (initial 4); end-to-end questions p50 1834.2 ms / p95 2014.3 ms; ingestion n=60 p50/p95/mean 1831.9/2011/1704.3 ms; restore n=0 p50/p95/mean n/a/n/a/n/a ms; answer n=0 p50/p95/mean n/a/n/a/n/a ms; evaluation n=0 p50/p95/mean n/a/n/a/n/a ms; no calls.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| multi-hop | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| temporal | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| open-domain | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| single-hop | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |
| adversarial | 12 | n/a | n/a | n/a | n/a | n/a | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
