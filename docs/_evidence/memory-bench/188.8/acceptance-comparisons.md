# 188.8 held-out acceptance comparisons

Required arms: 5; completed: 5; missing: 0; attempts: 8.
Improvement verdict: inconclusive; substitution verdict: not-a-substitute; F13: unresolved.

Question (1): does post-fix fabric improve on pre-fix fabric? Question (2): is any fabric arm a full-context substitute?
They are reported separately; (1) passing alone is an opt-in improvement, never substitution.

| Arm | Ability | n | Diff | 95% CI | p | p-Holm |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| postfix-prefix | knowledge-update | 20 | 0.0500 | [-0.1000, 0.2000] | 1.000e+0 | 1.000e+0 |
| postfix-prefix | multi-session | 20 | 0.0500 | [0.0000, 0.1500] | 1.000e+0 | 1.000e+0 |
| postfix-prefix | temporal-reasoning | 20 | -0.0500 | [-0.1500, 0.0000] | 1.000e+0 | 1.000e+0 |
| postfix-prefix | single-session-user | 20 | -0.0500 | [-0.1500, 0.0000] | 1.000e+0 | 1.000e+0 |
| postfix-prefix | overall | 100 | 0.0100 | [-0.0500, 0.0700] | 1.000e+0 | 1.000e+0 |
| postfix-prefix-descriptive | single-session-assistant | 20 | 0.0500 | [-0.1000, 0.2000] | 1.000e+0 | 1.000e+0 |
| agentic-postfix | knowledge-update | 20 | -0.2500 | [-0.5000, 0.0500] | 1.797e-1 | 7.188e-1 |
| agentic-postfix | multi-session | 20 | 0.0000 | [-0.2000, 0.2000] | 1.000e+0 | 1.000e+0 |
| agentic-postfix | temporal-reasoning | 20 | 0.2000 | [-0.0500, 0.4500] | 2.891e-1 | 8.672e-1 |
| agentic-postfix | single-session-user | 20 | -0.2500 | [-0.5000, 0.0000] | 1.250e-1 | 6.250e-1 |
| agentic-postfix | single-session-assistant | 20 | -0.1500 | [-0.4000, 0.1000] | 4.531e-1 | 9.063e-1 |
| agentic-postfix | overall | 100 | -0.0900 | [-0.2000, 0.0200] | 1.742e-1 | 1.742e-1 |
| prefix-vs-full | overall | 100 | -0.3300 | [-0.4300, -0.2400] | 9.999e-5 | 9.999e-5 |
| postfix-vs-full | overall | 100 | -0.3200 | [-0.4200, -0.2300] | 9.999e-5 | 9.999e-5 |
| agentic-vs-full | overall | 100 | -0.4100 | [-0.5200, -0.3000] | 9.999e-5 | 9.999e-5 |

Conditional accuracy: does the solver answer when all needed evidence is visible in the injected context? Stage counts use the corrected classifier (partial_evidence when only some fine rounds are visible).

| Diagnostics arm | Renderer | Stages | All needed visible | Not all visible |
| --- | --- | --- | --- | --- |
| heldout-prefix | whole | answer_gap 7, candidate_gap 6, correct 46, fine_selection_gap 18, gold_unknown 2, partial_evidence 17, selection_gap 3, store_error 1 | 34/41 (83%) | 12/57 (21%) |
| heldout-postfix | excerpt | answer_gap 9, candidate_gap 6, correct 47, fine_selection_gap 15, gold_unknown 2, partial_evidence 17, selection_gap 3, store_error 1 | 36/45 (80%) | 11/53 (21%) |
| heldout-agentic | excerpt | answer_gap 21, candidate_gap 3, correct 38, fine_selection_gap 15, gold_unknown 2, partial_evidence 19, selection_gap 1, store_error 1 | 24/45 (53%) | 14/53 (26%) |
| development-postfix | excerpt | answer_gap 11, candidate_gap 11, correct 65, fine_selection_gap 24, gold_unknown 2, partial_evidence 18, selection_gap 9 | 32/42 (76%) | 20/82 (24%) |

Cost is wire input/cache/output only. Currency is not available without authenticated rate semantics.
- prefix: 46/100, completed, 218663 input, 8576 cache-read, run-limit 0.0000.
- postfix: 47/100, completed, 249736 input, 36352 cache-read, run-limit 0.0000.
- agentic: 38/100, completed, 5438935 input, 3498496 cache-read, run-limit 0.1800.
- development: 65/140, completed, 347040 input, 8384 cache-read, run-limit 0.0000.
- full: 79/100, completed, 11500702 input, 384 cache-read, run-limit 0.0000.
