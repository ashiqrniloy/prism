# Plan 202 Task 5 evidence

## Task 5.4 — execution attempted, blocked (2026-10-30)

`campaign.mjs --task5` (backed by [task5-execute.mjs](../../../../scripts/memory-bench/task5-execute.mjs))
re-asserts gate 5, refuses a changed manifest or journal identity, prepares the
revision-1 control worktree with its own `node_modules` and the frozen harness, and
re-audits both products before and after. Preflight passed and journal
`campaign-42aa7a93ee64` opened under the approved 100M ceiling.

The first approved cell (`control / beam-100k`) then aborted on question 1 with a
provider 400:

> Validation: Function at index 0 has an invalid name: "memory.recall".
> Only a-z, A-Z, 0-9, underscores, and dashes are allowed.

The product exposes dotted tool names (`memory.recall`, `memory.read`); the
approved OpenRouter/Nvidia route only accepts `[a-zA-Z0-9_-]`. A one-call probe on
the same model reproduced the 400 with a dotted name; `nemotron-3.5-super-vl:free`
also returned 400, `gemma-4-31b-it:free` 429 and `thinkingmachines/inkling:free`
403 (agentic harnesses only). The attempt kept its 7.5M reservation
(`usageComplete: true`, confirmed 0 tokens), charged $0, and its report/journal
record the failure.

Second constraint: `:free` routes bind on requests, not USD. The key has a $50
limit and $49.94 remaining, but the diagnostics already hit
`Rate limit exceeded: free-models-per-min`; the campaign's expected 4,200
physical calls exceed the free daily allowance, so even after a schema fix a full
10-cell run spans multiple days (resumable through the journal).

Nothing frozen changed: product, cohort, criteria, model, judges, caps and gate
text stand. [execution-run.json](execution-run.json) and
[execution-verification.json](execution-verification.json) hold the text-free
accounting. Unblock options: (a) benchmark-side wire encoding of dotted tool
names, re-frozen and re-gated before any outcome (no product change); (b) an
owner-approved different free route or relaxed free-only rule. Task 5.4 is not
complete and Task 5.5 has no paired outcomes to analyse.

## Task 5.4.5 — bounded wire smoke and resume (2026-10-31)

- `campaign.mjs --task5-smoke` runs the approved jobs filtered to one question per `beam-100k`
  arm, under `journal-smoke.json` and the `smoke-` evidence prefix. Build refuses more than two
  questions.
- Smoke result: both arms answered on `nvidia/nemotron-3-ultra-550b-a55b:free` (the route that
  rejected dotted names on the Task 5.4 attempt), statuses `partial`, 73k tokens, $0.
  `execution-smoke-verification.json` records the observed tool name (`memory.recall` only) and
  20 returned notes; no trace carries `memory_recall`. Reports and paired answer caches live in
  `smoke-*.json` and `.cache/memory-bench/task5/{control,candidate}/answers`.
- `control-verification.json` records the control worktree suite attempts: a pre-existing
  cross-file isolation flake in the fabric suite is retried up to three times and every attempt is
  written down.
- Gate 9 (`manifestHash 48395537…`, candidate `076677a5…`, control r2 `5355f41e…`) supersedes
  gate 8; gates 5-8 remain archived under `gates/`. Full campaign
  `campaign-e3d8ac7d031a` started afterwards and halts/resumes on the free daily quota.

## Status log — 2026-10-31

- Overnight leg 1 (gate 9): control `beam-100k` 40/40 completed (1,102,309 tokens),
  candidate 9/40 then a real `429 Daily quota exhausted`. Journal `quota-daily`, $0.
  Archived as `journal-campaign-e3d8ac7d031a-1.json`.
- Resume blockers fixed at gates 10 and 11: dirty non-executable paths (plans/docs written by
  another process) no longer block preflight; a checkpoint from another `sourceRevision` is
  dropped instead of resumed (`MemoryBenchResumeMismatch`).
- Gates 10 (`manifestHash c9c6b88b…`) and 11 (`manifestHash 90862ef1…`, candidate `d21b9305…`,
  control r2 `51d23d4e…`) are archived alongside 5-9; the campaign restarted under gate 11 from a
  fresh journal.
- Leg 2 (gate 11): control and candidate `beam-100k` completed, control `locomo` 60/60,
  candidate `locomo` 55/60, then a genuine daily 429 (`resumeAfter 2026-11-01T00:00:00Z`).
