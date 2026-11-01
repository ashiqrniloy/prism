# Plan 202 Task 5.4.6 — owner gate 15

Status: **approved-by-owner** on 2026-11-01. The proposal itself stays `executable: false`; this gate is the authorization.

Gate text (verbatim): Given the scope of the memory work has been extended significantly now beyond [plan 202] is it worth spending so many live run tokens in Task 5.4 for example or we can relax it with a lighter test reasonably. We can do a hard test after all the other updates in 207 to 210 is in. Then, after reviewing the risks: "go ahead, draft the disposition and plan 210 hand-off".

## Binding

- Manifest: `0dea417b67a019deea5a32912103225c28bd7a18ef181a1c1980f778446dbdb3` ([docs/_evidence/memory-bench/202/task5/development-screen-manifest.json](development-screen-manifest.json)).
- Criteria: `202-task5-candidate-gap-v1-screen` (`faa72035b9aaeb70…`).
- Journal: `.cache/memory-bench/task5/journal.json`, fingerprint `ecb83564868cece9e82d24c6fc86d05fa1f94fef0cf4c3dbd72a931c096a3809` (campaign identity over criteria, ceiling, provider, model and jobs).
- Arms: candidate `9d5a7c656bdc27c6a67166fb2aeb826954118927` (product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`); control r2 `5ed8a63e856d472afee748ad5b9e49e3e10873ff` (product `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0` from `5c2570df52a084b43120ee4e77921746a029480e`); harness `196a21ee6dafcef2a30d4eff0b700573bcd9695be9d49eb396840fc3220a62bd`.
- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.

## Supersedes gate 14

- Gate 14 stays unedited at `docs/_evidence/memory-bench/202/task5/gates/owner-gate-14.json` (sha256 `fd6b3d55f11533b576d3cd47bc14b30040dba2054f6d1f50fd0a7414c7a5750a`, manifest `2694bf3945d19e9b9f3aa784afc4ce45a83d19d3b5f896db67ee39a7544706a3`); this gate replaces it.
- This is a **scope reduction, not a re-freeze**: the treatment (control `ad25add4e2d662d637d43fbe06188160eea15569eca0e5498145e0de2a6143b0`, candidate product `26bf9013cc0d2a258b3753d8f4f20e723180062cc45fabbc72a521b00fe98f20`) is byte-identical. The journal identity moves from `e3d8ac7d031aa5dcfad250b7dd7e84472fb517d8268eeafd2236b87dcf21ab32` to `ecb83564868cece9e82d24c6fc86d05fa1f94fef0cf4c3dbd72a931c096a3809` because the criteria version and the cohort changed, and the screen runs fresh.

- `budgets (recomputed estimates, reservations, expected calls and wall caps; ceiling and hard cap unchanged)`
- `cells (LongMemEval-M removed, beam-1m sliced to the rule's 14 questions, derived ids/estimates/wall caps)`
- `cohort (question count, id hash, suite rows and label totals)`
- `comparison (cell lists and pair count)`
- `coverage (LongMemEval-M deferred to plan 210, all-suite target off)`
- `criteria.abilityGuard.role (descriptive, not a veto)`
- `criteria.version (202-task5-candidate-gap-v1-screen)`
- `generatedAt`
- `hashes derived from the screen criteria`
- `journal identity (new criteria and cohort)`
- `manifestHash`

## Approved scope

- 8 cells (4 control/candidate pairs) over beam-100k, locomo, memoryagentbench-cr, beam-1m; arm `preset-r1` (`fabric-x-tools`); 134 development questions.
- Answer: `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`; judges `openrouter/dots-studio/dots-3-note-preview:free` + `openrouter/cohere/north-mini-code:free`.
- Billing: free OpenRouter routes only; no paid fallback, no cross-provider claim.

## Caps and preservation

- Reservations: 53,000,000 input tokens; ceiling 100,000,000; hard cap 16,800 physical calls; concurrency 1; wall 56 h.
- Product $0.00 / judge $0.00 / total $0.00 (quota and caps bind, not USD).
- Closed owner screen stays closed-by-owner; prior charges preserved; historical revision-1 controls reused 0; held-out access false; no credential values.

## Reproduce

```sh
timeout 120 bun test --timeout=0 scripts/memory-bench/task5-comparison.test.mjs
timeout 120 bun scripts/memory-bench/task5-comparison.mjs --gate --text "<owner approval>" --approved-at 2026-10-30
```
