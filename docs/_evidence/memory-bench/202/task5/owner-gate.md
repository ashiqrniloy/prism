# Plan 202 Task 5.4.5 — owner gate 11

Status: **approved-by-owner** on 2026-10-31. The proposal itself stays `executable: false`; this gate is the authorization.

Gate text (verbatim): Do a status check now

## Binding

- Manifest: `90862ef1c2f0f239f2a5d8b1097d0539872f8368f1e87ebbd999057e290719de` ([docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json](development-comparison-manifest.json)).
- Journal: `.cache/memory-bench/task5/journal.json`, fingerprint `e3d8ac7d031aa5dcfad250b7dd7e84472fb517d8268eeafd2236b87dcf21ab32` (campaign identity over criteria, ceiling, provider, model and jobs).
- Arms: candidate `d21b9305bbac078ebdd56e8251c69459c0202108` (product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`); control r2 `51d23d4e77debf3ae5b2ec7e68d12656b2c8cd95` (product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` from `5c2570df52a084b43120ee4e77921746a029480e`); harness `66aabefbea1bc21e4615b891ef5e4f0a016a3bc6671c24dd329ec21234e738a1`.
- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.

## Supersedes gate 10

- Gate 10 stays unedited at `docs/_evidence/memory-bench/202/task5/gates/owner-gate-10.json` (sha256 `182bc909c4ff635d826009b7ab256f239a384ae16e16a3c9b1caedb706f745dc`, manifest `c9c6b88b8682923b27f7bb47eb970b391c93a1814970c518e9866b0834043db1`); this gate replaces it.
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
