# Plan 210 evidence: memory feature audit

Evidence for plan 210 (memory feature audit, then the single held-out acceptance). Reports carry ids, paths,
hashes, counts, rates and short effect statements only. They hold no note, question, answer or fixture text.

| File | What it is |
| --- | --- |
| `feature-ledger.json` | Task 1. One row per memory feature, with its status and the evidence behind it. |
| `gap-predictions.json` | Task 3.1. Predicted effects of the recall-quality variants. Task 5 scores them. |

## Feature ledger (Task 1, 2026-11-07)

Build, check and prove:

```sh
timeout 120 bun scripts/memory-bench/feature-ledger.mjs --out docs/_evidence/memory-bench/210/feature-ledger.json
timeout 120 bun scripts/memory-bench/feature-ledger.mjs --check          # committed file == fresh build
timeout 900 bun scripts/memory-bench/feature-ledger.mjs --verify-tests   # runs every named safety test
timeout 300 bun test --timeout=0 scripts/memory-bench/feature-ledger.test.mjs
```

### How it is built

The build is offline and makes no model call.

- **Read from the code.** The builder reads these sources itself, so nothing is restated by hand:
  - the config schemas: `memoryFabricConfigSchema`, `memoryObservationalConfigSchema` and the wiki definition's `config`;
  - the `MemoryNoteKind` union;
  - the tool and command names in source;
  - `presetFields()` for preset membership;
  - `scripts/memory-bench/defaults.json` for defaults.
- **Written by hand.** The list of mechanisms and their statuses is in `scripts/memory-bench/feature-ledger-features.mjs`.

The build fails in any of these cases:

- **Coverage:**
  - any config field, kind, tool or command is not claimed by a row;
  - a row claims surface that no longer exists.
- **Evidence:**
  - an evidence file is missing (each entry carries its sha256);
  - a `benefit`, `neutral` or `negative` row has no evidence.
- **Safety status:**
  - a `safety-proven` row has no safety or inspectability role, or no named test that exists;
  - a row whose only roles are safety or inspectability is anything but `safety-proven` or `unmeasured`.
- **Plan 202 closure:**
  - a source-task row of `202/closure.md` is missing (the task list is parsed from that file);
  - Task 17 or F4 is missing or reads as measured;
  - a mandatory candidate (Tasks 6–12) is not a candidate;
  - Task 4 `baselineComplete` or the Task 5 screen `miss` changed.
- **Task 5 hand-off:** a 202 Task 5 deferred suite claims a status.
- **Earlier hand-offs:** an open 188.7 finding, a 188.11 limitation or a plan 208/209 hand-off has no owning row.

`--verify-tests` ran all 37 named tests on 2026-11-07, and all 37 passed.

### Result

The ledger has **108 features**. It covers 220 config paths (fabric, OM and wiki), 9 kinds, 8 tools and 18 commands.

| Status | Rows | Ids |
| --- | ---: | --- |
| `benefit` | 4 | `write.exchange-archive`, `kind.exchange`, `preset.conversational`, `delivery.read-tools` |
| `neutral` | 3 | `recall.supersession-hint`, `write.om-promotion`, `ontology.trigger.co-read` |
| `negative` | 0 | — |
| `unmeasured` | 87 | everything else that is not safety-proven |
| `safety-proven` | 14 | scope isolation, claim lint, OM worker limits, OKF files, export/import, forward compatibility, trust scan, redaction, deletion cascade, provenance, legal holds, consent, file jail, resource limits |

There are **90 candidates** for Tasks 2–5 (`neutral` plus `unmeasured`). The ledger's `candidates` section also lists:

- the live and model-answer measurements that plan 202 Tasks 14–16 left open;
- the two deferred levers, Task 13 (typed links) and Task 17 (facts / F4). Neither is built, so neither is an installed feature that could be removed.

### What to read with care

- **Where the `benefit` evidence comes from.** All four rows rest on LongMemEval-S, from plan 188.9's held-out v2 and plan 188.10's held-out v3.
  - Those are earlier plans' partitions. Plan 210's own held-out partitions are unread.
  - The 188.9 exchange-archive gain is confounded with that plan's delivery change.
  - Every other suite and model is open (188.11 limitation `one-benchmark-family`).
- **No feature is `negative`.**
  - The 202 Task 5 screen missed. None of its paired differences excludes zero, so enrichment and navigation are `unmeasured` overall, with `neutral` on each screened suite.
  - LongMemEval-M, full BEAM-1M and MemoryAgentBench-CR are `unmeasured` for both.
  - The 209 `+W` no-harm read (−7.1 points, CI [−16.7, 0]) is advisory. Each `+W` row records it, and the rows stay `unmeasured` because only the bundle was measured.
- **Statuses for mixed roles.** Where a row has one role measured and another not (the lifecycle capacity rows, the durable stores), `roleStatus` says which is which. The status records the unmeasured role, so the row stays a candidate.
- **Task 2 leads**, found while building the ledger:
  - `lifecycle.verification`: verified share 0 in every offline lifecycle arm;
  - `delivery.weak-tool-caller`: the two-turn trigger never fires in one-question sessions;
  - `om.commands` and `fabric.toggle-status`: their inspectability role has no named test yet.
- **The 202 Task 5 manifest hash.** Plan 202 Task 5.7 cites the prefix `a19a5ab7…`, which matches neither the manifest's `manifestHash` nor its file hash. The ledger records the values read from the file: `manifestHash` `461167af…47fe`, file sha256 `2cbb2f82…22c9`, 10 cells.
