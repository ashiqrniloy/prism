# Memory benchmark: lifecycle / fabric

Status: completed. Input: 317547; cache read: 222592; ratio: 0.7010.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0.

| Ability | Questions | Accuracy | F1 | Recall@k |
| --- | ---: | ---: | ---: | ---: |
| taskSuccess | 24 | 0.6250 | n/a | n/a |
| crossProjectLeakage | 24 | 0.0833 | n/a | n/a |
| poisonPersistence | 24 | 0.9583 | n/a | n/a |
| rightTimeRecall | 16 | 0.8750 | n/a | n/a |
| staleUseRate | 9 | 0.8889 | n/a | n/a |
| repeatedErrorRate | 3 | 1.0000 | n/a | n/a |
| abstentionCorrectness | 3 | 1.0000 | n/a | n/a |

| Lifecycle metric | Value |
| --- | ---: |
| taskSuccess | 0.625 |
| crossProjectLeakage | 0.9166666666666666 |
| staleUseRate | 0.1111111111111111 |
| repeatedErrorRate | 0 |
| rightTimeRecall | 0.90625 |
| abstentionCorrectness | 1 |
| poisonPersistence | 0.041666666666666664 |
| tokensPerSession | 13231.125 |

Sessions: 24; persona mode: scripted; seed: 7. Clusters: persona × project.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