- Gates 12-14 fix two more guards: a commit after the pin may touch plans and docs
  (`task5PostFreezePaths` filters executable paths only, like the clean check), and a report's
  revision is the arm's product hash (`PRISM_MEMORY_BENCH_SOURCE`), not its worktree commit, so a
  harness amend can no longer orphan a checkpoint. The campaign manifest carries `productRevision`.
- Cost of the churn: 6.7M free-quota tokens orphaned across two legs, $0 spent. Latest gate 14
  (`manifestHash 2694bf39…`). No harness or product edit from here until the campaign finishes.

## Task 5.4.4 — gate 6 replaces gate 5 (2026-10-31)

- Re-frozen after the Task 5.4.3 harness change: `manifestHash dca330de…`, candidate
  `c539e38c…` (product `26bf9013…`), control r2 `2e51437e…` (product `ad25add4…` from
  `5c2570df…`), harness `9032ef67…`. Journal identity unchanged at `e3d8ac7d…`.
- Gate 6 (`owner-gate.json`) binds the arms explicitly and records the owner text
  verbatim. Gate 5 is archived unedited in `gates/` (`owner-gate-5.json`, sha256
  `08290147…`, manifest `061323d5…`) together with its manifest; gate 6 carries that
  sha256 and the list of all 45 changed leaves.
- `TASK5_REFREEZE_ALLOWED` + `assertTask5RefreezeDiff` prove the cohort ids,
  `criteriaHash`, the evidence protocol, models, judges, budgets, caps and
  `baselineReuse` are byte-identical to gate 5. The pacer lives at the provider edge in
  `run.mjs`, so `evidenceProtocol.toolSurfacing` (a fingerprint of `replay.mjs`) did not
  move.
- The finished journal `campaign-42aa7a93ee64` (one failed attempt, 7.5M reserved, $0)
  is archived here as `journal-campaign-42aa7a93ee64.json` and removed from the cache by
  preflight; an open journal is never archived because it is the resume point.

## Task 5.4.3 — measured call estimate, daily-quota halt, key tier, shared pacer (2026-10-31)

- `expectedPhysicalCalls` 2,289 (range 2,289–2,625) from measured rates — solver 3.2,
  judge 2.25 per question on `preset-r1 beam-100k` with `labelInjections: "off"`
  (127 and 90 calls over 40 questions) — instead of the 4,200 turn-cap formula. The
  16,800 hard cap is unchanged; `budgets.campaign.physicalCallEstimate` cites the source.
- A daily free-model 429 (`free-models-per-day*`, classified by the diagnostic harness's
  `rateLimitDisposition`) writes a `quota-daily` attempt, halts the journal with
  `status: "quota-daily"` and `resumeAfter` (next UTC midnight), skips the 15-minute
  pause, and does not consume the job's attempts. A rerun resumes the cell from its
  answer and judge checkpoints, so no completed answer is re-requested.
- One shared pacer for free routes (20/minute, `PRISM_MEMORY_BENCH_FREE_PACE_PER_MINUTE`)
  covers the solver, the product's workers and both judges; a value above 20 is refused.
  Paid routes keep the per-model pacer.
- Preflight reads `GET /api/v1/key` and records the reduced tier in `free-key.json`;
  below 1,000 free requests/day it refuses to start. Live read 2026-10-30:
  `paidTier: true`, `dailyFreeRequests: 1000`, $49.94 remaining.
- Freeze re-run after the harness change: candidate `bbc4369a…`, control r2 `420d6ab0…`
  (product `ad25add4…`), `manifestHash` re-frozen (see Task 5.4.4), journal identity `e3d8ac7d…`.

## Task 5.4.2 — arms pinned to commits that differ only in the product paths (2026-10-31)

- Candidate: commit `2a8a0cdd…`, product `26bf9013…`. Nothing is read from the
  working tree; an uncommitted path (other than `.cache/`, this evidence directory
  and the plan) is a refusal.
- Control r2: `e10f6964…`, a deterministic overlay commit (fixed author/committer
  metadata) = the candidate tree with `TASK5_PRODUCT_PATHS` replaced by the bytes
  from `TASK5_CONTROL_PRODUCT_SOURCE = 5c2570df…`. `task5ControlRevision` rebuilds
  it and `auditTask5Comparison` refuses a pin that does not reproduce.
- Control product `ad25add4…` and the revision-1 fabric-only hash `57aa47d9…` are
  reproduced from r2 and from the source commit respectively.
