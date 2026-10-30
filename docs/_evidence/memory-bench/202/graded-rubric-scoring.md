# Plan 202 Task 4.5.1: graded rubric scoring and 4.5 attribution (2026-10-28)

Development-diagnostic only. Eight frozen BEAM-100K development ids, six conversation clusters, no held-out text. Free OpenRouter panel (answer `nvidia/nemotron-3-ultra-550b-a55b:free`, judges `dots-studio/dots-3-note-preview:free` and `cohere/north-mini-code:free`). Model-assisted review only; the owner's human-calibration waiver stands and nothing here is calibration. Ids, counts, scores and classes only; source, gold, answer and judge text stay under `.cache/memory-bench/audit/4.5.1/`.

## Upstream scoring (verified)

Source: https://github.com/mohammadtavakoli78/BEAM at `b2da22eac88bb0874c64665f13457eb99835774a`: `src/evaluation/compute_metrics.py`, `src/evaluation/report_results.py`, `src/prompts.py (unified_llm_judge_base_prompt)`.

- Each rubric point is judged separately on a 0 / 0.5 / 1.0 scale and the ability score is the mean over rubric points (llm_judge_score).
- event_ordering also computes Kendall tau-b between rubric order and response order over the union of rubric items and response items, missing items tied last, normalised to (tau+1)/2 as tau_norm, and final_score = tau_norm x F1.
- report_results.py aggregates event_ordering with tau_norm and every other ability with llm_judge_score; upstream's own final_score is computed but not reported.

## Registration (before any 4.6 sizing or 4.7 pilot answer)

- **primary:** graded score, mean across judges; summarization = mean of per-point credit, event_ordering = tau_norm x F1 over labelled items
- **secondary:** binary panel verdict, computed and reported unchanged
- **task18:** robustness-criteria.json and Task 18's frozen binary acceptance are unchanged
- **registeredBefore:** any Task 4.6 sizing or 4.7 pilot answer
- **disagreement:** spread above 0.2 between judges on one answer

Deviations from upstream:

- One judge call scores all rubric points (summarization) or maps the response's items to rubric numbers (event_ordering) instead of one call per point, to stay inside the free-model call ceiling; tau-b and F1 are computed locally from the mapping.
- Upstream's NaN tau for a response naming no labelled event is the floor (0) here.
- Ordering primary is upstream's tau_norm x F1 rather than the tau_norm that upstream's report prints, because tau_norm alone leaves omissions unpenalised.

## Re-judge of the saved 4.5 answers (no new answers)

Graded is the mean of the two judges; binary is the 4.5 panel verdict (both judges must say yes). Spread above 0.2 is flagged as disagreement.

| Ability | Answer set | n | Graded mean | Binary correct | Judge disagreements |
| --- | --- | ---: | ---: | ---: | ---: |
| event_ordering | evidence-only (oracle ceiling) | 4 | 0.899 | 0/4 | 0 |
| event_ordering | complete-history | 4 | 0.187 | 0/4 | 1 |
| summarization | evidence-only (oracle ceiling) | 4 | 0.838 | 2/4 | 1 |
| summarization | complete-history | 4 | 0.375 | 0/4 | 1 |

| Id | Answer set | Graded | Dots / Cohere | Spread | Binary (Dots / Cohere) |
| --- | --- | ---: | --- | ---: | --- |
| 13:event_ordering:0 | evidence-only (oracle) | 1.000 | 1.00 / 1.00 | 0.00 | yes / no |
| 13:event_ordering:0 | complete-history | 0.123 | 0.20 / 0.05 | 0.15 | no / no |
| 5:event_ordering:0 | evidence-only (oracle) | 0.595 | 0.60 / 0.60 | 0.00 | no / no |
| 5:event_ordering:0 | complete-history | 0.295 | 0.30 / 0.30 | 0.00 | no / no |
| 1:event_ordering:1 | evidence-only (oracle) | 1.000 | 1.00 / 1.00 | 0.00 | no / no |
| 1:event_ordering:1 | complete-history | 0.210 | 0.20 / 0.22 | 0.03 | no / no |
| 1:event_ordering:0 | evidence-only (oracle) | 1.000 | 1.00 / 1.00 | 0.00 | no / no |
| 1:event_ordering:0 | complete-history | 0.120 | 0.22 / 0.02 | 0.20 (flag) | no / no |
| 10:summarization:0 | evidence-only (oracle) | 0.650 | 0.60 / 0.70 | 0.10 | no / no |
| 10:summarization:0 | complete-history | 0.350 | 0.60 / 0.10 | 0.50 (flag) | no / no |
| 17:summarization:0 | evidence-only (oracle) | 0.800 | 0.90 / 0.70 | 0.20 (flag) | no / no |
| 17:summarization:0 | complete-history | 0.600 | 0.50 / 0.70 | 0.20 | no / no |
| 1:summarization:1 | evidence-only (oracle) | 0.900 | 0.90 / 0.90 | 0.00 | yes / yes |
| 1:summarization:1 | complete-history | 0.100 | 0.10 / 0.10 | 0.00 | no / no |
| 8:summarization:1 | evidence-only (oracle) | 1.000 | 1.00 / 1.00 | 0.00 | yes / yes |
| 8:summarization:1 | complete-history | 0.450 | 0.50 / 0.40 | 0.10 | no / no |

