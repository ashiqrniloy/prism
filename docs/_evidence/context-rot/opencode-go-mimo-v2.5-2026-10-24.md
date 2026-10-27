# Context-rot evidence: opencode-go/mimo-v2.5

Generated: 2026-10-24T19:08:51.784Z  
Mode: live  
Model window: 1000000  
Tasks: 3 · repeats: 1 · configs: none, fold

| Length | Config | Correct | Accuracy | Wilson 95% | Input tokens | Cache-read | Cache ratio |
| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: |
| 0 | none | 3/3 | 100.0% | 43.8%–100.0% | 21,394 | 12,672 | 59.2% |
| 0 | fold | 3/3 | 100.0% | 43.8%–100.0% | 9,794 | 5,760 | 58.8% |
| 16000 | none | 2/3 | 66.7% | 20.8%–93.9% | 179,657 | 154,368 | 85.9% |
| 16000 | fold | 3/3 | 100.0% | 43.8%–100.0% | 205,428 | 198,912 | 96.8% |
| 32000 | none | 3/3 | 100.0% | 43.8%–100.0% | 313,684 | 292,352 | 93.2% |
| 32000 | fold | 3/3 | 100.0% | 43.8%–100.0% | 241,489 | 230,144 | 95.3% |
| 64000 | none | 3/3 | 100.0% | 43.8%–100.0% | 813,493 | 769,664 | 94.6% |
| 64000 | fold | 3/3 | 100.0% | 43.8%–100.0% | 398,144 | 369,024 | 92.7% |
| 96000 | none | 3/3 | 100.0% | 43.8%–100.0% | 1,271,767 | 1,228,032 | 96.6% |
| 96000 | fold | 3/3 | 100.0% | 43.8%–100.0% | 655,699 | 626,944 | 95.6% |

**Effective input budget:** 96,000 tokens (no fold, within 5 points of the 0-length baseline with overlapping intervals).
**Effective input budget with fold batch:** 96,000 tokens.

Usage: 4,110,549 input · 3,887,872 cache-read · 16,455 output · 99 calls; usage complete: true.
Billed estimate: 0.0467 USD (provider list price, estimate).

## Limitations

- Deterministic self-graded tasks; no model judge.
- History is pinned public-repo tool output, not the task's own workspace.
- A task may be answered after the configured turn cap; failed tool use is scored zero.
- Pilot run: 3 of 30 tasks. The release matrix uses all 30 at three repeats.

