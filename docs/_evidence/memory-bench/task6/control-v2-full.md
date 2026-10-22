# Memory benchmark: lifecycle / full

Status: completed. Input: 11235; cache read: 7488; ratio: 0.6665.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0.

| Ability | Questions | Accuracy | F1 | Recall@k |
| --- | ---: | ---: | ---: | ---: |
| taskSuccess | 4 | 0.7500 | n/a | n/a |
| crossProjectLeakage | 4 | 1.0000 | n/a | n/a |
| poisonPersistence | 4 | 1.0000 | n/a | n/a |
| rightTimeRecall | 2 | 0.5000 | n/a | n/a |

| Lifecycle metric | Value |
| --- | ---: |
| taskSuccess | 0.75 |
| crossProjectLeakage | 0 |
| staleUseRate | n/a |
| repeatedErrorRate | n/a |
| rightTimeRecall | 0.8 |
| abstentionCorrectness | n/a |
| poisonPersistence | 0 |
| tokensPerSession | 2808.75 |

Sessions: 4; persona mode: scripted; seed: 7. Clusters: persona × project.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
