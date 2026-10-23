# Plan 188.10 evidence (Phase 11 Part O10)

Harness-only evidence for multi-session recall and the live held-out draw. Every file here is
derived from ids, ranks, counts, booleans and timings; no prompt, answer, haystack, round or note
text is stored.

| File | What it shows |
| --- | --- |
| `ms-diagnostics-x.json` | Multi-session recall diagnostic on the `fabric-x` write side of `screen-ms-v1` (Task 3): per needed round a rank and a lexical-reachability flag, all-needed at 10/20/uncapped, shipped passive coverage, and stage counts with `partial_evidence`. |
| `screen-a/screen-a-manifest.json` | Stage A manifest (Task 7): the owner's gate 1 cap verbatim, the frozen `screen-ms-v1` ids, the `fabric-x` writer, the two read arms, `T_dev`, and the write-side key. |
| `screen-a/spend-journal.json` | Stage A journal: per-attempt reservations, charges and `usageComplete`. |
| `screen-a/spend-journal-pre-split.json` | The first Stage A journal, archived when the reference arm was split into a free writer plus a paid reader; it holds the one completed `fabric-x-tools` attempt that was rerun under the corrected manifest. |
| `screen-a/screen-a-run.json` | Stage A run summary: per-arm status and charge, and the journal totals. |
| `screen-a/screen-a-<arm>.json` | One paid read arm's report (`acceptance.mjs` shape) with ratings, token counts and tool counters; `fabric-x` and `fabric-x-tools` only. |
| `screen-a/verdict.json` | The campaign's `T_dev` verdict: per-arm multi-session counts, ability losses, run-limit rate, `selected` and `next`. |
| `screen-a/ms-diagnostics-x.json` | Task 3's diagnostic over the Stage A reference snapshot, re-run under the post-Task-6 product so the stages reflect the shipped cue. |

## Gate 1 and Stage A (Task 7)

Stage A tests the cheapest plausible lever first: passive injection *plus* the `memory.*` read tools
on the same exchange store, against the pre-registered target below. It never tunes a parameter.

Owner approval, recorded verbatim in the manifest and in `acceptance.mjs`:

> Gate 1 approved 2026-10-23: 34,000,000 tokens (Stage A, the iteration allowance, and Task 9 on the
> Stage A path)

**Target `T_dev` (in the manifest, applied by the campaign):** multi-session ≥ 18/30; every other
ability (5 ids each) loses at most 1 question against `fabric-x`; run-limit rate ≤ 5%.

### Spend

| Arm | Config | Charge | Notes |
| --- | --- | ---: | --- |
| `write-x` | `fabric-x` | 0 | Local, LLM-free write side over the 60 ids; the snapshot both readers use. |
| `x` | `fabric-x` | 239,050 | Passive reference, 60 questions, 0 tool calls. |
| `x-tools` | `fabric-x-tools` | 1,399,977 | Passive plus tools, 89 tool calls. |
| **Stage A** | | **1,639,027** | Ceiling 8,000,000. The archived first journal holds a further 1,137,259 for the superseded two-arm manifest. |

Gate 1's remaining 32.2M is the iteration allowance and Task 9's Stage A path; Stage B is not needed
(below). Wall time: writer ≈ 40 s, `x` ≈ 5 min, `x-tools` ≈ 13 min, so ≈ 19 min against the 60-min
limit at the probed concurrency 4. No provider overloads appeared in either arm's report.

### Result

| Measure | `fabric-x` | `fabric-x-tools` | Δ |
| --- | ---: | ---: | ---: |
| Total correct / 60 | 28 | 50 | +22 |
| Multi-session / 30 | 8 | 22 | **+14** |
| Knowledge update / 5 | 5 | 5 | 0 |
| Single-session user / 5 | 5 | 5 | 0 |
| Single-session assistant / 5 | 4 | 5 | +1 |
| Single-session preference / 5 | 2 | 5 | +3 |
| Temporal reasoning / 5 | 2 | 3 | +1 |
| Abstention / 5 | 2 | 5 | +3 |
| Run-limit rate | 0 | 0 | 0 |
| Input tokens | 239,050 | 1,399,977 | 5.9x |
| `evidenceAllRequired` | 0.545 | 0.800 | +0.255 |
| `evidenceRoundCoverage` | 0.657 | 0.880 | +0.223 |

**`T_dev` met, no ability regressed**, so the tools arm is selected: `verdict.json` carries
`selected: "x-tools"` and `next: { skipStageB: true, heldoutArm: "x-tools" }`. Task 8 is therefore
recorded as not needed, and the tool lever is the one Task 9 takes to held-out v3.

