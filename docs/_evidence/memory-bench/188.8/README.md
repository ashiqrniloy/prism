# Plan 188.8 paid held-out acceptance (OpenCode Go, 2026-10-23)

Status: **complete for this plan's five arms; F13 stays unresolved.** The owner-approved ceiling was
30,000,000 input tokens for this campaign only. It is not a reusable ceiling and not a new default
budget. Model and judge: `opencode-go/mimo-v2.5`, temperature 0, max output 4,096, harness protocol
version 2 (the question date is message metadata and persisted answer time, never query text).

## Arms

Held-out v2 is the frozen 100-id draw in `scripts/memory-bench/heldout-v2.json` (20 each of
knowledge-update, multi-session, temporal-reasoning, single-session-user and
single-session-assistant). Preference and abstention have no unused ids and run as development-only
non-regression.

| Arm | Subset | Correct | Knowledge-update | Multi-session | Temporal | SS-user | SS-assistant | Input | Cache-read | Output | Usage complete |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `fabric` pre-fix | held-out v2 | 46/100 | 8/20 | 3/20 | 5/20 | 15/20 | 15/20 | 218,663 | 8,576 | 45,128 | no (1 exchange) |
| `fabric` post-fix | held-out v2 | 47/100 | 9/20 | 4/20 | 4/20 | 14/20 | 16/20 | 249,736 | 36,352 | 54,755 | yes |
| `fabric-agentic` post-fix | held-out v2 | 38/100 | 4/20 | 4/20 | 8/20 | 9/20 | 13/20 | 5,438,935 | 3,498,496 | 114,126 | no (1 exchange) |
| `full` reference | held-out v2 | 79/100 | 14/20 | 15/20 | 12/20 | 18/20 | 20/20 | 11,500,702 | 384 | 30,371 | yes |
| `fabric` post-fix | development | 65/140 | 8/20 | 2/20 | 3/20 | 12/20 | 18/20 | 347,040 | 8,384 | 77,983 | yes |

The development arm's non-regression strata: preference **5/20**, abstention **17/20**. 188.7's
protocol-v1 fabric arm scored 6/20 and 15/20 on the same ids, so preference is one question lower
and abstention two higher; both are descriptive, with no paired same-protocol control.

`fabric` pre-fix is the plan's start commit `140091766ab830573054befc8210314b54667950` plus the
post-fix harness: the product directory `packages/memory/fabric/src` is the only difference. The
manifest records both product hashes and the shared harness hash
(`acceptance-manifest.json` → `prefix`), and `prefixArmAudit` refuses a run whose harness or
product hashes do not match. The worktree is `.cache/memory-bench/188.8/prefix` and is rebuilt with
`git worktree add --detach <path> HEAD` followed by copying `scripts/memory-bench` from the
treatment tree. It still holds that launch-state harness, so `prefixArmAudit` keeps validating it:
the only harness files edited after the paid launch are `acceptance*.mjs`, `metrics.mjs` and
`retrieval-diagnostics.mjs`, which the campaign never imports. The run path (`campaign.mjs`,
`run.mjs`, `replay.mjs`, `report.mjs`, `judge.mjs`, `datasets.mjs`, `variants.mjs`) is byte-identical
to what produced the arms below.

## The two questions, reported separately

Predeclared primary family: paired post-fix vs pre-fix `fabric` on knowledge-update, multi-session,
temporal-reasoning and single-session-user, Holm across the four.

| Ability | n | Diff | 95% CI | p | p-Holm |
| --- | ---: | ---: | --- | ---: | ---: |
| knowledge-update | 20 | +0.05 | [-0.10, 0.20] | 1.000 | 1.000 |
| multi-session | 20 | +0.05 | [0.00, 0.15] | 1.000 | 1.000 |
| temporal-reasoning | 20 | -0.05 | [-0.15, 0.00] | 1.000 | 1.000 |
| single-session-user | 20 | -0.05 | [-0.15, 0.00] | 1.000 | 1.000 |
| overall (descriptive) | 100 | +0.01 | [-0.05, 0.07] | 1.000 | 1.000 |
| single-session-assistant (descriptive) | 20 | +0.05 | [-0.10, 0.20] | 1.000 | 1.000 |

1. **Does post-fix improve on pre-fix?** **Inconclusive, reported as no measurable change.** One
   question net overall (4 pre-only, 5 post-only discordant pairs), every paired p is 1.0, and the
   primary family has 20 paired questions per ability with simulated power 1.0. The offline
   development gains from Task 3 and Task 4 did not transfer to held-out data.
