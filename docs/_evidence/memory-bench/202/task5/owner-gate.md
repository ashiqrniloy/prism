# Plan 202 Task 5.4 — owner gate 16

Status: **approved-by-owner** on 2026-11-01. The proposal itself stays `executable: false`; this gate is the authorization.

Gate text (verbatim): Use Kilo Gateways free models

## Binding

- Manifest: `8828ec96fa4efde255ca7b07d4d855123486a14a6b2531dc461df3d4476c26a7` ([docs/_evidence/memory-bench/202/task5/development-screen-manifest.json](development-screen-manifest.json)).
- Criteria: `202-task5-candidate-gap-v2-screen` (`25922ea9280c15c3…`).
- Journal: `.cache/memory-bench/task5/journal.json`, fingerprint `7654e9d0c5d1f954bd49313b03868e1702ef8e469ddcb30065c7da1cfcb19fdf` (campaign identity over criteria, ceiling, provider, model and jobs).
- Arms: candidate `133792dba3de9d4ac27dc4d5554009e8218d399c` (product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`); control r2 `c765c8dc4b925a2a847fb1110f45bd23c099160e` (product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` from `5c2570df52a084b43120ee4e77921746a029480e`); harness `1d3c852551a14dca369a5e5698f6b42e1861916c29f0a0d00bb14a32359bb4c6`.
- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.

## Supersedes gate 15

- Gate 15 stays unedited at `docs/_evidence/memory-bench/202/task5/gates/owner-gate-15.json` (sha256 `a6fb85d6c1f1566642434342586a35205366cfcb23464b2641ede71f7c491510`, manifest `0dea417b67a019deea5a32912103225c28bd7a18ef181a1c1980f778446dbdb3`); this gate replaces it.
- This is a **transport revision, not a re-freeze**: the answer and judge model ids, prices, rules, cohort, caps and treatment (control `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0`, candidate product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`) are byte-identical. Only the free gateway moved, so the journal identity moves from `ecb83564868cece9e82d24c6fc86d05fa1f94fef0cf4c3dbd72a931c096a3809` to `7654e9d0c5d1f954bd49313b03868e1702ef8e469ddcb30065c7da1cfcb19fdf` and the screen runs fresh.

- `cells (provider prefix and derived ids; cohorts, caps and pins unchanged)`
- `cells.0.criteriaHash`
- `cells.0.evidenceProtocolHash`
- `cells.0.harnessHash`
- `cells.0.judges`
- `cells.0.productRevision`
- `cells.0.worktreeRevision`
- `cells.1.criteriaHash`
- `cells.1.evidenceProtocolHash`
- `cells.1.harnessHash`
- `cells.1.judges`
- `cells.1.productRevision`
- `cells.2.criteriaHash`
- `cells.2.evidenceProtocolHash`
- `cells.2.harnessHash`
- `cells.2.judges`
- `cells.2.productRevision`
- `cells.2.worktreeRevision`
- `cells.3.criteriaHash`
- `cells.3.evidenceProtocolHash`
- `cells.3.harnessHash`
- `cells.3.judges`
- `cells.3.productRevision`
- `cells.4.criteriaHash`
- `cells.4.evidenceProtocolHash`
- `cells.4.harnessHash`
- `cells.4.judges`
- `cells.4.productRevision`
- `cells.4.worktreeRevision`
- `cells.5.criteriaHash`
- `cells.5.evidenceProtocolHash`
- `cells.5.harnessHash`
- `cells.5.judges`
- `cells.5.productRevision`
- `cells.6.criteriaHash`
- `cells.6.evidenceProtocolHash`
- `cells.6.harnessHash`
- `cells.6.judges`
- `cells.6.productRevision`
- `cells.6.worktreeRevision`
- `cells.7.criteriaHash`
- `cells.7.evidenceProtocolHash`
- `cells.7.harnessHash`
- `cells.7.judges`
- `cells.7.productRevision`
- `comparison.candidateCells.0`
- `comparison.candidateCells.1`
- `comparison.candidateCells.2`
- `comparison.candidateCells.3`
- `comparison.controlCells.0`
- `comparison.controlCells.1`
- `comparison.controlCells.2`
- `comparison.controlCells.3`
- `criteria.transport (free Kilo AI Gateway; same panel, prices and rules)`
- `criteria.version (202-task5-candidate-gap-v2-screen)`
- `generatedAt`
- `hashes derived from the revised criteria`
- `journal identity (derived from the provider and criteria)`
- `manifestHash`
- `models (kilo/ provider prefix; same model ids at $0)`
- `product.candidate.revision`
- `product.control.revision`
- `product.harnessHash`

## Approved scope

- 8 cells (4 control/candidate pairs) over beam-100k, locomo, memoryagentbench-cr, beam-1m; arm `preset-r1` (`fabric-x-tools`); 134 development questions.
- Answer: `kilo/nvidia/nemotron-3-ultra-550b-a55b:free`; judges `kilo/dots-studio/dots-3-note-preview:free` + `kilo/cohere/north-mini-code:free`.
- Billing: free kilo routes only; no paid fallback, no cross-provider claim.

## Caps and preservation

- Reservations: 53,000,000 input tokens; ceiling 100,000,000; hard cap 16,800 physical calls; concurrency 1; wall 56 h.
- Product $0.00 / judge $0.00 / total $0.00 (quota and caps bind, not USD).
- Closed owner screen stays closed-by-owner; prior charges preserved; historical revision-1 controls reused 0; held-out access false; no credential values.

## Reproduce

```sh
timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs scripts/memory-bench/task5-screen.test.mjs
timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at 2026-10-30
```