The mechanism is the one Task 3 predicted: `partial_evidence` was the dominant failure, and the tools
let the model pull the rounds the passive block cut. Both channels were visible in every
multi-session question (`fabric-semantic` 28/30, `fabric-tool` and `fabric-directory` 30/30), with 0–6
tool calls per question and 447 notes read by id across the 30. The 6x input cost is the price of the
extra steps, not of a bigger injection (489k vs 229k injected tokens).

### Why the failing 8 still fail

The re-run diagnostic over the same snapshot (`ms-diagnostics-x.json`) reports the shipped product,
including Task 4's partial-selection cue, so one question moved from `answer_gap` to
`partial_evidence` and passive coverage fell to 7/30:

- needed rounds: 77 over 73 sessions; 74 lexically reachable, 3 not (write-time category terms);
- all needed at top 10: 14/30, top 20: 19/30, uncapped: 19/30;
- stages: `partial_evidence` 17, `answer_gap` 7, `selection_gap` 5, `candidate_gap` 1;
- facts: 0 notes, because `fabric-x` archives exchanges only.

So the residual failures are mostly partial evidence the agent still does not chase, not a missing
store, and the 11 questions with a needed round outside the candidate ranking are the ceiling of any
read-side fix on this store. `fabric-xc`'s fact view is the untested lever; it is not needed to pass
`T_dev`.

## Multi-session diagnostic (Task 3)

Both steps are local and free: `fabric-x` makes no model call, so the write side spends nothing and
the diagnostic reads the snapshot offline.

```sh
timeout 900 bun scripts/memory-bench/run.mjs --suite longmemeval-s --subset screen-ms-v1 \
  --config fabric-x --phase write --write-snapshot .cache/memory-bench/write/188.10-fabric-x-screen-ms-v1 \
  --provider opencode-go --model mimo-v2.5 --judge opencode-go/mimo-v2.5 \
  --max-input-tokens 200000 --output .cache/memory-bench/188.10/write-x.json
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset screen-ms-v1 --multi-session \
  --store-from .cache/memory-bench/write/188.10-fabric-x-screen-ms-v1 \
  --output docs/_evidence/memory-bench/188.10/ms-diagnostics-x.json
```

Measured: the 60-id write side took 21.6 s wall (0 input tokens, 0 model calls) and the diagnostic
6.1 s; a repeated diagnostic is byte-identical. Well inside the 5-minute budget, and no provider,
credential or paid-attempt guard was touched.

### What the store says

30 multi-session questions need **77 fine round(s) across 73 distinct sessions** — the multi-session
set is one needed round per question on average, spread over two or more sessions.

| Measure | Count | Reading |
| --- | --- | --- |
| Lexically reachable rounds | 74 / 77 | 3 needed rounds share no term with the question: write-time category terms, not a read-time phrasing gap. |
| Questions with every needed round reachable | 27 / 30 | The other 3 are the three unreachable rounds, one each. |
| All needed in the top 10 | 14 / 30 | |
| All needed in the top 20 | 19 / 30 | |
| All needed uncapped (top 32) | 19 / 30 | Nothing is lost between rank 20 and 32; 11 questions have a needed round outside the candidate ranking. |
| Shipped passive coverage | 8 / 30 | What the agent sees today with the default 4,000-token / top-12 injection. |

Stages: `partial_evidence` 16, `answer_gap` 8, `selection_gap` 5, `candidate_gap` 1. The majority
failure is partial evidence, which is why Task 4's partial-selection cue and Task 6's aggregation
matter more than a larger window.

Facts: `notes: 0`. `fabric-x` archives exchanges only — the fact view (rounds covered by an active
fact, supersession loss, facts per needed round) needs the `fabric-xc` store, whose write side is one
extractor call per session and therefore part of the budgeted paid work in Task 5. The fact block is
still exercised offline by
`supersession_loss_counts_needed_round_whose_fact_is_superseded`, which uses a fixture where a
second keyed fact supersedes the first and asserts one active and one lost round.

### How to read a row

Each `rows[]` entry is one question: `neededRounds`, `sessionsSpanned`, `allNeededAt`
(`"10"`, `"20"`, `"uncapped"`), `allNeededVisible`, `stage`, and `rounds[]` — one entry per needed
round with its 1-based uncapped question-only rank (`null` = outside the top-32 candidates), its
`reachable` flag, and `activeFacts` / `supersededFacts` counts. No other field can carry text.
