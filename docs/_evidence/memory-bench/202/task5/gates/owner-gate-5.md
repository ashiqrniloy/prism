# Plan 202 Task 5.3 — owner gate 5

Status: **approved-by-owner** on 2026-10-30. The proposal itself stays `executable: false`; this gate is the authorization.

Gate text (verbatim): Complete - [ ] Task 5.3: Record the paid-development owner gate against the frozen proposal and update the plan once done. Only use free model from openrouter for paid runs

## Binding

- Manifest: `061323d5a058edd463f8fbb6850ba49a27c94a0dd2723f7991f97d0c7fce26da` ([docs/_evidence/memory-bench/202/task5/development-comparison-manifest.json](development-comparison-manifest.json)).
- Journal: `.cache/memory-bench/task5/journal.json`, fingerprint `e3d8ac7d031aa5dcfad250b7dd7e84472fb517d8268eeafd2236b87dcf21ab32` (campaign identity over criteria, ceiling, provider, model and jobs).
- A changed manifest, cohort, criteria or journal identity is a refusal, not a re-approval.

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
