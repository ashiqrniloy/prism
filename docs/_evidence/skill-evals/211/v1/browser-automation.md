# Skill evaluation: browser-automation

Round 1, live run, started 2026-11-05T12:55:10.952Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:895319a8e28b…`; dataset `sha256:5a16f6d749ea…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger precision n/a < 0.7; trigger recall 0.00 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.641 | 37 | 697537 (124988) | 22823 | n/a | 44511 ms |
| no-skill | 0.667 | 36 | 632836 (117281) | 20858 | n/a | 40744 ms |

Paired difference (skill − no-skill) on task_success: -0.026, 95% CI [-0.154, 0.077], q = 1.000, not significant.

Skill loading: recall 0% (0/30 trigger trials), precision n/a, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/3 | 0/3 | 0/3 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/3 | 0/3 | 0/3 | state.wizard is null, expected {"color":"teal","confirmed":true} |
| browser-login | trigger | 0/3 | 2/3 | 0/3 | missing "1,284.50"; state.logins is [], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 0/3 | 0/3 | 0/3 | missing "34.00" |
| browser-tabs | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-modal | trigger | 1/3 | 0/3 | 0/3 | state.subscribers is [], expected ["sam@example.test"] |
| browser-settings | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-search | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-injection | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 0/3 |  |

