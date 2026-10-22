# Memory benchmark: lifecycle / om+fabric

Status: failed. Input: 95529; cache read: 58496; ratio: 0.6123.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0.

| Ability | Questions | Accuracy | F1 | Recall@k |
| --- | ---: | ---: | ---: | ---: |
| taskSuccess | 3 | 1.0000 | n/a | n/a |
| crossProjectLeakage | 3 | 1.0000 | n/a | n/a |
| poisonPersistence | 3 | 1.0000 | n/a | n/a |

| Lifecycle metric | Value |
| --- | ---: |
| taskSuccess | 1 |
| crossProjectLeakage | 0 |
| staleUseRate | n/a |
| repeatedErrorRate | n/a |
| rightTimeRecall | n/a |
| abstentionCorrectness | n/a |
| poisonPersistence | 0 |
| tokensPerSession | 25695 |

Sessions: 3; persona mode: scripted; seed: 7. Clusters: persona × project.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
