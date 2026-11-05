# Skill evaluation: browser-automation

Round 2, live run, started 2026-11-05T19:07:34.556Z. Verdict: **inconclusive**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:6e6d7fd5b821…`; dataset `sha256:5a16f6d749ea…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (meta/muse-spark-1.3-contributor)

Decision: **inconclusive** (4 unscored record(s) from provider or harness failures; rerun).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.538 | 34 | 877690 (234776) | 37053 | n/a | 41763 ms |
| no-skill | 0.705 | 20 | 750556 (176431) | 40941 | n/a | 45403 ms |

Paired difference (skill − no-skill) on task_success: -0.167, 95% CI [-0.333, -0.026], q = 0.125, not significant.

Skill loading: recall 100% (30/30 trigger trials), precision 97%, loaded on 1/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/3 | 0/3 | 3/3 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/3 | 0/3 | 3/3 | state.wizard is null, expected {"color":"teal","confirmed":true} |
| browser-login | trigger | 0/3 | 1/3 | 3/3 | missing "1,284.50"; state.logins is [], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 0/3 | 1/3 | 3/3 | missing "34.00" |
| browser-tabs | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-modal | trigger | 0/3 | 1/3 | 3/3 | state.subscribers is [], expected ["sam@example.test"] |
| browser-settings | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-search | trigger | 0/3 | 3/3 | 3/3 | missing "Harbor Lights Festival" |
| browser-injection | trigger | 3/3 | 3/3 | 3/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 2/3 | 1/3 |  |
| browser-none-capital | non_trigger | 3/3 | 2/3 | 0/3 |  |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 0/3 |  |

