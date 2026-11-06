# Skill evaluation: coding-workflow

Round 1, live run, natural loading, started 2026-11-06T11:21:12.331Z. Verdict: **observed**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:e528880ab763…`; dataset `sha256:2389d66e2751…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **observed** (natural loading: trigger recall 0.00, precision n/a; reported, not a ship gate).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.933 | 4 | 947254 (37900) | 27712 | n/a | 38723 ms |
| no-skill | 0.867 | 4 | 939275 (36672) | 33019 | n/a | 43343 ms |

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/44, no-skill 0/45.

Tool calls per run (load_skill excluded), mean: skill 5.3, no-skill 5.2.

Skill arm task success by loading: loaded 0/0, not loaded 41/44.

Skill loading: recall 0% (0/36 trigger trials), precision n/a, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-price | trigger | 2/3 | 3/3 | 0/3 | run failed: Upstream stream ended before terminal chunk |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-config-page-size | trigger | 3/3 | 2/3 | 0/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 0/3 |  |
| code-remove-deprecated | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-await | trigger | 3/3 | 3/3 | 0/3 |  |
| code-validate-qty | trigger | 3/3 | 3/3 | 0/3 |  |
| code-preexisting-failure | trigger | 3/3 | 3/3 | 0/3 |  |
| code-in-use-cleanup | trigger | 0/3 | 0/3 | 0/3 | data/cache-2025.json was removed or changed, but code still reads it |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 3/3 | 1/3 | 0/3 |  |

