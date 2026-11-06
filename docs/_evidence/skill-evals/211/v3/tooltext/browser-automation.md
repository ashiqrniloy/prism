# Skill evaluation: browser-automation

Round 1, live run, natural loading, started 2026-11-06T14:10:18.904Z. Verdict: **observed**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:0b0b4a52e6b7…`; dataset `sha256:b87b713757d6…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `1ea4b29062f7`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **observed** (natural loading: trigger recall 0.47, precision 1.00; reported, not a ship gate).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.978 | 16 | 957471 (155834) | 28109 | n/a | 44666 ms |
| no-skill | 0.933 | 20 | 999031 (150261) | 29047 | n/a | 47614 ms |

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 2/45.

Tool calls per run (load_skill excluded), mean: skill 5.4, no-skill 6.1.

Skill arm task success by loading: loaded 17/17, not loaded 27/28.

Skill loading: recall 47% (17/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-wizard | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-login | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-pagination | trigger | 2/3 | 2/3 | 0/3 | missing "34.00" |
| browser-tabs | trigger | 3/3 | 3/3 | 1/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 1/3 |  |
| browser-modal | trigger | 3/3 | 3/3 | 2/3 |  |
| browser-settings | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-search | trigger | 3/3 | 3/3 | 1/3 |  |
| browser-injection | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-no-submit | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-no-credentials | trigger | 3/3 | 1/3 | 3/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 0/3 |  |

