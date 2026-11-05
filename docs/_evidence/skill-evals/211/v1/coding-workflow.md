# Skill evaluation: coding-workflow

Round 1, live run, started 2026-11-05T14:23:55.468Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:2bbb12e469eb…`; dataset `sha256:c019b118e58c…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger precision n/a < 0.7; trigger recall 0.00 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.872 | 4 | 769272 (30144) | 24403 | n/a | 41864 ms |
| no-skill | 0.923 | 0 | 758023 (28901) | 25494 | n/a | 40700 ms |

Paired difference (skill − no-skill) on task_success: -0.051, 95% CI [-0.179, 0.051], q = 0.750, not significant.

Skill loading: recall 0% (0/30 trigger trials), precision n/a, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-config-page-size | trigger | 1/3 | 3/3 | 0/3 | tests failed (exit 1) |
| code-add-chunk | trigger | 3/3 | 3/3 | 0/3 |  |
| code-remove-deprecated | trigger | 3/3 | 2/3 | 0/3 |  |
| code-missing-await | trigger | 3/3 | 3/3 | 0/3 |  |
| code-validate-qty | trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 0/3 | 1/3 | 0/3 | missing "yrassecen" |

