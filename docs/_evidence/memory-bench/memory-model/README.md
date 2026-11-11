# Memory-model evidence (plans 216–223)

Evidence for the memory model the owner decided on 2026-11-08 (`docs/_evidence/memory-model/design.md` §9).
Every gate of the track (M-1 … M-5, M-T, K-1, A) is judged by one pre-registered file,
`scripts/memory-bench/memory-model-criteria.json`, frozen by plan 216 Task 2 before any plan 217–222 code
(219.1 included) existed. Reports carry ids, labels, counts, rates, scores and hashes only; never question,
gold, note, chunk, claim or corpus text.

| File | What it is |
| --- | --- |
| `criteria.json` | Plan 216 Task 2. The frozen criteria hash, the three criteria hashes it pins, and the amendment log. `frozenMemoryModelHash()` refuses a criteria file that does not hash to it. Amendment 1 (plan 217 Task 6, 2026-11-09) adds the hashes of the two fixtures gate M-1 reads (`long-session-replay`, `long-session`) and changes no row: `2b50880b…` → `f99907bd…`. Amendment 2 (2026-11-10) records the owner decision `m1S3Deferred`: gate M-1 lists S3 under `deferred` (to gate A, which reads it on held-out data), and `memoryModelGateVerdict` reports it `deferred` and decides M-1 by S1, S2 and S4: `f99907bd…` → `9ed0adf0…`. |
| `baselines.json` | Plan 216 Task 2. The "before" baselines: `P` (plan 210's slimmed product hash) and `OM-before` (the pre-redesign observational revision, pinned at the first step of plan 216 Task 4). |
| `gates/README.md` | The gate record template for M-1 … M-5, M-T, K-1 and A. |
| `../<plan>/gates/owner-gate-<gate>.json` | One per gate, in the gate's plan directory, written when the owner approves it (none yet). |
| `M-1/manifest.json` | Plan 217 Task 6. Gate M-1's job list, arms, caps, estimate and pins (`stm-gate.mjs`); the owner gate record binds its hash. |
| `<gate>/evidence.json`, `<gate>/verdicts.json` | Written by each gate's plan: the pinned evidence and the verdicts `acceptance-report.mjs --plan memory-model` computes from it (none yet). |

## Rows and gates

| Rows | Component | Gate | Plan |
|---|---|---|---|
| S1–S4 | STM | M-1 | 217 |
| M1–M5 | WM | M-2 | 218 |
| R1–R6 | Rehearsal | M-3 | 219 |
| T1–T8 | Retrieval | M-T | 219.1 |
| L1–L4 | Non-declarative | M-4 | 220 |
| Z1–Z4 | Sleep | M-5 | 221 |
| O1–O8 | Wiki (plan 208's `three-tier-criteria.json`, referenced by hash, never copied; `P+O` → `ltm+wiki`) | K-1 | 222 |
| held-out S1, S3, M1, M5, R2, R5, R6, L1–L4, Z1 + 202/208/209 rows | Acceptance (pins four criteria hashes) | A | 223 |

Pins: plan 198 statistics (clustered paired CIs); non-inferiority is a CI lower bound ≥ −2 points on every
answer model; a gain needs a CI lower bound > 0 on some answer model and no model with a CI upper bound below 0.
Development gates read `dev` only; gate A reads `heldout-a` for the first time, with one remediation round on
`heldout-b`. Every QA row (S3, M5, R5, R6, T7, L4, Z1) reports all-required evidence coverage per ability beside
accuracy, or it is `missing`. A missing measurement is never a pass.

R1's threshold (use-verified share ≥ 0.2) is fixed with `power.mjs`: against a baseline of 0 every verified
write is discordant, and 32 writes is the smallest count whose minimum detectable difference (0.1985) is under
0.2. Plan 202 Task 16's lifecycle wrote 42 (detectable 0.1775). Fewer than 32 writes makes R1 `missing`.

## Commands

```sh
timeout 60 bun scripts/memory-bench/robustness.mjs --verify-criteria memory-model-criteria.json
timeout 300 bun test --timeout=0 scripts/memory-bench/memory-model-criteria.test.mjs
timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan memory-model --partition dev --gate M-1
```

`acceptance-report.mjs --plan memory-model --gate <gate>` reads `<gate>/evidence.json` (or `--evidence <path>`),
refuses evidence that does not pin the frozen hash or that names a partition the gate may not read, and prints
one verdict per row (`pass`, `miss`, `missing`); with no evidence file the gate is `pending`. `--write` saves
`<gate>/verdicts.json`. Gate K-1 is plan 208's report (`--plan 208 --gate K-1`).
