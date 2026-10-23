# Plan 188.10 evidence (Phase 11 Part O10)

Harness-only evidence for multi-session recall and the live held-out draw. Every file here is
derived from ids, ranks, counts, booleans and timings; no prompt, answer, haystack, round or note
text is stored.

| File | What it shows |
| --- | --- |
| `acceptance/acceptance-manifest.json` | The held-out v3 manifest (Task 9): gate 1 verbatim, the Stage A selection and its verdict hash, the frozen product hash, the v3 ids/`idsHash`/`fileHash`, the pre-registered criteria, and the four arm caps. |
| `acceptance/acceptance-journal.json` | The held-out journal: per-attempt reservations, charges and `usageComplete`, including the failed first reference attempt. |
| `acceptance/acceptance-journal-pre-caps.json` | The first held-out journal, archived when the arm caps were sized for the kernel's in-flight reservation; it holds the two attempts that hit their cap. |
| `acceptance/acceptance-run.json` | The campaign's per-arm status and charge summary. |
| `acceptance/final-<arm>.json` | One arm's report: ratings, token counts, tool counters and per-question rows (ids, scores, counters, booleans). |
| `acceptance/acceptance-comparisons.json` | The Task 9 verdict and comparisons: the three primary checks, the paired per-ability diffs, the full-context substitution verdict, arm costs and the write-side cost. |
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

## Live held-out v3 acceptance (Task 9)

Stage A selected `fabric-x-tools`, so Task 8 was not needed and this is the one live run of that
configuration on ids nobody had read: held-out v3 (100 ids: multi-session 40, knowledge-update 20,
temporal-reasoning 20, single-session-user 14, single-session-assistant 6), labels on, OpenCode Go
`mimo-v2.5`, temperature 0, max output 4,096, harness protocol version 2.

The manifest is built from `screen-a/verdict.json`, never from a typed arm name, and refuses to build
if the product hash differs from Stage A's `dbce0697…`: the run is the selected configuration or it is
not run at all.

### Spend

| Attempt | Charge | Note |
| --- | ---: | --- |
| Stage A (Task 7, including its archived attempt) | 2,776,286 | Prior use recorded in the manifest. |
| First held-out attempt | 5,516,610 | `x` stopped after 4 questions and `x-tools` after 79: both caps were sized from spend instead of the kernel's 250k-per-request in-flight reservation. |
| Accepted held-out campaign | 14,923,447 | `x` 637,815, `x-tools` 2,966,891, `full` 11,295,518; the writer is local and free. |
| **Gate 1 total** | **23,216,343 / 34,000,000** | Ceilings: 26,000,000 for this campaign (read caps 3M + 9M + 14M). |

The first attempt is kept as reliability evidence, not reused: its journal is archived under
`acceptance-journal-pre-caps.json` and its `x-tools` report (2,114,975 verified but usage-incomplete)
is not scored. Rerunning the reference after the caps changed costs one arm, not the campaign, because
the manifest fingerprint (ceiling and caps) did not change when only the arm's concurrency did.

### Primary criteria (from the manifest)

| Check | Target | Measured |
| --- | --- | --- |
| Multi-session, selected arm | ≥ 24/40 | **28/40** |
| Paired multi-session improvement vs `fabric-x` | diff > 0, 95% CI lower bound > 0 | **+0.45, CI [0.275, 0.625]** (McNemar p = 2e-4) |
| Non-regression | KU ≤ 2, TR ≤ 2, SSU ≤ 1, SSA ≤ 1 lost; overall diff ≥ 0 | **gained 2, 5, 1, 1; overall +0.27 (CI [0.17, 0.37])** |

All three hold, so the plan's **multi-session success** criterion is met and the verdict is
`met: true` with no hand-set value.

| Arm | Correct | Input tokens | Tokens/question | Tool calls | Run-limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| `x` (`fabric-x`, passive) | 49/100 | 637,815 | 6,378 | 0 | 0 |
| `x-tools` (`fabric-x-tools`, selected) | **76/100** | 2,966,891 | 29,669 | 152 | 2% |
| `full` (whole history) | 69/100 | 11,295,518 | 112,955 | 0 | 0 |

| Ability | `x` | `x-tools` | `full` |
| --- | ---: | ---: | ---: |
| Multi-session / 40 | 10 | **28** | 23 |
| Knowledge update / 20 | 15 | 17 | 16 |
| Temporal reasoning / 20 | 7 | 12 | 11 |
| Single-session user / 14 | 12 | 13 | 13 |
| Single-session assistant / 6 | 5 | 6 | 6 |

Against full context the selected arm is **+0.07 overall (95% CI [-0.03, 0.17])**, inside the
3-point non-inferiority margin at the CI's lower bound, so the substitution verdict is
`full-context-substitute`: 76/100 at 26% of the input tokens of the 112,955-token full-context
question.

### Attribution

The held-out run keeps its judge-only injection labels, so injection precision is comparable with
188.9: irrelevant block rate 0.810 → 0.777, cited-id rate 0.141 → 0.202. The tool channel is the
lever: 152 tool calls and 100 recall calls over 100 questions, `evidenceRoundCoverage` 0.628 → 0.834,
`retrievalRecallAtK` 92 → 96 of 100, and `evidenceAllRequired` 52 → 76.

Conditional accuracy (all needed evidence visible versus not):

| Arm | Visible | Not visible |
| --- | ---: | ---: |
| `x` | 44/52 (85%) | 5/42 (12%) |
| `x-tools` | 68/76 (89%) | 8/19 (42%) |

No stage table is produced for v3: the multi-session diagnostic refuses the held-out draw by design
(it reads gold evidence), and this plan does not weaken that guard after the fact. The report-level
counters above are the attribution the run itself supports.

Wall time: `x` 40 min, `x-tools` 53 min, `full` 43 min, 2 h 17 min of read side in sequence against
the 2-hour limit — the overrun is the full-context arm at the probed concurrency 4, not the selected
arm's 53 minutes.
