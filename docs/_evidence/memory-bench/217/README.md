# Plan 217 evidence: short-term memory (gate M-1)

Evidence for plan 217 (STM: scope-blind events, verbatim chunks, habituation). Every file carries ids, counts,
scores and hashes only, never question, gold, chunk or transcript text. The rows (S1–S4) and their tests come from
`scripts/memory-bench/memory-model-criteria.json`, which plan 216 Task 2 froze. Amendment 1 of that file
(2026-11-09, this plan's Task 6) adds only the two fixture hashes gate M-1 reads.

| File | What it is |
| --- | --- |
| `stm-probes.json` | Task 5. The eight offline STM mechanism probes on the long-session fixture. All eight read `works`. S2 is read from `stm.recall-verbatim`. |
| `gates/owner-gate-m1.json` | Task 6. The gate M-1 record: budget, models, arms, partitions, caps, and the manifest hash it binds. Each sitting started on the owner's word. |
| `runs/` | Task 6. The campaign's reports (`run-217-m1-<job>.json`), execution manifest, preflight and run summary. Written by the paid run. |
| `s4-justification.md` | Task 6, only if S4's worker-token ratio exceeds 1.25: the written justification the row allows. |

The manifest is `../memory-model/M-1/manifest.json`. The evidence and verdicts are `../memory-model/M-1/evidence.json`
and `verdicts.json`, from `acceptance-report.mjs --plan memory-model --gate M-1 --build --write`.

## Gate M-1 result (2026-11-12)

**Run and closed (owner: "Let's accept and close task 6", 2026-11-12).** Verdicts on the development partition:
S1 **miss** (DeepSeek +0.47 [−0.19, 1.16], MiMo −0.34 [−0.69, −0.06]), S2 **pass**, S3 **deferred** to gate A, S4
**pass** (0.615). Replication on GLM-5.3 Flash and MiniMax M3.1 Flash is outside the verdict (`evidence.replication`).
Every amendment and the owner's words for each sitting are in `gates/owner-gate-m1.json`; reports replaced by a
product change are in `runs/superseded-*/`. Plan 217 Task 6 has the full notes; the carried work is in plan 218
(Tasks 1.1, 2, 4.1, 5 and 6), plans 219, 219.1 and 221, and gate A (plan 223 Task 2).

## Gate M-1 status before the run (2026-11-09)

**Ready, not run.** The owner chose to build the machinery now and run the full development cohort later, on the
owner's word ("Build now, run full later"; models "C-1 roles"). On 2026-11-09, $37.03 of the $60 Ollama Cloud
allowance was left until 2026-12-07. The manifest estimates the full gate at about 2.6 billion input tokens, about
**$116** at the billed rate of the past week ($0.044 per million). The worker arms dominate that cost: they re-observe
each BEAM-1M history (about 10M tokens per question) and each LongMemEval-M history (about 5M, estimated).

Before the run, already checked offline:

- both trees' `om` arms replay the offline suite: STM from this tree, OM-before from the pinned worktree at `37ee1a24`;
- the long-session family runs the `OM-before` and `memory-off` arms in the worktree and `STM` here, with worker and
  eligible tokens metered;
- the campaign refuses to start while the record is unapproved.

To start: set `approved: true`, `approvedAt`, and the owner's words in `text` in `gates/owner-gate-m1.json`, check
that `manifestHash` equals `../memory-model/M-1/manifest.json`'s (regenerate it with `campaign.mjs --plan memory-model
--gate M-1 --partition dev --manifest` if the harness changed), then follow `scripts/memory-bench/README.md` "Gate M-1".
