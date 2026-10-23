# 188.10 held-out v3 acceptance

Selected arm: x-tools (from docs/_evidence/memory-bench/188.10/screen-a/verdict.json); product frozen at Stage A (dbce0697).
Required arms: 4; completed: 4; missing: 0; attempts: 5.
Multi-session success: true; all primary criteria hold.

| Check | Result | Detail |
| --- | --- | --- |
| multi-session-absolute | pass | multi-session 28/40, target 24/40 |
| multi-session-paired-improvement | pass | diff 0.4500, 95% CI [0.2750, 0.6250] |
| non-regression | pass | overall paired diff 0.2700 (needs >= 0) |

| Arm | Ability | n | Diff | 95% CI | p |
| --- | --- | ---: | ---: | --- | ---: |
| x-tools-x | knowledge-update | 20 | 0.1000 | [-0.1000, 0.3000] | 6.250e-1 |
| x-tools-x | multi-session | 40 | 0.4500 | [0.2750, 0.6250] | 2.000e-4 |
| x-tools-x | overall | 100 | 0.2700 | [0.1700, 0.3700] | 9.999e-5 |
| x-tools-x | single-session-assistant | 6 | 0.1667 | [0.0000, 0.5000] | 1.000e+0 |
| x-tools-x | single-session-user | 14 | 0.0714 | [0.0000, 0.2143] | 1.000e+0 |
| x-tools-x | temporal-reasoning | 20 | 0.2500 | [0.0000, 0.5000] | 1.250e-1 |
| x-tools-full | overall | 100 | 0.0700 | [-0.0300, 0.1700] | 2.262e-1 |

| Arm | Correct | Input | Cache-read | Tokens/question | Tools/question | Run-limit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| x | 49/100 | 637815 | 8192 | 6378 | 0 | 0.0000 |
| x-tools | 76/100 | 2966891 | 965504 | 29669 | 1.52 | 0.0200 |
| full | 69/100 | 11295518 | 320 | 112955 | 0 | 0.0000 |
| write-x | — | 0 | — | — | — | 0 per session |
