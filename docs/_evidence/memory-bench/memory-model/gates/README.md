# Memory-model gate records (M-1 … M-5, M-T, K-1, A)

A gate is a paid or live run of the memory-model track. **Each gate starts only on the owner's word**, recorded
in the gate's owner-gate record (path below, `gates.<gate>.record` in the criteria) before its first job. A run without its record is not evidence. The rows, thresholds and
partitions are fixed by `scripts/memory-bench/memory-model-criteria.json`; a record names only what the run
needs (budget, models, arms, partitions, caps) and never changes a row.

| Gate | Plan | Rows | Partition | Record |
|---|---|---|---|---|
| M-1 | 217 | S1–S4 (STM) | `dev` | `217/gates/owner-gate-m1.json` |
| M-2 | 218 | M1–M5 (WM) | `dev` | `218/gates/owner-gate-m2.json` |
| M-3 | 219 | R1–R6 (Rehearsal) | `dev` | `219/gates/owner-gate-m3.json` |
| M-T | 219.1 | T1–T8 (Retrieval) | `dev` | `219.1/gates/owner-gate-mt.json` |
| M-4 | 220 | L1–L4 (Non-declarative) | `dev` | `220/gates/owner-gate-m4.json` |
| M-5 | 221 | Z1–Z4 (Sleep) | `dev` | `221/gates/owner-gate-m5.json` |
| K-1 | 222 | O1–O8 (`three-tier-criteria.json`, `P+O` → `ltm+wiki`) | `dev` | `222/gates/owner-gate-k1.json` |
| A | 223 | held-out live rows + plans 202, 208, 209 | `heldout-a`; one remediation round on `heldout-b` | `223/gates/owner-gate-a.json` |

Record paths are relative to `docs/_evidence/memory-bench/`.

## Record fields

```json
{
  "schemaVersion": 1,
  "kind": "memory-model-owner-gate",
  "gate": "M-1",
  "plan": 217,
  "approved": true,
  "approvedAt": "YYYY-MM-DD",
  "approvedBy": "owner",
  "text": "the owner's words, quoted",
  "budget": { "billing": "paid-allowance | usd", "provider": "ollama-cloud", "capUsd": null, "allowance": "…" },
  "models": {
    "answers": { "large": "ollama-cloud/…", "small": "ollama-cloud/…" },
    "judges": ["ollama-cloud/…", "ollama-cloud/…"],
    "simulators": {},
    "decider": "ollama-cloud/…"
  },
  "arms": ["STM", "OM-before", "memory-off"],
  "partitions": ["dev"],
  "caps": { "maxInputTokens": 0, "maxOutputTokens": 0, "concurrency": 0, "wallTimeCapHours": 0 },
  "manifest": "docs/_evidence/memory-bench/memory-model/<gate>/manifest.json",
  "manifestHash": "sha256",
  "memoryModelCriteriaHash": "the hash in ../criteria.json",
  "criteriaHash": "robustness-criteria.json hash",
  "criteriaPins": "gate A only: the four hashes of robustness-, three-tier-, work-outcome- and memory-model-criteria.json",
  "amendments": []
}
```

Rules:

- **Models.** The providers of plan 210 gate C-1 (`../../210/gates/owner-gate-c1.json` `scope`: Ollama Cloud
  answer, judge and decider routes) unless the owner names others. Never `openrouter/free`.
- **Partitions.** M-1 … M-5, M-T and K-1 list `["dev"]` only. Gate A lists `heldout-a`; the one remediation round
  lists `heldout-b` in an amendment.
- **Pins.** `assertMemoryModelPin()` refuses a record, manifest or evidence file whose `memoryModelCriteriaHash`
  is not the frozen hash; at gate A it also refuses any of the four criteria hashes that differ.
- **Closed gates** (plan 218 Task 5). When the owner closes a gate, its record gains `closed { at, by: "owner", text }`.
  A closed gate never runs again (`assertM1Gate` refuses it). Its evidence keeps the hash it ran on after a later
  amendment moves the frozen one: `closedGateCriteriaHash()` accepts that hash only when the amendment log in
  `../criteria.json` held it. Gate M-1 has been closed since 2026-11-12.
- **Amendments** record the owner's words for any change of budget, model or cap, with the date. A change of row,
  threshold or partition is not an amendment; it is a new owner decision that changes the criteria file.
- **Misses.** A miss is reported as a miss with per-row evidence and goes to the owner before the next plan
  starts. One fix round on development partitions is allowed, under its own amended record.
- **No text.** Records carry counts, ids, hashes, model routes and the owner's words only.