2. **Is any fabric arm a full-context substitute?** **No.** Post-fix fabric is **-0.32** against
   full context (95% CI [-0.42, -0.23], p < 1e-4), pre-fix is -0.33 and agentic is -0.41. The
   3-point non-inferiority margin is nowhere near met.

`fabric-agentic` against post-fix `fabric` is -0.09 overall (95% CI [-0.20, 0.02]), not significant.
Its result is a turn-budget result, not a retrieval result: **18 of 100 questions ended at the
eight-turn limit** and are scored wrong (`runLimitRate` 0.18), the same failure 188.7 hit, now
recorded per question instead of ending the arm. 514 turns and 677 tool calls produced 38/100 at
5.4M input, about 22x the passive arm's input for 9 fewer correct answers.

## Delivery-stage attribution (offline, gold read only after both paid arms finished)

`retrieval-diagnostics.mjs` replays the same lexical fabric and applies each arm's shipped renderer:
`--renderer whole` for pre-fix, `--renderer excerpt` for post-fix and agentic. Stage counts out of
100 held-out questions:

| Arm | Correct | answer_gap | fine_selection_gap | candidate_gap | selection_gap | store_error | gold_unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-fix (`whole`) | 46 | 24 | 18 | 6 | 3 | 1 | 2 |
| post-fix (`excerpt`) | 47 | 26 | 15 | 6 | 3 | 1 | 2 |
| agentic (`excerpt`) | 38 | 40 | 15 | 3 | 1 | 1 | 2 |

Visibility out of 20 per ability, whole → excerpt: all-needed-visible knowledge-update **1 → 3**,
single-session-user **17 → 19**, multi-session 0 → 0, temporal 6 → 6, single-session-assistant
17 → 17; complete answer-bearing message visible 14 → 14, 9 → 10, 9 → 9, 17 → 17, 17 → 17. Mean
selected rounds per question rise from 1.09 to 1.50. So the delivery fix moves selected evidence
without moving answers: `fine_selection_gap` falls 18 → 15 and `answer_gap` absorbs the difference.
Answering/synthesis remains the largest single bucket (26 of 53 post-fix failures), ahead of fine
selection (15), candidate recall (6), selection (3), one unstoreable question and two questions
without usable gold.

## Reliability, spend and what remains

| Item | Value |
| --- | ---: |
| Approved ceiling | 30,000,000 |
| Charged in this campaign's journal | 25,132,478 |
| Real wire input in the journal | 17,790,076 |
| Reservation charges from two aborted attempts | 3,000,000 |
| Durable attempts | 8 (6 completed, 1 failed, 2 abandoned; the failed attempt resumed into a completed arm) |
| Required arms | 5 |
| Completed arms | 5 |

Three earlier launches were aborted before any completed arm and are kept, not silently dropped:
`spend-journal-aborted-launch-1.json` (an `--output` reservation/path mismatch for all five arms),
`spend-journal-aborted-launch-2.json` (the same mismatch after a partial fix, 1.5M charged), and a
third that was deliberately restarted with a longer supervisor timeout after 8 completed questions
(20,343 real input tokens); that launch lives in this campaign's `spend-journal.json` as the
abandoned `accept1888-prefix@1`, and the final attempt resumed its checkpoint. Launches 1 and 2 threw before any provider was constructed and wrote no
report, so they spent nothing beyond their reservations; their journals are kept so the accounting
can be audited. Later launches resume from the journal and from the report checkpoint.

Failures and limits recorded, not hidden:

1. **One held-out question cannot be stored.** A single round exceeds the core 64,384-character
   entry limit (`MemoryLimitError: vector text exceeds 64384 characters`). Both fabric arms score it
   wrong identically; the harness now records a per-question product error as a wrong answer with
   `outcome: "error"` and `errorRate`, and stops the arm if more than `max(3, 5%)` questions error.
   Splitting the round was rejected: it would change the representation being measured.
2. **Usage is incomplete on two fabric arms** (1 exchange each). No monetary or non-inferiority
   claim is made (`costClaim: false`); quality verdicts use paired clusters and simulated power,
   which are unaffected by usage accounting.
3. **D6 multi-session aggregation is untouched:** 4/20 post-fix, 15/20 full. Passive top-k cannot
   aggregate across sessions; no fix is claimed.
4. **D7 preference has no held-out data:** 5/20 development-only, and full context itself only
   reaches 7/20 on 188.7's run, so this is a vocabulary gap, not a delivery gap.
5. **The agentic arm is turn-bound,** not retrieval-bound: 18% run-limit hits with the default-kind
   discovery hint in place.

F13 in `docs/_evidence/memory-bench/188.7/findings.json` carries the 188.8 evidence column with
verdict **unresolved**; the finding matrix still validates all 13 rows. `defaults.json` and
`inject: false` are unchanged. No paid process remains.

