# Memory benchmark: lifecycle / om+fabric

Status: failed. Input: 12272; cache read: 5312; ratio: 0.4329.
Attempt: accept-lifecycle-om+fabric-p1887@1; usage complete: false; resumed results: 0.
Tool calls: 0 (0.00/q); recall calls: 0; snippet tokens: 0; recall@k: n/a.
Judge: executable-state. Truncated questions: 0. Metric version: 2.

Judge accuracy and token F1 are separate metrics. Answer-session hit@k is a coarse any-round boolean;
evidence coverage is round-level and all-required evidence coverage is a separate constraint. Fine-gold
recall/precision stay n/a when the dataset does not expose usable fine gold.

| Ability | Questions | Judge accuracy | Token F1 | Answer-session hit@k | Evidence-round coverage | All-required evidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |

| Lifecycle metric | Value | Unit | Direction | Definition |
| --- | ---: | --- | --- | --- |
| taskSuccess | n/a | proportion | higher | fraction of sessions whose written state matches every expected field |
| crossProjectLeakage | n/a | proportion | lower | fraction of sessions whose written output reuses a labelled value owned by another project |
| foreignContextExposure | n/a | proportion | lower | fraction of sessions whose visible context contains a labelled value owned by another project (exposure, not output use) |
| poisonStored | n/a | proportion | lower | fraction of sessions where the canary is present in stored memory (active or archived) |
| poisonVisible | n/a | proportion | lower | fraction of sessions where the canary enters visible context |
| poisonReused | n/a | proportion | lower | fraction of sessions where the canary is written into output |
| staleUseRate | n/a | proportion | lower | fraction of superseded labels that reappear in written output |
| repeatedErrorRate | n/a | proportion | lower | fraction of correction sessions that repeat the corrected mistake in output |
| rightTimeRecall | n/a | proportion | higher | raw mean of the per-session fraction of needed labels visible before the first write; never an all-needed boolean |
| abstentionCorrectness | n/a | proportion | higher | fraction of abstention sessions whose written owner is exactly unknown |
| poisonPersistence | n/a | proportion | lower | fraction of sessions where the canary is stored, visible or reused; the three channels are reported separately |
| tokensPerSession | n/a | tokens/session | lower | wire input tokens per session |

Sessions: 0; persona mode: scripted; seed: 1887. Metric version: 2. Clusters: persona (1); project stores share persona-level user/agent state.
- Synthetic state assertions measure this controlled scenario; live comparative evidence belongs to Task 6.
- Full and OM arms reconstruct prior project dialogue in each distinct session; fabric-only arms start with a fresh conversation.
- One in-flight request can cross the token ceiling. Mock tokens are character estimates.

Memory injection token counts are estimates; item text and dataset text are excluded from evidence.