The evidence-only (oracle) score is the ceiling for any lever on these ids. It is a diagnostic: it never enters baseline cells, comparisons or lever rankings.

## Borderline judge controls

Built locally from each question's own rubric (ordering: gold, one point removed, one adjacent swap, full reversal; summaries: gold, one point removed, gold plus a correct extra sentence from a labelled message) plus a model-written paraphrase of the gold answer for all eight ids. Binary must accept gold, extra and paraphrase and reject every degraded variant; graded must be within 0.2 of the closed-form expectation.

36 variants x 2 judges = 72 binary and 72 graded checks. Binary: **72/72** as expected. Graded: **71/72** within tolerance.

| Variant | Ids | Binary verdicts (both judges) | Graded panel mean vs expected |
| --- | ---: | --- | --- |
| gold | 8 | yes (expected yes) | 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 0.95 vs 1.00 |
| minusOne | 8 | no (expected no) | 0.71 vs 0.71, 0.66 vs 0.79, 0.71 vs 0.71, 0.53 vs 0.53, 0.80 vs 0.80, 0.80 vs 0.80, 0.80 vs 0.80, 0.80 vs 0.80 |
| swap | 4 | no (expected no) | 0.90 vs 0.90, 0.93 vs 0.93, 0.90 vs 0.90, 0.67 vs 0.67 |
| reversed | 4 | no (expected no) | 0.00 vs 0.00, 0.00 vs 0.00, 0.00 vs 0.00, 0.00 vs 0.00 |
| paraphrase | 8 | yes (expected yes) | 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00 |
| extra | 4 | yes (expected yes) | 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00, 1.00 vs 1.00 |

Mismatches:

- `5:event_ordering:0` `minusOne`, judge `cohere`, graded: scored 0.541, expected 0.788. That judge mapped one response item to no rubric event; the other judge was exact, the panel mean (0.664 vs 0.788) stays inside tolerance and the spread of 0.25 is flagged as a disagreement. Single-judge item-matching noise, not a template defect, so no template change was made; the graded panel is a mean precisely so one judge's miss is damped and surfaced.

## Complete-history claim classification against the full source

Method: rule triage over the full conversation, ordering and flagged claims reviewed by hand. Every claim line of the eight complete-history answers was searched across **every** message of its conversation (numbers and names located anywhere; the closest messages listed with their label status). Basis counts: {'reviewed': 20, 'triage': 150, 'review-rule': 58}; supersession-risk flags: 20; hand-reviewed overrides: 20 (all ordering claims plus flagged summary claims). `synthesis` is a line with no checkable specific.

| Id | Claims | supported-labelled | correct-unlabelled | contradicted | superseded | unsupported | synthesis |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 13:event_ordering:0 | 5 | 2 | 2 | 0 | 0 | 1 | 0 |
| 5:event_ordering:0 | 6 | 3 | 3 | 0 | 0 | 0 | 0 |
| 1:event_ordering:1 | 5 | 0 | 5 | 0 | 0 | 0 | 0 |
| 1:event_ordering:0 | 3 | 0 | 3 | 0 | 0 | 0 | 0 |
| 10:summarization:0 | 33 | 4 | 20 | 0 | 0 | 0 | 9 |
| 17:summarization:0 | 36 | 2 | 20 | 0 | 0 | 0 | 14 |
| 1:summarization:1 | 62 | 11 | 29 | 0 | 0 | 3 | 19 |
| 8:summarization:1 | 78 | 15 | 48 | 0 | 0 | 1 | 14 |

Limits: this cannot detect a semantic contradiction that shares no number or name with the source, so zero `contradicted`/`superseded` means none were found in what was read. The 4.1 caveat holds: summary annotations include assistant recommendations, and one ordering claim (`13:event_ordering:0`, an April 3 discussion) is an assistant-proposed schedule presented as a user event.

## Optional thinking re-answer

Partially executed, then stopped by the reviewer: **2 of 8**. Thinking on, output cap raised to 32,768 tokens (under the 128k comparator limit), new answer identity `4.5.1-thinking-v1`. Both attempted ordering questions (`13:event_ordering:0`, `5:event_ordering:0`) spent the whole 32,768-token output budget on thinking and returned no answer (outcome `run_limit`, empty). Pattern clear after two cases, so the remaining six were not run. This never substitutes for the declared pilot answer model.

## Usage

Cumulative over all 4.5.1 executions (resumes included): 189 logged exchanges, 370,710 input and 277,570 output tokens, $0 (free models). Declared ceiling: 400 wire attempts, 8,000,000 input tokens, 700,000 output tokens, 120 minutes. Not exceeded. Re-judging reused the 4.5 answer checkpoints and verdict cache.
