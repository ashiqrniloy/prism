# Plan 188.7 paid acceptance (OpenCode Go, 2026-10-22)

Status: **incomplete; Task 8 remains unchecked.** A paid campaign ran under a fresh owner-approved
ceiling of 106,000,000 input tokens. It did not complete enough required arms for an acceptance or
default-enablement claim.

## Spend and reliability

| Item | Value |
| --- | ---: |
| Approved ceiling | 106,000,000 |
| Prior reservation imported from 188.6 | 14,733,610 |
| Charged this campaign (durable journal) | 80,067,335 |
| Remaining after stop | 25,932,665 |
| Durable attempts | 17 |
| Completed / token-ceiling / failed / setup-failure / abandoned | 6 / 2 / 5 / 2 / 2 |
| Required manifest jobs | 56 |
| Completed required jobs | 6 |

Every attempt kept its reservation. Incomplete usage is charged at its allocation, so the charged
figure is conservative. `spend-summary.json` and `spend-journal.json` are the accounting source.
No paid process was left running.

## Completed measurable arms

| Arm | Result | Input | Usage complete |
| --- | --- | ---: | --- |
| LongMemEval-S `full` | 100/140 (0.714) | 16,017,060 | no |
| LongMemEval-S `fabric` | 62/140 (0.443) | 329,669 | no |
| MemoryAgentBench-CR `full` | 18/40 | 11,032,677 | yes |
| MemoryAgentBench-CR `fabric` | 18/40 | 82,309 | yes |
| Lifecycle `full`, persona 1887 | 24 sessions; task success .292; leakage 0 | 62,019 | yes |
| Lifecycle `fabric` promotion off, persona 1887 | 24 sessions; task success .708; leakage 0; foreign-context exposure .542 | 303,201 | yes |

The LongMemEval-S pair is the confirmatory 140-question set (20 per ability), paired by question.
Fabric loses **-0.2714 overall** (95% CI -0.3643..-0.1786; raw p ~1e-4; Holm p 0.0008). Significant
Holm losses: knowledge-update -0.5, multi-session -0.5, single-session-user -0.45. Abstention is not
different. Fabric spends about 48x fewer wire input tokens, but usage is incomplete, so no monetary
or non-inferiority claim is made.

MemoryAgentBench-CR is a tie (18/40 each), with capped/partial token accounting on the full arm in
earlier campaigns; this arm is descriptive only.

## Partial and failed arms

| Arm | Outcome |
| --- | --- |
| LongMemEval-S `om` | one-question probe, 1/1 correct, 2,475,590 input; the cap cannot hold the arm |
| LongMemEval-S `om+fabric` | token-ceiling after 2 questions with `MemoryBenchWorkerError`, 3,001,610 input |
| LongMemEval-S `fabric-agentic` | `RunLimitError` at 8 turns after 2/140 questions; skipped after the pilot |
| LoCoMo `full` | budget partial: 102/115 questions, 81 correct, 4,598,896 input; comparison only |
| Lifecycle `fabric` promotion on, persona 1887 | abandoned at 9/24 sessions after repeated agent-completion failure; no safety claim |
| Lifecycle `om+fabric` | `LifecycleObserverError` at 0 sessions; all 12 persona arms skipped |
| Lifecycle personas 1888-1898 | not run; 12-persona powered safety gate missing |

## Finding matrix

`findings.json` contains all 13 rows and passes `validateFindingMatrix`. Summary:

- **Fixed:** F1, F2, F5, F6, F8, F10, F11, F12.
- **Inconclusive:** F3, F4, F9. F3 remains a blocker: the paid promotion-off arm reported zero
  labelled cross-project leakage but **0.5417 foreign-context exposure**, and promotion-on never
  completed. F4 and F9 have no completed paid combined-extraction arm.
- **Unresolved:** F7 (12-persona power), F13 (passive retrieval quality).

## Decision

Retain promotion and injection off, lexical retrieval and the 0.35 injection fallback provisional.
`defaults.json` is unchanged and remains provisional. The evidence does not meet the quality,
safety, power or comparable-cost gates. In particular:

1. Fabric is not a full-context substitute (-0.2714, significant ability losses).
2. The 12-persona paid safety gate is incomplete, and promotion-off still shows unexplained
   foreign-context exposure.
3. Missing usage blocks monetary and non-inferiority claims.
4. `om`, `om+fabric`, `fabric-agentic`, complete LoCoMo and the full lifecycle safety set are missing.

Task 8 and 188.6 Task 6 therefore stay unchecked. The next paid campaign needs a new owner-approved
cap and a design that either measures OM/agentic within budget or explicitly narrows those claims.

## Reproduction

```bash
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance --manifest
timeout 300 bun scripts/memory-bench/acceptance-report.mjs
```

`acceptance-comparisons.json`/`.md` are generated only from ids, scores, statuses and hashes.
The frozen manifest is `acceptance-manifest.json`; the durable journal is `spend-journal.json`.
