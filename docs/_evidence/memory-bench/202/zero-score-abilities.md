# Plan 202 Task 4.5 — zero-score ability audit

Status: **completed 2026-10-28** on the OpenRouter free panel. Eight frozen
BEAM-100K development questions (four `event_ordering`, four `summarization`),
eight gold/wrong judge controls per judge, a content-held-constant paraphrase
probe, and both answer diagnostics (labelled evidence only, and eligible
complete history). No held-out source, question, gold or rubric was inspected.
The owner's human-calibration waiver remains in force: this is model-assisted
auditing, never human calibration. Oracle and diagnostic rows stay out of
product acceptance.

## Inventory and source review

Eight questions across **six** conversation clusters. All **56 references
resolve** (55 distinct message references after deduplication within a
question). Live complete-history eligibility was confirmed by the existing
selector for all eight: zero source messages removed, no truncation.

| Question id | References | Finding |
| --- | ---: | --- |
| `1:event_ordering:0` | 3 | Source sequence supports the labelled order. |
| `1:event_ordering:1` | 5 (4 unique) | Duplicate reference is valid: one message covers two successive rubric points. |
| `5:event_ordering:0` | 12 | Annotation-list order differs from source chronology; the source chronology supports the rubric. |
| `13:event_ordering:0` | 5 | Source sequence supports the labelled order. |
| `1:summarization:1` | 11 | Source includes assistant recommendations; completed-action wording needs provenance caution. |
| `8:summarization:1` | 10 | Same advice-versus-adoption limitation. |
| `10:summarization:0` | 6 | All labelled source messages are assistant messages; they cannot independently establish user adoption. |
| `17:summarization:0` | 4 | Source mixes user concern and assistant recommendations; adoption remains unproven by recommendations alone. |

These provenance limitations are not demonstrated adapter defects and are not
grounds to change gold labels. No label, frozen draw or ability was dropped or
rewritten. The earlier suspicion that a duplicate reference concealed a missing
ordering step was disproved by reading that message; it contains both steps.

## Protocol actually executed

| Role | Model | Note |
| --- | --- | --- |
| Answers | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | thinking disabled for this diagnostic |
| Judges | `openrouter/dots-studio/dots-3-note-preview:free`, `openrouter/cohere/north-mini-code:free` | families `dots` and `cohere`, plain text, neither answers an arm |

Declared ceiling unchanged: **160 wire attempts / 5M input / 300k output tokens /
60 minutes**, serial, eight development ids only. Actual cumulative usage across
the three executions: **100 wire attempts, 1,457,267 input tokens (393,120 of
them cached), 107,409 output tokens, $0**. Two executions were superseded:
the first was stopped by the protocol change below, the second by one judge
transport failure at the last summarization question. Four small ad-hoc provider
probes (model availability, reasoning toggle) and the eight paraphrase-probe
calls sit outside the runner attempt count; the probe calls are reported with the
grading controls. No question was added and no held-out id was touched.

Two harness corrections were needed and are covered by tests:

- **Transient free-pool 429 is not quota exhaustion.** The free pool returns
  upstream `429`s while a provider's shared pool is busy; the earlier stop rule
  treated every `429` as the end of the diagnostic. Transient `429`s now retry
  four times with backoff, and the free-per-day cap still stops the run at once.
- **Thinking disabled for answers.** The declared free answer model is a
  reasoning model. With thinking enabled every complete-history answer spent the
  8192-token output budget on reasoning and returned no answer text at all
  (`10825` characters of unfinished deliberation, no verdict-able answer). The
  diagnostic now runs the answer model with `reasoning: { enabled: false }`;
  this is a bench configuration, not a product or model claim, and it changes
  the answer identity, so reasoning-only answers are ignored rather than rejudged.

## Grading controls

| Control | Rows | Outcome |
| --- | ---: | --- |
| Gold answer, positive | 8 questions × 2 judges | **16/16 accepted** |
| Deliberately wrong answer, negative | 8 questions × 2 judges | **16/16 rejected** |
| Faithful paraphrase of gold, rubric verbatim | 2 questions × 2 judges | **4/4 accepted** |
| Faithful paraphrase, rubric boilerplate stripped | 2 questions × 2 judges | **4/4 accepted** |

The paraphrase probe holds content constant and varies only wording, so the
panel is not enforcing a phrasing bar, and the `LLM response should contain:`
boilerplate in the BEAM rubric is not the cause of rejection. Reason codes were
`yes`/`no` only; no judge rationale was requested or stored.

