# Plan 208 evidence: three-tier memory evaluation

Evidence for the ontology tier's evaluation (plan 208). Reports carry ids, labels, counts, rates and scores only; no
question, gold, note, claim or corpus text.

## Pre-registered criteria (Task 1, 2026-11-03)

- File: `scripts/memory-bench/three-tier-criteria.json`, committed before any ontology arm ran on a development partition.
- Hash: `3d5a5c10fddda0931d00003aad8f2fccf5bdef2a829fa0b09bfac004b2bd263f` (`threeTierCriteriaHash()`).
- Check: `timeout 60 bun scripts/memory-bench/robustness.mjs --verify-criteria three-tier-criteria.json`.
- Pins plan 202's `robustness-criteria.json` hash (`dd1add49…80ea7`, unchanged) and the partition ids hash of each suite it reads.
- Arms: `conversational` and `coding`, each with and without `memory-wiki` (`+O`), compared paired against their own base.
- Consolidation-sensitive abilities: LongMemEval-M `multi-session` and `knowledge-update`; BEAM-100K and BEAM-1M
  `multi_session_reasoning`, `summarization`, `contradiction_resolution`, `knowledge_update`; LoCoMo `multi-hop`;
  MemoryAgentBench-CR both conflict-resolution abilities.
- Criteria O1-O8 and the outcome classes are in the file. O8's thresholds are fixed there; plan 209 computes the row `ontology-work`.
- Frozen once Task 5 starts. The owner may change it before then; any change moves the hash.

## Claim-support audit (Task 2, 2026-11-03)

- Tool: `scripts/memory-bench/ontology-audit.mjs` (with `audit/claim-review.mjs` for the human set). Offline run:
  `timeout 1800 bun scripts/memory-bench/ontology-audit.mjs --offline`. It uses scripted judges and generated fixtures; it makes no model call.
- Labels: `supported` (counts toward O3), `partially-supported`, `unsupported`, `contradicted`.
- Reports carry ids, labels, counts and rates only. Claim and note text live in private bundles and the local review page.
- No paid or live run has happened. The first live audit belongs to Task 5 under gate O-1.

## Ontology arms (Task 3, 2026-11-03)

- Code: `scripts/memory-bench/ontology-arm.mjs` (install, settle, snapshot, report, bundles), hooks in `run.mjs`, `replay.mjs`,
  `campaign.mjs`, `usage.mjs`, `report.mjs`, `timing.mjs`, `ablations.mjs`, and `audit/readiness.mjs` (the manifest pin).
- Offline check: `timeout 600 bun scripts/memory-bench/run.mjs --offline --ontology` on the mock provider (`--ontology` defaults the arm to `fabric-x`).
- No paid or live run has happened. The first live ontology arm belongs to Task 5 under gate O-1.
- Open item before Task 5: plan 207's `prefix-probe.json` was taken on a fabric whose product hash is no longer the tree's,
  so `assertOntologyManifestPin()` refuses a manifest today (`ontology-prefix-probe-product-changed`). Rerunning
  `prefix-probe.mjs --out docs/_evidence/memory-bench/207/prefix-probe.json` (offline, free) after the last fabric edit clears it.

## Ontology safety probes (Task 4, 2026-11-03)

- Code: `scripts/memory-bench/safety/ontology.mjs` (probes, verdict), `safety/ontology-criteria.json` (thresholds, hash
  `192ab32e9954469d8056108482632ad5d7655bbaa96a0930947bfd6fd974e68d`), wired into `safety/run.mjs` as `--ontology`.
- Evidence (zero model calls, ids/counts/booleans only):
  - `safety/safety.json` and `.md`: full run (`bun scripts/memory-bench/safety/run.mjs --ontology`), plan 202 gate pass, **O4 pass**.
  - `safety/safety-offline.json` and `.md`: `--suite offline --ontology`, ontology probes pass, O4 `pending-gate-202`
    (the false-refusal corpora are not read offline).
- Probes: deletion cascade, cross-scope exposure, concept poisoning, team concept trust, human-edit bypass. All five pass on this tree.
- Informational residual, outside the gate: a lure that evades the pattern trust scan is an ordinary note. The copying
  curator is shown it, the port accepts the claim and recall delivers it. The scripted check cannot judge paraphrase, so the
  live gate judges delivered claims with the plan 199 panel. Recorded for plan 210's ledger.
- The development evidence for O4 is this run. The held-out O4 read belongs to plan 210 Task 9.


## Development screen (Task 5, started 2026-11-03)

- Gate: `gates/owner-gate-1.json` (owner: Kilo free models for answers, curator and judges; $0). Manifest: `screen/development-screen-manifest.json`.
- Run: `campaign.mjs --plan 208 --partition dev`; report: `acceptance-report.mjs --plan 208 --partition dev` writes `screen/development-report.{json,md}`.
- Smokes (two questions, same gate): `screen/smoke-208-task5-*.json`. MAB-CR built no concepts at default tuning; BEAM-100K did.
- Not screened: O6 (no coding preset or sandbox on a free route), O8 (plan 209). O1's two-provider rule cannot be met (one gateway); advisory.
- O3 stays invalid until a person labels the 60-claim human set (`ontology-audit.mjs --build-human-set <dir>`).
