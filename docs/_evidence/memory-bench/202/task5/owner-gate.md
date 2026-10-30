# Plan 202 Task 5.4.5 — owner gate 9

Status: **approved-by-owner** on 2026-10-31. The proposal itself stays `executable: false`; this gate is the authorization.

Gate text (verbatim): Complete next task - [ ] Task 5.4.5: Bounded wire smoke, then resume Task 5.4 and update the plan once done

## Binding

- Manifest: `48395537a565254f4deee41d6a04f06eb2ad7059fc2408c40ab32d68215044a2` ([docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json](development-comparison-manifest.json)).
- Journal: `.cache/memory-bench/task5/journal.json`, fingerprint `e3d8ac7d031aa5dcfad250b7dd7e84472fb517d8268eeafd2236b87dcf21ab32` (campaign identity over criteria, ceiling, provider, model and jobs).
- Arms: candidate `076677a5c041187919a87534eb9ecb1df1e9a5c4` (product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`); control r2 `5355f41ed101f122b15e6973707782b017972dbb` (product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` from `5c2570df52a084b43120ee4e77921746a029480e`); harness `a7be89b4a10303446e4387a92061f4a8426d8195504cafe58e209f7ffda3eb0d`.
- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.

## Supersedes gate 8

- Gate 8 stays unedited at `docs/_evidence/memory-bench/202/task5/gates/owner-gate-8.json` (sha256 `9f572c8c2debbbe925e2aa90aa8c666a5c864a29f328deccd50b5a2de8abb325`, manifest `680b52e12fcce4aac4d4c111375028847d9cc4e9ebf314296e5cbea2bf254fdd`); this gate replaces it.
- Journal identity is unchanged (`e3d8ac7d031aa5dcfad250b7dd7e84472fb517d8268eeafd2236b87dcf21ab32`) because the cohort, criteria, protocol, models, judges, budgets and caps did not move: only the fields below changed.

- `cells.0.harnessHash`
- `cells.0.productRevision`
- `cells.0.worktreeRevision`
- `cells.1.harnessHash`
- `cells.1.productRevision`
- `cells.2.harnessHash`
- `cells.2.productRevision`
- `cells.2.worktreeRevision`
- `cells.3.harnessHash`
- `cells.3.productRevision`
- `cells.4.harnessHash`
- `cells.4.productRevision`
- `cells.4.worktreeRevision`
- `cells.5.harnessHash`
- `cells.5.productRevision`
- `cells.6.harnessHash`
- `cells.6.productRevision`
- `cells.6.worktreeRevision`
- `cells.7.harnessHash`
- `cells.7.productRevision`
- `cells.8.harnessHash`
- `cells.8.productRevision`
- `cells.8.worktreeRevision`
- `cells.9.harnessHash`
- `cells.9.productRevision`
- `generatedAt`
- `manifestHash`
- `product.candidate.revision`
- `product.control.revision`
- `product.harnessHash`

## Approved scope

- 10 cells (5 control/candidate pairs) over beam-100k, locomo, memoryagentbench-cr, longmemeval-m, beam-1m; arm `preset-r1` (`fabric-x-tools`); 210 development questions.
- Answer: `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; judges `openrouter/dots-studio/dots-3-note-preview:free` + `openrouter/cohere/north-mini-code:free`.
- Billing: free OpenRouter routes only; no paid fallback, no cross-provider claim.

## Caps and preservation

- Reservations: 69,000,000 input tokens; ceiling 100,000,000; hard cap 16,800 physical calls; concurrency 1; wall 416 h.
- Product $0.00 / judge $0.00 / total $0.00 (quota and caps bind, not USD).
- Closed owner screen stays closed-by-owner; prior charges preserved; historical revision-1 controls reused 0; held-out access false; no credential values.

## Reproduce

```sh
timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs
timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at 2026-10-30
```
