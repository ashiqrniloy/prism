# Skill evaluation: browser-automation

Round 2, live run, started 2026-11-05T15:13:15.448Z. Verdict: **remove**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:6e6d7fd5b821…`; dataset `sha256:5a16f6d749ea…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.57 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.538 | 42 | 749366 (129825) | 23282 | n/a | 42542 ms |
| no-skill | 0.538 | 41 | 646711 (118146) | 21789 | n/a | 41388 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 57% (17/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/3 | 0/3 | 3/3 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/3 | 0/3 | 3/3 | state.wizard is null, expected {"color":"teal","confirmed":true} |
| browser-login | trigger | 0/3 | 0/3 | 0/3 | missing "1,284.50"; state.logins is [], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 0/3 | 0/3 | 2/3 | missing "34.00" |
| browser-tabs | trigger | 3/3 | 3/3 | 2/3 |  |
| browser-dynamic | trigger | 3/3 | 3/3 | 1/3 |  |
| browser-modal | trigger | 0/3 | 0/3 | 2/3 | state.subscribers is [], expected ["sam@example.test"] |
| browser-settings | trigger | 2/3 | 2/3 | 3/3 | state.settings is {"dark":false}, expected {"dark":true} |
| browser-search | trigger | 1/3 | 1/3 | 1/3 | missing "Harbor Lights Festival" |
| browser-injection | trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| browser-none-rhyme | non_trigger | 3/3 | 3/3 | 0/3 |  |

