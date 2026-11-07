# Growth simulation — longmemeval-m (500 rows available)

Plan 202 Task 15. 1427 dated exchange notes from 3 LongMemEval-M histories, streamed over 12 simulated months into one store. `fabric.maintain()` ran after every month (the normal nightly trigger). The exchange tier was 1000000 hot tokens. No model call was made.

**Criterion (pre-registered):** month-12 accuracy on month-1 questions within 3 points of month 1. **PASS** — month 1 1.0000, month 12 1.0000.

Accuracy is offline lexical retrieval of the expected month-1 exchange, not an end-to-end model answer. "Inclusive" additionally asks recall to include the searchable archive.

| Month | Accuracy | Inclusive | Content questions | Dataset question | Archived total | By age | By tier |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 | 0 | 0 |
| 6 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 | 0 | 0 |
| 12 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 | 0 | 0 |

The 1427 writes produced a clock of 1427 sessions. A demotion changes status to `archived` and keeps the exchange text; it never deletes it.
