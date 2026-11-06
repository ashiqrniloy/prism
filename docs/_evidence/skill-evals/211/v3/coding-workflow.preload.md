# Skill evaluation: coding-workflow

Round 1, live run, preload loading, started 2026-11-06T09:41:05.821Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:e528880ab763…`; dataset `sha256:2389d66e2751…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (no measured benefit: no significant gain on task_success or tool_misuse).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.933 | 6 | 1408201 (52164) | 38443 | n/a | 61992 ms |
| no-skill | 0.889 | 5 | 981227 (34697) | 31805 | n/a | 55119 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [-0.044, 0.133], q = 1.000, not significant.

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 0/45.

Tool calls per run (load_skill excluded), mean: skill 6.5, no-skill 5.3.

Skill arm task success by loading: loaded 24/24, not loaded 18/21.

Skill loading: recall 67% (24/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 3/3 |  |
| code-add-slugify | trigger | 3/3 | 2/3 | 2/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 1/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 2/3 |  |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 3/3 |  |
| code-config-page-size | trigger | 3/3 | 2/3 | 2/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 3/3 |  |
| code-remove-deprecated | trigger | 3/3 | 3/3 | 2/3 |  |
| code-missing-await | trigger | 3/3 | 3/3 | 2/3 |  |
| code-validate-qty | trigger | 3/3 | 3/3 | 2/3 |  |
| code-preexisting-failure | trigger | 3/3 | 3/3 | 2/3 |  |
| code-in-use-cleanup | trigger | 1/3 | 0/3 | 0/3 | data/cache-2025.json was removed or changed, but code still reads it |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 2/3 | 3/3 | 0/3 | missing "yrassecen" |