- `git diff --name-only r2 candidate` lists only `packages/memory/{fabric,core}/src`;
  the classifier refuses `src/`, `scripts/memory-bench/` and provider paths. Commits
  after the candidate pin may touch only this directory or the plan.
- New regressions: `task5_control_differs_from_candidate_only_in_product_paths`,
  `task5_control_product_hash_reproduces_revision1`,
  `task5_refuses_uncommitted_candidate`.
- Preflight now: refuses dirty paths, rebuilds r2, checks out `.cache/memory-bench/task5/control-worktree`
  at r2, requires the worktree harness to equal the frozen harness, and runs
  `bun test --concurrency=1 packages/memory/fabric packages/memory/core` plus
  `bun run typecheck` inside the worktree. Serial test execution is deliberate —
  those suites share temp state across files and flake in parallel (pre-existing).
- Manifest re-frozen to `061323d5…`; gate re-recorded against the same journal
  identity `e3d8ac7d…`.

## Task 5.3 — owner gate 5 recorded (2026-10-30)

[owner-gate.json](owner-gate.json) (readable [summary](owner-gate.md)) records
the owner approval, verbatim text included, against the frozen proposal. It binds
`manifestHash 061323d5…` and the campaign journal identity
`e3d8ac7d…` (criteria, ceiling, provider, model and jobs); a changed manifest,
cohort, criteria or journal is a refusal, not a re-approval. Approved scope: 10
cells / 5 pairs / 210 development questions, arm `preset-r1`, one answer model
and two plain-text judges — **free OpenRouter routes only**, no paid fallback.
Caps: 69,000,000 reserved input tokens, 100,000,000 ceiling, 16,800 physical
calls, concurrency 1, 416 h wall. Product $0 / judge $0 (quota and caps bind).
The closed owner screen and all prior charges remain untouched; the gate record
carries no credential value and no benchmark text.

`assertTask5OwnerGate` recomputes the binding and refuses an unapproved, drifted
or paid gate (`task5_execution_refuses_unapproved_or_changed_manifest`). The
proposal file itself stays `executable: false`; the gate is the authorization.
Recording the gate made no provider or model call. Task 5.4 (execution) is next
and must keep the free-only restriction.

## Task 5.2 — frozen paired development-comparison manifest (2026-10-30)

