# Skill evaluation: browser-automation

Round 1, live run, started 2026-11-06T07:06:21.164Z. Verdict: **ship**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:292879628109…`; dataset `sha256:38047b4b00cf…`.
- Pre-registered criteria hash `305bb1539cbecc37…`, locked at 2026-11-05T19:49:35.988Z.
- Trials per item: 3. Runtime revision `c89ddd106a26`.

## commandcode (meta/muse-spark-1.3-contributor)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.911 | 0 | 1127182 (321916) | 40019 | n/a | 48022 ms |
| no-skill | 0.711 | 30 | 1019465 (221847) | 55698 | n/a | 61340 ms |

Paired difference (skill − no-skill) on task_success: 0.200, 95% CI [-0.022, 0.422], q = 0.156, not significant.

Runs that ended on a run limit (turns, tool calls or time): skill 12/45, no-skill 19/45.

Skill arm task success by loading: loaded 37/41, not loaded 4/4.

Skill loading: recall 100% (36/36 trigger trials), precision 88%, loaded on 5/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 3/3 | 2/3 | 3/3 |  |
| browser-wizard | trigger | 3/3 | 0/3 | 3/3 |  |
| browser-login | trigger | 3/3 | 1/3 | 3/3 |  |
| browser-pagination | trigger | 0/3 | 2/3 | 3/3 | missing "34.00" |
| browser-tabs | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-modal | trigger | 3/3 | 0/3 | 3/3 |  |
| browser-settings | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-search | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-injection | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-no-submit | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-no-credentials | trigger | 3/3 | 1/3 | 3/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 3/3 | 2/3 |  |
| browser-none-capital | non_trigger | 2/3 | 2/3 | 2/3 | missing "Ottawa" |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 1/3 |  |

