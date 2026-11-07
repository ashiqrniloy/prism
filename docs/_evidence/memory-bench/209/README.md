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

## Development screen (Task 6, gate W-1, 2026-11-05 to 2026-11-07)

- Gate: [`gates/owner-gate-w1.json`](gates/owner-gate-w1.json), seven amendments, final manifest `1a513107…d148`
  ([`screen/development-screen-manifest.json`](screen/development-screen-manifest.json)). Product hash
  `b33a7f90…07a1` (unchanged by the screen, so it is the frozen product).
- Models: **large** `commandcode/meta/muse-spark-1.2-contributor` (paid; amendment 7 replaced the free Kilo Nemotron,
  whose route answered about 70% of requests with 429 through both attempts of every job), **small**
  `commandcode/Qwen/Qwen3.7-Flash` (paid). Simulated user: Qwen3.7-Flash, so on the small-model jobs one model plays
  both roles. Judges: plan 208's stealth pair. Superseded Nemotron attempts are kept in
  `screen/superseded-nemotron/` as evidence of the route failure, not as results.
- Report: [`screen/development-report.json`](screen/development-report.json) (ids, counts and scores only).
  Regenerate: `timeout 600 bun scripts/memory-bench/acceptance-report.mjs --plan 209 --partition dev`.
- Coverage: the large model ran all six arms. The small model ran five; **`memory-off` failed both attempts**
  (3 persona-arms lost to simulator faults and Command Code stream drops), so the small model has no `memory` row.
  The six no-harm jobs closed as scored 8/10/10-question slices (status `partial` by design); their second attempts
  were refused as resume mismatches and spent nothing.
- `simulatorLeak`: 0 for every Muse arm (W3 valid). Qwen leaked in `P+W` (1), `P+W+O` (1) and `coding` (3), so
  **Qwen's W3 is invalid**.
- Caps per job: 8M input tokens (work), 3M (no-harm), concurrency 2, 8 h. Spend about USD 4.5 of the USD 20 cap (Muse
  and Qwen at the gate's rates; the report's `usd` field counts only the last attempt of each job).
- Advisory only: 7 persona clusters per row (coding 4, assistant 3), so every interval is wide.

### Muse Spark 1.2 (means over 7 clusters; W1, W3, W4 lower is better, W2, W6 higher)

| Row | W1 | W2 | W3 | W4 (requests) | W6 | W5 supported | Pass |
|---|---|---|---|---|---|---|---|
| `work` `P+W` vs `P` | 0.36 → 0.21 | 0.83 → 1.00 | 0.08 → 0.00 | 2.50 → 3.14 | 0.69 → 0.86 | 23/28 (0.82) | no |
| `memory` `P` vs `memory-off` | 0.71 → 0.36 | 0.00 → 0.83 | 0.92 → 0.08 | 7.21 → 2.50 | 0.17 → 0.69 | n/a | no (W1 CI spans 0) |
| `ontology-work` (O8) `P+W+O` vs `P+W` | 0.21 → 0.07 | 1.00 → 1.00 | 0.00 → 0.00 | 3.14 → 3.79 | 0.86 → 0.98 | — | no |
| `coding-work` `coding+W` vs `coding` | 0.43 → 0.21 | 1.00 → 1.00 | 0.04 → 0.04 | 2.93 → 3.50 | 0.81 → 0.93 | 27/29 (0.93) | no |

- Memory itself is large and in the right direction on every metric (W2, W3, W4, W6); W1 is the one check whose
  interval spans zero.
- The working-agent features (`+W`) move W1, W2 and W6 the right way on Muse but no interval clears its bar, W4 costs
  about 0.6 more requests per returning session, and W5 is 0.82 against 0.95 (4 partially supported, 1 unsupported of
  28; 8 lessons and 20 rules in `P+W`).
- O8 (`ontology-work`): no pass; 15 curator calls on Muse, 7 on Qwen. Same verdict as plan 208: no evidence for the tier.
- Qwen Flash: no row passes; W5 0.94 on `P+W` (18 sampled). Not interpretable beyond that (W3 invalid, `memory-off` missing).
- No-harm (`P+W` vs `P`, 28 questions in 18 clusters, large model): −7.1 points, 95% CI [−16.7, 0] against a 2-point
  margin. Advisory, and the slice is small; this is a flag for plan 210, not a verdict.
- Tuning revision: **none**. No tuning-tier value is tied to development evidence at this sample size
  (`assertTuningRevision` would refuse an untied change), so the plan 208 precedent holds.
