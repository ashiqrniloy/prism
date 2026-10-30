# Plan 202 Task 5.2 — frozen paired development-comparison manifest

Status: **proposed-awaiting-owner-gate**, `executable: false`. Task 5.3 must record the owner gate against manifest hash `061323d5a058edd4…` before any provider call.

Manifest: [docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json](development-comparison-manifest.json) (ids, counts, hashes and budgets only).

## Product pins

- Control: revision `e10f6964ea866eedeca5be69fa36fce139f8fe67` (r2 = candidate tree with product paths from `5c2570df52a084b43120ee4e77921746a029480e`), product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` (reproduces the closed screen's revision-1 fabric hash `57aa47d94eb3cad629e232372f220296131583ea7ac06189d6f589b39c825799`).
- Candidate: committed revision `2a8a0cdd1eaeb26c8b4a3441d97a3520d6be3a15`, product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`.
- The two arms differ only under `packages/memory/fabric/src` and `packages/memory/core/src`; a git diff outside those paths is a refusal, and so is an uncommitted candidate.
- Harness `0e66804b0da22650406c773e034b626ed853ae3b17a8d006950b751130db0296`; unchanged for both roles so only the product is the treatment.

## Cohort and cells

| Suite | Questions | Abilities | Control | Candidate | Historical surfacing |
| --- | ---: | --- | --- | --- | --- |
| beam-100k | 40 | 10 | fresh | fresh | 0 known (all null) |
| locomo | 60 | 5 | fresh | fresh | 0 known (all null) |
| memoryagentbench-cr | 20 | 2 | fresh | fresh | 0 known (all null) |
| longmemeval-m | 50 | 7 | fresh | fresh | 0 known (all null) |
| beam-1m | 40 | 10 | fresh | fresh | 0 known (all null) |

10 cells (5 pairs). Answer model `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; judges `openrouter/dots-studio/dots-3-note-preview:free` + `openrouter/cohere/north-mini-code:free`. Both roles share question ids, mapping, model, judges and budgets.

## Budgets and cost

- Reservations: 69,000,000 input tokens per campaign; ceiling 100,000,000.
- Estimates: 15,820,560 input / 874,440 output tokens; 4,200 expected physical calls, hard cap 16,800.
- Product $0.00 / judge $0.00 / total $0.00 (free OpenRouter routes; quotas and caps bind, not USD).
- Concurrency 1; wall caps 208 h per role, LongMemEval-M ingest dominating.

## Frozen verdict rules

- Candidate gap: questions whose needed round set has no member returned in any successful memory.recall hit or memory.read note on the selected answer attempt. Denominator: paired questions carrying >=1 mapped needed round in both roles with complete retained tool traces in both roles.
- Halving: positive control gap requires candidateGap <= 0.5 * controlGap. Zero-gap baseline: control gap 0 requires candidate gap 0 on the same paired questions; no halving claim, pass only on exact no-loss.
- Ability guard: every suite x ability stratum must satisfy candidate - control >= -0.03 on the observed paired accuracy.
- Failures/missingness are never zero: no fine-round labels or an unresolved gold reference are unmeasurable by suite and excluded from every estimate; never zero.

## Reuse, isolation and coverage

- Historical revision-1 controls reused: **0**. Task 5.1 established that no historical revision-1 run retained compatible tool-result traces; the owner-closed 23-cell screen stays immutable.
- Isolated artifacts: `.cache/memory-bench/task5/control` versus `.cache/memory-bench/task5/candidate`; separate answer and judge caches, product-hash-keyed write side.
- Applicable suites: beam-100k, locomo, memoryagentbench-cr, longmemeval-m, beam-1m. Out of scope: memorycode/coding-longitudinal/vibemembench/dreambench-swe (coding suites use coding arms and are Task 11, not preset-r1); beam-500k/beam-10m (optional plan suites; not drawn for the Task-5 development cohort); longmemeval-s (development-only suite with no revision-1 tool evidence; not an applicable Task-5 suite).
- Credential refs only: OPENROUTER_API_KEY; no held-out access or content.

## Reproduce

```sh
timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs
timeout 120 bun scripts/memory-bench/task5-comparison.mjs --manifest
```
