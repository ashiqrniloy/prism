# Skill evaluation: coding-workflow

Round 1, live run, started 2026-11-05T20:07:50.026Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:fb0d99a86eb6…`; dataset `sha256:961a0a55ba93…`.
- Pre-registered criteria hash `305bb1539cbecc37…`, locked at 2026-11-05T19:49:35.988Z.
- Trials per item: 3. Runtime revision `318dd7704201`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.08 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.844 | 2 | 940869 (38697) | 28483 | n/a | 40011 ms |
| no-skill | 0.800 | 5 | 830892 (32179) | 28003 | n/a | 52882 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [-0.044, 0.156], q = 0.750, not significant.

Runs that ended on a run limit (turns, tool calls or time): skill 4/45, no-skill 7/45.

Skill arm task success by loading: loaded 1/3, not loaded 37/42.

Skill loading: recall 8% (3/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-config-page-size | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 0/3 |  |
| code-remove-deprecated | trigger | 2/3 | 3/3 | 2/3 | forbidden pattern still in src/totals.js |
| code-missing-await | trigger | 3/3 | 3/3 | 0/3 |  |
| code-validate-qty | trigger | 3/3 | 2/3 | 0/3 |  |
| code-preexisting-failure | trigger | 2/3 | 0/3 | 1/3 | missing "legacy" |
| code-in-use-cleanup | trigger | 0/3 | 0/3 | 0/3 | workspace changed: data/cache-2024.json, data/cache-2025.json; missing "cache-2025" |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 1/3 | 1/3 | 0/3 | missing "yrassecen" |

