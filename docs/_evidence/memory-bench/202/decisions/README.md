# Memory decision gates — plan 202 Task 12

Status: **implementation screen only; no live model run yet.**

Checked in:

- `scripts/fixtures/decision-bench-memory.jsonl`: 700 labelled items, 100 per point P1–P7;
  P2 carries 50 base items and 50 option-order-reversed repeats. Provenance is
  `synthetic/development-template`, and the fixture is synthetic rather than sampled from a held-out
  benchmark.
- `scripts/decision-bench.mjs --memory`: validates the fixture and scores it through
  `prism.models.decisions()` with the existing accuracy, ECE, Brier, latency and flip-rate metrics.

Not yet run:

- the authorized development screen for every point;
- ECE temperature calibration on a separate development split;
- the end-to-end preset comparison (accuracy non-inferiority, injected tokens, extractor calls,
  p95 latency);
- Task 14's trust-scan recall corpus for P7.

The opt-in gates ship with provisional thresholds and abstain bands in `src/decisions.ts`. No point
is claimed to have met the accuracy/ECE/flip/latency bars until the live screen runs; that handoff is
Plan 210 Task 9. The fixture is deliberately not presented as evidence of model quality.
