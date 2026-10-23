# Plan 188.9 evidence (Phase 11 Part O9)

Harness-only evidence for memory recall: evidence-sized delivery, the exchange archive, the
product write path in the benchmark, and the paid development screen. Every file here is derived
from ids, counts, tokens and timings; no prompt, answer, haystack or note text is stored.

| File | What it shows |
| --- | --- |
| `stage-correction-188.8.json` | The corrected retrieval-stage classifier re-bucketed over 188.8's committed diagnostics (Task 2). |
| `ceiling-development.json` | Delivery ceiling grid under `ceiling-v2` with the excerpt renderer: budget × top-k × similarity on 140 development questions (Task 5). |
| `delivery-development.json` | Shipped-query delivery diagnostic on the direct-ingest store: stages, conditional accuracy, mean injected tokens (Task 5). |
| `delivery-development-fabric-x.json` | The same diagnostic run through a **product-ingested** store (`storeSource: "product-snapshot"`), so the exchange write path is measured, not the legacy episode upsert (Task 9). |
| `screen/` | The paid development screen (Task 10): probe, manifest, journal, reports, verdict and the abandoned write-side attempts. |

## Acceptance (Task 11)

`acceptance/` holds the held-out v2 campaign: the 188.8-pinned baseline, the screened-in
`fabric-x` arm and its local write side, with `fabric-xc` out of scope by owner decision.

| File | What it shows |
| --- | --- |
| `acceptance-manifest.json` | Frozen manifest: three jobs, 12M reservation ceiling, the pinned baseline variant, the write-side cache key and the checked full-context reuse. |
| `acceptance-journal.json` | Reservations and confirmed usage per attempt, including the two aborted starts kept under `attempt-*/`. |
| `final-accept1889-*.json` | The paid reports (ids, scores, statuses, token counts, timing only). |
| `acceptance-comparisons.{json,md}` | Paired improvement with Holm over the four primary abilities, substitution against the reused full reference, write-side cost per session, timing and the stage table. |
| `delivery-x-heldout.json` | Product-store delivery diagnostic for the treatment arm: stages with `partial_evidence` and conditional accuracy joined to the paid verdict. |

Result: `fabric-x` **76/100** against the pinned baseline's **51/100** (+0.25 overall, CI 0.16..0.34;
knowledge-update +0.5, Holm p 0.0078). Full context is 79/100, so `fabric-x` is -0.03 (CI -0.12..0.06):
an opt-in improvement, **not** a full-context substitute, and F13 stays `unresolved`. Of the 24
failures, 17 are delivery (partial evidence 8, candidate gap 5, fine selection 4) and 5 synthesis;
conditional accuracy is 93% when all needed evidence is visible and 43% when it is not.

## Screen (Task 10)

- `probe-manifest.json`, `probe-journal.json`, `probe.json` — concurrency probe on 8 frozen
  `screen-v1` ids at 4/8/16/24, one step at a time: per-question p50/p95 wall time, overloads and
  the chosen step (4, capped by what the 18M reservation pool can hold).
- `screen-manifest.json`, `spend-journal.json`, `screen-run.json` — the screen itself: `fabric`
  baseline, `fabric-x` (local write side) and `fabric-xc`, which is **excluded** with its measured
  cost (see `attempt-6-write-retry-storm/usage.json`), plus `fabric-xc-agentic` which reads the
  excluded store. `screen-accept1889-screen-*.json` are the aggregate reports.
- `verdict.json` — the pre-registered rule applied by the campaign. **Corrected cycle:** the
  188.8-pinned baseline (`fabric.delivery=188.8` variant) scored 17/35 and `fabric-x` 25/35, so
  `fabric-x` gains 8 questions with a worst ability loss of 1 and **proceeds**. `baseline-new-delivery`
  is the shipped 188.9 delivery on the legacy store, kept as a descriptive arm (26/35: the delivery
  change alone is worth +9 on this draw). `fabric-xc` and `fabric-xc-agentic` stay `missing` until
  their write side is measured.
- `xc-write-cost.json` — the clean `fabric-xc` write-side measurement: 1 development question,
  51 sessions, concurrency 1, 1M cap → 64 extractor calls (1.26 per session), 8,185 input tokens
  per session, 33 s mean call, 25 of 51 sessions failing consolidation. Held-out projection ≈ 37.5M.
- `attempt-*/` — reliability evidence for the attempts that did not complete: the reservation bug
  that made every concurrency step block (`attempt-1`), the reservation-bound and label-fanout
  corrections, the 8M write cap, the concurrency-4 projection, the concurrency-16 run that was
  misread as a retry storm (`attempt-6`; 462 calls, all 200, no retries, no overloads), and
  `attempt-7-mislabelled-baseline`, which keeps the first journal, run, verdict and reports as they
  stood before the baseline was corrected. Each keeps its journal and usage log, no text.

Spend, measured from the wire-proxy logs: probe ≈ 0.44M (including the three aborted probe
layouts), screen reads ≈ 0.35M, abandoned `fabric-xc` write sides ≈ 4.68M, correction cycle
≈ 0.77M (pinned baseline 0.045M, descriptive arm 0.156M, `fabric-x` 0.148M, `xc` measurement
0.417M) — about 6.3M input in total. Journals charge more because a reservation is never refunded,
only reconciled.
