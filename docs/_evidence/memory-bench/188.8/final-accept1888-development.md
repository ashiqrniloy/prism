# Memory benchmark: longmemeval-s / fabric

Status: completed. Input: 347040; cache read: 8384; ratio: 0.0242.
Attempt: accept1888-development@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 140; snippet tokens: 84845; recall@k: 0.8261.
Judge: opencode-go/mimo-v2.5. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence | Run-limit rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| abstention | 20 | 0.8500 | n/a | 0.8947 | 0.5 | 0.4 | 0.0000 |
| knowledge-update | 20 | 0.4000 | n/a | 1.0000 | 0.5 | 0.2 | 0.0000 |
| multi-session | 20 | 0.1000 | n/a | 0.8500 | 0.2866666666666667 | 0.1 | 0.0000 |
| single-session-assistant | 20 | 0.9000 | n/a | 0.9000 | 0.8 | 0.8 | 0.0000 |
| single-session-preference | 20 | 0.2500 | n/a | 0.4500 | 0.14166666666666666 | 0.1 | 0.0000 |
| single-session-user | 20 | 0.6000 | n/a | 0.9500 | 0.6 | 0.6 | 0.0000 |
| temporal-reasoning | 20 | 0.1500 | n/a | 0.7368 | 0.2894736842105263 | 0.21052631578947367 | 0.0000 |

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
