# Skill evaluation: browser-automation

Round 1, live run, preload loading, started 2026-11-06T08:53:35.448Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:0b0b4a52e6b7…`; dataset `sha256:b87b713757d6…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (no measured benefit: no significant gain on task_success or tool_misuse).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.978 | 26 | 1156447 (164145) | 30338 | n/a | 57284 ms |
| no-skill | 0.933 | 34 | 1062224 (151453) | 29143 | n/a | 62087 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [-0.067, 0.200], q = 1.000, not significant.

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 3/45.

Tool calls per run (load_skill excluded), mean: skill 6.0, no-skill 6.7.

Skill arm task success by loading: loaded 35/36, not loaded 9/9.

Skill loading: recall 100% (36/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-wizard | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-login | trigger | 2/3 | 3/3 | 3/3 | state.logins is [{"ok":true,"user":"agent"},{"ok":true,"user":"agent"}], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-tabs | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-modal | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-settings | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-search | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-injection | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-no-submit | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-no-credentials | trigger | 3/3 | 0/3 | 3/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 0/3 |  |