## Reproduce

```sh
# Manifest only: never spends, never touches the journal.
timeout 60 bun scripts/memory-bench/campaign.mjs --acceptance-188.8 --manifest

# The paid campaign (durable journal, resume-safe, finite per-arm caps).
timeout 50000 bun scripts/memory-bench/campaign.mjs --acceptance-188.8

# Paired comparisons, verdicts and per-arm delivery diagnostics.
timeout 300 bun scripts/memory-bench/acceptance-report.mjs --plan 188.8

# Offline delivery stages per arm (gold is read only while grading, never published).
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset heldout-v2 --renderer whole \
  --failed-report docs/_evidence/memory-bench/188.8/final-accept1888-prefix-2.json \
  --output docs/_evidence/memory-bench/188.8/delivery-diagnostics-heldout-prefix.json
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset heldout-v2 --renderer excerpt \
  --failed-report docs/_evidence/memory-bench/188.8/final-accept1888-postfix.json \
  --output docs/_evidence/memory-bench/188.8/delivery-diagnostics-heldout-postfix.json
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset heldout-v2 --renderer excerpt \
  --failed-report docs/_evidence/memory-bench/188.8/final-accept1888-agentic.json \
  --output docs/_evidence/memory-bench/188.8/delivery-diagnostics-heldout-agentic.json
timeout 900 bun scripts/memory-bench/retrieval-diagnostics.mjs --suite longmemeval-s \
  --subset development --renderer excerpt \
  --failed-report docs/_evidence/memory-bench/188.8/final-accept1888-development.json \
  --output docs/_evidence/memory-bench/188.8/delivery-diagnostics-development-postfix.json
```

Evidence files in this directory: `acceptance-manifest.json` (frozen arms, ids, caps, protocol and
both source hashes), `spend-journal.json` plus the three aborted-launch journals,
`acceptance-run.json`, `final-accept1888-*.json`/`.md` (one report per arm),
`acceptance-comparisons.json`/`.md`, the four `delivery-diagnostics-*.json` reports and the
development-partition diagnostics from Tasks 1–3. Evidence holds ids, hashes, scores, statuses,
codes and counts only: no question, answer, note or gold text, and no credentials.

## Correction (2026-10-23, plan 188.9 Task 2): delivery stages were over-attributed to synthesis

The delivery-stage table above and the attribution paragraph are **superseded, not deleted**. The
classifier behind them returned `answer_gap` as soon as *any* labelled message round was visible,
so a question with three needed rounds and one visible was reported as a synthesis failure. A
question is now `answer_gap` only when every labelled round is visible; `partial_evidence` covers
the partial case. The counts below are re-derived from the committed diagnostics' stored ids and
counts only (no re-run, no recall, no gold text):
`docs/_evidence/memory-bench/188.9/stage-correction-188.8.json`, written by
`retrieval-diagnostics.mjs --restage`.

| Arm | Correct | partial_evidence | fine_selection_gap | answer_gap | candidate_gap | selection_gap | store_error | gold_unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| pre-fix (`whole`) | 46 | 17 | 18 | 7 | 6 | 3 | 1 | 2 |
| post-fix (`excerpt`) | 47 | 17 | 15 | 9 | 6 | 3 | 1 | 2 |
| agentic (`excerpt`) | 38 | 19 | 15 | 21 | 3 | 1 | 1 | 2 |

So the published "answering/synthesis is the largest bucket (26 of 53 post-fix failures)" was wrong:
17 of those 26 had only part of the needed evidence in the prompt. The largest post-fix bucket is
**delivery** — 17 partial + 15 fine-selection = 32 of 53 — ahead of synthesis (9), candidate recall
(6), selection (3), and the three questions with no storable round or no usable gold. The conclusion
does not change (still not a full-context substitute, F13 unresolved), but the next fix should raise
evidence coverage, not rewrite the solver.

Conditional accuracy (from the same report; questions without fine gold are excluded), which is the
split that matters:

| Diagnostics arm | All needed visible → correct | Not all visible → correct |
| --- | ---: | ---: |
| held-out pre-fix | 34/41 (83%) | 12/57 (21%) |
| held-out post-fix | 36/45 (80%) | 11/53 (21%) |
| held-out agentic | 24/45 (53%) | 14/53 (26%) |
| development post-fix | 32/42 (76%) | 20/82 (24%) |

Full context scores 79/100. When every needed round is visible, the fabric solver answers at about
full-context rate; the loss is evidence coverage. `acceptance-comparisons.{json,md}` were regenerated
with the corrected classifier and this table, and re-derive stages themselves so they never repeat a
superseded stage. No paid arm was rerun and no spend changed.
