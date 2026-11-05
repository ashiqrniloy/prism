# Skill evaluation: coding-workflow

Round 2, live run, started 2026-11-05T18:44:29.488Z. Verdict: **ship**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:d8762ce6a1a8…`; dataset `sha256:c019b118e58c…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (meta/muse-spark-1.3-contributor)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.897 | 0 | 1026200 (238198) | 59711 | n/a | 57550 ms |
| no-skill | 1.000 | 1 | 810265 (173342) | 62472 | n/a | 46964 ms |

Paired difference (skill − no-skill) on task_success: -0.103, 95% CI [-0.256, 0.000], q = 0.500, not significant.

Skill loading: recall 100% (30/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 3/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 3/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 3/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 3/3 |  |
| code-rounding-two-files | trigger | 1/3 | 3/3 | 3/3 | tests failed (exit 1) |
| code-config-page-size | trigger | 1/3 | 3/3 | 3/3 | tests failed (exit 1) |
| code-add-chunk | trigger | 3/3 | 3/3 | 3/3 |  |
| code-remove-deprecated | trigger | 3/3 | 3/3 | 3/3 |  |
| code-missing-await | trigger | 3/3 | 3/3 | 3/3 |  |
| code-validate-qty | trigger | 3/3 | 3/3 | 3/3 |  |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 3/3 | 3/3 | 0/3 |  |

