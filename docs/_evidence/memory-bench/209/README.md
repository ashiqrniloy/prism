# Plan 209 evidence: memory for the working agent

Evidence for plan 209 (tool steps, standing rules, cited lessons, the work-outcome suite). Reports carry ids,
labels, counts, rates and scores only; no persona, message, note, claim or fixture text.

## Work-outcome criteria and partitions (Task 5, 2026-11-05)

- Criteria: `scripts/memory-bench/work-outcome-criteria.json`, committed before any work-outcome arm was measured.
- Hash: `d30681ec13dfd1e9f01ce9fdfe8ad2caa674b97182210c12788bd0bc77717bd2` (`workOutcomeCriteriaHash()`).
  Check: `timeout 60 bun scripts/memory-bench/work-outcome/metrics.mjs --verify-criteria`.
- Pins: plan 208's three-tier criteria (`3d5a5c10…d263f`), plan 202's robustness criteria (`dd1add49…80ea7`) and
  the persona partition ids (coding `0afe60bd…a016`, assistant `bfb4907b…0984`).
- Partitions: `scripts/memory-bench/work-outcome-{coding,assistant}.json`, drawn label-blind from persona ids
  (coding 4/4/4, assistant 3/3/3 over dev/heldout-a/heldout-b). Plan 209 reads `dev` only. `heldout-a` and
  `heldout-b` belong to plan 210 Task 9; `heldout-b` is its single remediation round.
- Rows:
  - `work`: `P+W` vs `P`. W1 lower and W2 higher with CI lower bound > 0, pooled over both families. W3 non-inferior
    within 2 points, W4 within 10% of `P`'s mean, W6 within 2 points. W5 ≥ 95% supported. Canary and
    cross-project leakage at 0.
  - `memory`: `P` vs `memory-off`, the same checks. "Memory improves work" is stated only if this row passes on
    plan 210's held-out partitions.
  - `ontology-work`: plan 208's O8, copied unchanged (a test asserts the copy).
  - `coding-work`: `coding+W` vs `coding`, reported only.

## Offline run (Task 5)

- Command: `timeout 600 bun scripts/memory-bench/work-outcome/run.mjs --offline`. Mocks play the answer model and
  the user, and scripted judges label W5. No model call is made.
- Report: [`offline/work-outcome-offline-dev.json`](offline/work-outcome-offline-dev.json). This run proves that
  W1–W6, W5, safety and every criteria row compute. Its numbers come from a mock with one bad prior and are **not**
  evidence about memory.
- Wall time and cost are recorded in the report's `cost` (per persona and arm in `personas[]`).
- Live runs (dev screen, gate W-1) are Task 6's.
