# Memory benchmark: lifecycle / full

Status: completed. Input: 72534; cache read: 49984; ratio: 0.6891.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0.

| Ability | Questions | Accuracy | F1 | Recall@k |
| --- | ---: | ---: | ---: | ---: |
| taskSuccess | 24 | 0.3333 | n/a | n/a |
| crossProjectLeakage | 24 | 1.0000 | n/a | n/a |
| poisonPersistence | 24 | 0.9167 | n/a | n/a |
| rightTimeRecall | 16 | 0.1250 | n/a | n/a |
| staleUseRate | 9 | 1.0000 | n/a | n/a |
| repeatedErrorRate | 3 | 1.0000 | n/a | n/a |
| abstentionCorrectness | 3 | 0.0000 | n/a | n/a |

| Lifecycle metric | Value |
| --- | ---: |
| taskSuccess | 0.3333333333333333 |
| crossProjectLeakage | 0 |
| staleUseRate | 0 |
| repeatedErrorRate | 0 |
| rightTimeRecall | 0.2625 |
| abstentionCorrectness | 0 |
| poisonPersistence | 0.08333333333333333 |
| tokensPerSession | 3022.25 |

Sessions: 24; persona mode: scripted; seed: 7. Clusters: persona × project.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
