# 188.9 held-out acceptance comparisons

Required arms: 3; completed: 3; missing: 0; attempts: 3.
Improvement verdict: improved; substitution verdict: not-a-substitute; F13: unresolved.
Full-context reference: reused from docs/_evidence/memory-bench/188.8/final-accept1888-full.json (the full arm sends the whole history and never reaches the delivery code this plan changed).

| Arm | Ability | n | Diff | 95% CI | p | p-Holm |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| x-baseline | knowledge-update | 20 | 0.5000 | [0.3000, 0.7000] | 1.953e-3 | 7.813e-3 |
| x-baseline | multi-session | 20 | 0.2500 | [0.1000, 0.4500] | 6.250e-2 | 1.875e-1 |
| x-baseline | temporal-reasoning | 20 | 0.2500 | [0.0000, 0.5000] | 1.250e-1 | 2.500e-1 |
| x-baseline | single-session-user | 20 | 0.1500 | [0.0000, 0.3000] | 2.500e-1 | 2.500e-1 |
| x-baseline | overall | 100 | 0.2500 | [0.1600, 0.3400] | 9.999e-5 | 9.999e-5 |
| x-baseline-descriptive | single-session-assistant | 20 | 0.1000 | [-0.1000, 0.3000] | 6.250e-1 | 6.250e-1 |
| x-vs-full | overall | 100 | -0.0300 | [-0.1200, 0.0600] | 6.827e-1 | 6.827e-1 |

| Arm | Correct | Input | Cache-read | Tokens/question | Run-limit |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 51/100 | 215717 | 28032 | 2157 | 0.0000 |
| x | 76/100 | 661681 | 5888 | 6617 | 0.0000 |
| write-x | — | 0 | — | 0 per session | — |

- x stages: answer_gap 5, candidate_gap 5, correct 76, fine_selection_gap 4, gold_unknown 2, partial_evidence 8; all needed visible 63/68 (93%); not visible 13/30 (43%).