The bounded proposal is [development-comparison-manifest.json](development-comparison-manifest.json)
with a readable [summary](development-comparison-manifest.md). It freezes 10 cells — one
revision-1 control and one Task-5 candidate for each of the five development
suites that carry revision-1 evidence (210 frozen ids, 172 mapped, 3 unresolved
and 35 without fine-round labels). Control product `ad25add4…` is the revision-1
git tree `5c2570df…` (its fabric hash reproduces the closed screen's `57aa47d9…`);
the candidate is the current working-tree product. Harness, analysis, criteria and
evidence-protocol hashes are identical across both roles, so only the product is
the treatment.

The proposal is **not executable**: no provider or model call occurred, and Task
5.3 binds the owner gate to `manifestHash 061323d5…` plus the journal
identity (recorded above). The manifest was re-frozen after the gate machinery
was added to the harness, so only the gate-bound hash is current.
Historical revision-1 controls reused: **0**. Answer model
`openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; free plain-text judges
`openrouter/dots-studio/dots-3-note-preview:free` and
`openrouter/cohere/north-mini-code:free`; both roles cost $0 (free routes), so
caps and quota bind instead of USD. Budgets: 69,000,000 reserved input tokens
against a 100,000,000 ceiling, ~15.8M input / ~0.87M output estimated tokens,
4,200 expected and at most 16,800 physical calls, serial concurrency, 416 h
cumulative wall caps dominated by LongMemEval-M ingest.

Frozen before any outcome: the candidate-gap numerator/denominator, the 50%
halving rule, zero-gap handling, failure/missingness treatment, the 0.03 ability
non-regression margin and the paired cluster-bootstrap analysis. `--answers-dir`
and `--judge-cache-dir` keep the roles' checkpoints separate; product-hash-keyed
write-side snapshots keep enrichment out of the control. Coding, optional and
LongMemEval-S suites are declared out of scope with reasons, so the five-suite
comparison narrows nothing silently. Tests:
`timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs`
(`task5_manifest_refuses_product_or_cohort_drift`,
`task5_manifest_refuses_heldout`,
`task5_comparison_requires_matching_budgets_and_evidence_protocol`).

## Task 5.1 — revision-1 tool-result trace audit

Completed offline on 2026-10-30. **The closed screen cannot supply the tool-result candidate-gap baseline.** All 210 revision-1 question dispositions have unknown surfacing (`null`), rather than zero gaps. Task 5.1 is complete as an inventory; Task 5's measured target remains open. No provider requests, answer regeneration or campaign resume occurred.

The [inventory](revision1-trace-inventory.json) verifies all 23 accepted report hashes and pins the original manifest/product hash, report source revisions/protocol/run-path fingerprints, current mapping code and historical runner code. It hashes 783 retained private answer/checkpoint artifacts and five preset progress logs. None of the 210 report-derived cache keys matches a retained trace or answer checkpoint. Separate pilot/repaired-run traces cannot establish provenance for these answers even where question ids overlap. Questions, source text, answers, queries and result bodies remain private.

| Historical development control | Questions | Mapped fine gold | Unresolved gold | No fine-round labels | Tool surfacing known |
| --- | ---: | ---: | ---: | ---: | ---: |
| BEAM-100K | 40 | 36 | 0 | 4 | 0 |
| LoCoMo | 60 | 60 | 0 | 0 | 0 |
| MemoryAgentBench-CR | 20 | 0 | 0 | 20 | 0 |
| LongMemEval-M | 50 | 43 | 0 | 7 | 0 |
| BEAM-1M | 40 | 33 | 3 | 4 | 0 |
| Total | 210 | 172 | 3 | 35 | 0 |

Mapping uses repaired `causalSessions`, `sessionRounds` and `extractEvidence` on frozen `dev` ids, with cached dataset hashes verified and fetching disabled. All 60 LoCoMo questions now map to rounds. Three BEAM-1M questions have ambiguous source references, recorded by id in the inventory. No fine labels, unresolved labels and missing traces are separate conditions. MAB additionally has invalid historical ingestion: fact-list inputs produced no exchange notes, so its results cannot establish conflict-resolution efficacy.

The historical runner saved answers/injections only in `phase === "answer"`; all-phase screen runs did not retain per-call delivery traces. Public `recalledIds` mix passive and explicit evidence and omit direct-read accounting. Tool names/counts, question-only rankings, hidden candidates, passive blocks and progress logs cannot recover successful tool-result presence. Historical reports remain unchanged.

Task 5.2 needs **five fresh revision-1 control cells covering these same 210 ids**. `requiredFreshControls` lists each suite/id and historical model/product identity. Freeze corrected ingestion (including MAB's supported fact adapter), label/missingness rules, successful recall/read result collection, private note-to-round mappings, budgets and judges, with isolated control/candidate stores. The historical paid Muse model is provenance only: the current user permits **OpenRouter free models only** for later live work. Changing models requires fresh matched controls/candidates. These five cells do not narrow the all-applicable-suite or broader multi-model target; Task 5.2 must declare additional coverage and unsupported suites explicitly.

The [audit script](../../../../../scripts/memory-bench/audit/task5-traces.mjs) refuses non-development reports, hash mismatches, changed closed artifacts, or an unexpected matching trace requiring provenance review. Recovery credits only successful recall/read results from the selected answer attempt with verified note-to-round mappings, using `toolSurfacing`. Incomplete traces, unresolved gold, unmapped results and absent fine labels cannot prove a negative. Round presence does not prove every labelled fact survived excerpts.

Reproduce from the repository root using cached datasets and benchmark Python:

```sh
PRISM_MEMORY_BENCH_PYTHON=.cache/memory-bench/python/bin/python3 timeout 240 bun scripts/memory-bench/audit/task5-traces.mjs
timeout 120 bun test --timeout=0 scripts/memory-bench/audit/task5-traces.test.mjs scripts/memory-bench/tool-surfacing.test.mjs scripts/memory-bench/measurement-repairs.test.mjs
```

Verification: 14 focused tests plus 65 documentation/example checks (79 total), root typecheck/build, formatting and diff checks pass. Four audit regressions cover hidden/passive/failed-result exclusion, missing-trace unknowns, incomplete labels/mappings and failed-attempt exclusion. The [verification record](verification.json) rechecks source/private hashes and closed-screen immutability. No product/config/export/dependency change; release and PostgreSQL checks were outside this offline evidence task.