## Per-question verdicts

Judge A = `dots-studio/dots-3-note-preview`, judge B = `cohere/north-mini-code`.
`O` is the labelled-evidence-only answer, `F` the eligible complete-history
answer. A panel verdict is `no` unless both judges say `yes`.

| Question id | O (A / B) | F (A / B) |
| --- | --- | --- |
| `13:event_ordering:0` | yes / no | no / no |
| `5:event_ordering:0` | no / no | no / no |
| `1:event_ordering:1` | no / no | no / no |
| `1:event_ordering:0` | no / no | no / no |
| `10:summarization:0` | no / no | no / no |
| `17:summarization:0` | no / no | no / no |
| `1:summarization:1` | yes / yes | no / no |
| `8:summarization:1` | yes / yes | no / no |

Panel totals: evidence-only **2/8**, complete history **0/8**. Judge agreement
failed once (`13:event_ordering:0`, evidence only).

## Disagreements, labels, evidence gaps and model failures, separately

**Judge disagreement (1 row).** `13:event_ordering:0` evidence-only: judge A
accepted, judge B rejected. The answer reproduces the labelled five-item
chronological order and covers all five rubric topics, so this is an
**adjudicated false negative of the panel majority**, not a label defect.

**Strict-but-defensible rejections (5 rows).** Three ordering answers and two
summarization answers cover most rubric points but each is missing a named
element (`1:event_ordering:1` omits the deployment review, `5:event_ordering:0`
omits two labelled topics and adds an outside rule, `1:event_ordering:0`
substitutes a wrong topic for the final labelled one, `10:summarization:0` omits
the labelled origin and progress-tracking themes, `17:summarization:0` omits the
labelled contingency-planning element). Rejecting an answer that omits a rubric
point is the registered behaviour, so no change is made for these.

**Answer-model failures (8 complete-history rows).** Every complete-history
answer was rejected on content, and inspection agrees: unlabelled or
contradicted specifics (tool stacks, metrics and dates that are not in the
labelled evidence), rubric topics diluted by bulk, or an item order that is not
the labelled order. This is long-context answer-model behaviour with a weak
free model, **not** a broken ability, adapter or judge. It is also the reason
the earlier reasoning-only answers are excluded: they contained no answer at all.

**Labels and evidence.** All eight source sequences support their gold labels,
and all references resolve. Nothing here demonstrates a bad label or missing
source evidence. The adoption-provenance caveat on the four summarization
questions remains a limitation of the labels, not an adapter defect.

**Historical scores.** The seven preserved completed cells contain 56 arm
occurrences of these eight ids, but zero saved answer texts, so they cannot be
rejudged or counted as independent samples. They are unchanged and are not
promoted into this protocol.

## Consequence for the campaign

The 0/4-per-ability pattern is **not** evidence that the instrument is broken.
The grading path discriminates correctly (gold accepted, wrong rejected,
paraphrase accepted), and the zero scores reproduce under a fresh answer model
and a different judge pair: the failure is the answer, not the ruler. So:

- no ability is dropped and no gold label is rewritten;
- the pending broad campaign may treat `event_ordering` and `summarization` as
  real product targets, not as instrumentation to be repaired;
- the free panel is usable for **development diagnostics only**. It has not been
  calibrated against human labels, its two judges agree on 15 of 16 diagnostic
  rows, and one row was a false negative, so no acceptance or lever decision may
  rest on it; Task 18's cross-family panel and calibration requirements stand.

## Implementation and tests

`audit/zero-score.mjs` keeps the private checkpoints (so rejudging never
re-answers), reconciles wire usage per attempt, and now classifies `429`s and
runs the answer model without thinking. `audit/zero-score.test.mjs` adds
`free_pool_429_is_transient_but_daily_cap_stops_the_diagnostic` alongside the
three named regressions:

- `ordering_and_summary_judge_controls_detect_inverted_or_overstrict_grading`;
- `ability_rubrics_reach_judging_but_not_answer_generation`;
- `oracle_diagnostic_cannot_enter_product_acceptance`.

Private source, gold, answer and gateway text stays under
`.cache/memory-bench/audit/4.5/`; this summary and
`zero-score-abilities.json` carry ids, counts, verdicts and findings only.
No product, package, kernel, dependency, export, host, compatibility-baseline or
public docs-index change was made.
