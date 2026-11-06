# Skill evaluation: coding-workflow

Round 1, live run, started 2026-11-06T06:35:58.764Z. Verdict: **ship**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:fb0d99a86eb6…`; dataset `sha256:961a0a55ba93…`.
- Pre-registered criteria hash `305bb1539cbecc37…`, locked at 2026-11-05T19:49:35.988Z.
- Trials per item: 3. Runtime revision `c89ddd106a26`.

## commandcode (meta/muse-spark-1.3-contributor)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.800 | 0 | 1168224 (240053) | 71353 | n/a | 62204 ms |
| no-skill | 0.889 | 0 | 933763 (189115) | 67089 | n/a | 58894 ms |

Paired difference (skill − no-skill) on task_success: -0.089, 95% CI [-0.200, 0.022], q = 0.313, not significant.

Runs that ended on a run limit (turns, tool calls or time): skill 15/45, no-skill 11/45.

Skill arm task success by loading: loaded 28/36, not loaded 8/9.

Skill loading: recall 100% (36/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 3/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 3/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 3/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 3/3 |  |
| code-rounding-two-files | trigger | 2/3 | 3/3 | 3/3 | tests failed (exit 1) |
| code-config-page-size | trigger | 3/3 | 3/3 | 3/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 3/3 |  |
| code-remove-deprecated | trigger | 2/3 | 3/3 | 3/3 | forbidden pattern still in src/totals.js; forbidden pattern still in src/summary.js |
| code-missing-await | trigger | 3/3 | 3/3 | 3/3 |  |
| code-validate-qty | trigger | 1/3 | 3/3 | 3/3 | tests failed (exit 1) |
| code-preexisting-failure | trigger | 0/3 | 0/3 | 3/3 | missing "legacy" |
| code-in-use-cleanup | trigger | 2/3 | 1/3 | 3/3 | missing "cache-2025" |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 2/3 | 3/3 | 0/3 | missing "yrassecen" |

