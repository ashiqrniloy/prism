# Plan 202 Task 5.2 — frozen paired development-screen manifest

Status: **proposed-awaiting-owner-gate**, `executable: false`. Task 5.3 must record the owner gate against manifest hash `8828ec96fa4efde2…` before any provider call.

Manifest: [docs/_evidence/memory-bench/202/task5/development-screen-manifest.json](development-screen-manifest.json) (ids, counts, hashes and budgets only).

Screen scope (plan 202 Task 5.4.6): beam-100k, locomo, memoryagentbench-cr, beam-1m; `longmemeval-m` and the full `beam-1m` cohort are deferred to plan 210. The beam-1m slice is 14 questions selected by a rule over cohort ids only.

## Product pins

- Control: revision `c765c8dc4b925a2a847fb1110f45bd23c099160e` (r2 = candidate tree with product paths from `5c2570df52a084b43120ee4e77921746a029480e`), product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` (reproduces the closed screen's revision-1 fabric hash `57aa47d94eb3cad629e232372f220296131583ea7ac06189d6f589b39c825799`).
- Candidate: committed revision `133792dba3de9d4ac27dc4d5554009e8218d399c`, product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`.
- The two arms differ only under `packages/memory/fabric/src` and `packages/memory/core/src`; a git diff outside those paths is a refusal, and so is an uncommitted candidate.
- Harness `1d3c852551a14dca369a5e5698f6b42e1861916c29f0a0d00bb14a32359bb4c6`; unchanged for both roles so only the product is the treatment.

## Cohort and cells

| Suite | Questions | Abilities | Control | Candidate | Historical surfacing |
| --- | ---: | --- | --- | --- | --- |
| beam-100k | 40 | 10 | fresh | fresh | 0 known (all null) |
| locomo | 60 | 5 | fresh | fresh | 0 known (all null) |
| memoryagentbench-cr | 20 | 2 | fresh | fresh | 0 known (all null) |
| beam-1m | 14 | 10 | fresh | fresh | 0 known (all null) |

8 cells (4 pairs). Answer model `kilo/nvidia/nemotron-3-ultra-550b-a55b:free`; judges `kilo/dots-studio/dots-3-note-preview:free` + `kilo/cohere/north-mini-code:free`. Both roles share question ids, mapping, model, judges and budgets.

## Budgets and cost

- Reservations: 53,000,000 input tokens per campaign; ceiling 100,000,000.
- Estimates: 10,095,024 input / 557,976 output tokens; 1,461–1,675 expected physical calls (measured rate, not the turn cap), hard cap 16,800.
- Product $0.00 / judge $0.00 / total $0.00 (free OpenRouter routes; quotas and caps bind, not USD).
- Concurrency 1; wall caps 28 h per role, LongMemEval-M ingest dominating.

## Frozen verdict rules

- Candidate gap: questions whose needed round set has no member returned in any successful memory.recall hit or memory.read note on the selected answer attempt. Denominator: paired questions carrying >=1 mapped needed round in both roles with complete retained tool traces in both roles.
- Halving: positive control gap requires candidateGap <= 0.5 * controlGap. Zero-gap baseline: control gap 0 requires candidate gap 0 on the same paired questions; no halving claim, pass only on exact no-loss.
- Ability guard (descriptive): every suite x ability stratum must satisfy candidate - control >= -0.03 on the observed paired accuracy.
- Failures/missingness are never zero: no fine-round labels or an unresolved gold reference are unmeasurable by suite and excluded from every estimate; never zero.

## Reuse, isolation and coverage

- Historical revision-1 controls reused: **0**. Task 5.1 established that no historical revision-1 run retained compatible tool-result traces; the owner-closed 23-cell screen stays immutable.
- Isolated artifacts: `.cache/memory-bench/task5/control` versus `.cache/memory-bench/task5/candidate`; separate answer and judge caches, product-hash-keyed write side.
- Applicable suites: beam-100k, locomo, memoryagentbench-cr, beam-1m. Out of scope: memorycode/coding-longitudinal/vibemembench/dreambench-swe (coding suites use coding arms and are Task 11, not preset-r1); beam-500k/beam-10m (optional plan suites; not drawn for the Task-5 development cohort); longmemeval-s (development-only suite with no revision-1 tool evidence; not an applicable Task-5 suite); longmemeval-m (deferred to plan 210 by the plan 202 Task 5.4.6 owner disposition; the full target is postponed, not dropped).
- Credential refs only: OPENROUTER_API_KEY; no held-out access or content.

## Reproduce

```sh
timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs
timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest --screen
```
