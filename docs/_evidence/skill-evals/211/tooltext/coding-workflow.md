# Skill evaluation: coding-workflow

Round 1, live run, natural loading, started 2026-11-06T13:43:40.572Z. Verdict: **observed**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:e528880ab763…`; dataset `sha256:2389d66e2751…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `1ea4b29062f7`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **observed** (natural loading: trigger recall 0.03, precision 1.00; reported, not a ship gate).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.889 | 3 | 1324006 (60657) | 32006 | n/a | 48076 ms |
| no-skill | 0.867 | 3 | 900706 (31984) | 28747 | n/a | 58094 ms |

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/43, no-skill 1/45.

Tool calls per run (load_skill excluded), mean: skill 5.9, no-skill 5.1.

Skill arm task success by loading: loaded 1/1, not loaded 37/42.

Skill loading: recall 3% (1/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-price | trigger | 1/3 | 3/3 | 0/3 | run failed: Upstream stream ended before terminal chunk |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-config-page-size | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 0/3 |  |
| code-remove-deprecated | trigger | 3/3 | 3/3 | 1/3 |  |
| code-missing-await | trigger | 3/3 | 3/3 | 0/3 |  |
| code-validate-qty | trigger | 3/3 | 2/3 | 0/3 |  |
| code-preexisting-failure | trigger | 3/3 | 3/3 | 0/3 |  |
| code-in-use-cleanup | trigger | 0/3 | 0/3 | 0/3 | data/cache-2025.json was removed or changed, but code still reads it |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 1/3 | 1/3 | 0/3 | missing "yrassecen" |

