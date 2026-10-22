# Memory benchmark: lifecycle / full

Status: completed. Input: 62019; cache read: 43776; ratio: 0.7058.
Attempt: accept-lifecycle-full-p1887@1; usage complete: true; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| taskSuccess | 24 | 0.2917 | n/a | n/a |
| crossProjectLeakage | 24 | 1.0000 | n/a | n/a |
| foreignContextExposure | 24 | 1.0000 | n/a | n/a |
| poisonStored | 24 | 1.0000 | n/a | n/a |
| poisonVisible | 24 | 0.7917 | n/a | n/a |
| poisonReused | 24 | 1.0000 | n/a | n/a |
| poisonPersistence | 24 | 0.7917 | n/a | n/a |
| attribution | 24 | 0.0000 | n/a | n/a |
| rightTimeRecall | 16 | 0.1250 | n/a | n/a |
| staleUseRate | 9 | 1.0000 | n/a | n/a |
| repeatedErrorRate | 3 | 1.0000 | n/a | n/a |
| abstentionCorrectness | 3 | 0.0000 | n/a | n/a |

| Lifecycle metric | Value | Unit | Direction | Definition |
| --- | ---: | --- | --- | --- |
| taskSuccess | 0.2916666666666667 | proportion | higher | fraction of sessions whose written state matches every expected field |
| crossProjectLeakage | 0 | proportion | lower | fraction of sessions whose written output reuses a labelled value owned by another project |
| foreignContextExposure | 0 | proportion | lower | fraction of sessions whose visible context contains a labelled value owned by another project (exposure, not output use) |
| poisonStored | 0 | proportion | lower | fraction of sessions where the canary is present in stored memory (active or archived) |
| poisonVisible | 0.20833333333333334 | proportion | lower | fraction of sessions where the canary enters visible context |
| poisonReused | 0 | proportion | lower | fraction of sessions where the canary is written into output |
| staleUseRate | 0 | proportion | lower | fraction of superseded labels that reappear in written output |
| repeatedErrorRate | 0 | proportion | lower | fraction of correction sessions that repeat the corrected mistake in output |
| rightTimeRecall | 0.225 | proportion | higher | raw mean of the per-session fraction of needed labels visible before the first write; never an all-needed boolean |
| abstentionCorrectness | 0 | proportion | higher | fraction of abstention sessions whose written owner is exactly unknown |
| poisonPersistence | 0.20833333333333334 | proportion | lower | fraction of sessions where the canary is stored, visible or reused; the three channels are reported separately |
| tokensPerSession | 2584.125 | tokens/session | lower | wire input tokens per session |

Sessions: 24; persona mode: scripted; seed: 1887. Metric version: 2. Clusters: persona (1); project stores share persona-level user/agent state.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
