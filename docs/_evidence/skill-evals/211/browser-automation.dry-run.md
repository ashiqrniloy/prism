# Skill evaluation: browser-automation

Round 1, dryRun run, started 2026-11-05T10:49:14.641Z. Verdict: **inconclusive**.

- Package: `@arnilo/prism-tools-browser`; skills revision `sha256:895319a8e28b…`; dataset `sha256:73d1c6893194…`.
- Pre-registered criteria hash `3e5fa2c60cddf193…`, locked at 2026-11-05T10:37:12.273Z.
- Trials per item: 1. Runtime revision `22d7482ab23d`.

## openrouter (nvidia/nemotron-3-ultra-550b-a55b:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item browser-form).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.200 | 9 | 131212 (126828) | 3269 | n/a | 25523 ms |
| no-skill | 0.333 | 6 | 89564 (89564) | 2347 | n/a | 16158 ms |

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 1023454 | 989258 | 25498 | n/a |
| no-skill | 39 | 698599 | 698599 | 18307 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/1 | 0/1 | 0/1 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/1 | 0/1 | 0/1 | state.wizard is null, expected {"color":"teal","confirmed":true} |
| browser-login | trigger | 0/1 | 0/1 | 0/1 | missing "1,284.50"; state.logins is [], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 0/1 | 0/1 | 0/1 | missing "34.00" |
| browser-none-arithmetic | non_trigger | 1/1 | 1/1 | 0/1 |  |

## kilo (nvidia/nemotron-3.5-super-vl:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item browser-login).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.200 | 12 | 128455 (119783) | 4390 | n/a | 14238 ms |
| no-skill | 0.000 | 6 | 62096 (62096) | 1789 | n/a | 5717 ms |

Skill loading: recall 25% (1/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 1001949 | 934307 | 34242 | n/a |
| no-skill | 39 | 484349 | 484349 | 13954 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/1 | 0/1 | 0/1 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/1 | 0/1 | 0/1 | state.wizard is null, expected {"color":"teal","confirmed":true} |
| browser-login | trigger | 0/1 | 0/1 | 1/1 | missing "1,284.50"; state.logins is [], expected [{"ok":true,"user":"agent"}] |
| browser-pagination | trigger | 0/1 | 0/1 | 0/1 | missing "34.00" |
| browser-none-arithmetic | non_trigger | 1/1 | 0/1 | 0/1 |  |

## commandcode (stealth/glyph-cluster:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item browser-wizard).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.250 | 11 | 81245 (23389) | 3243 | n/a | 18936 ms |
| no-skill | 0.400 | 14 | 82621 (23229) | 2583 | n/a | 19921 ms |

Skill loading: recall 100% (4/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 633711 | 182434 | 25295 | n/a |
| no-skill | 39 | 644444 | 181186 | 20147 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| browser-form | trigger | 0/1 | 0/1 | 1/1 | state.submissions is [], expected [{"email":"dana@example.test","name":"Dana Reyes","newsletter":true,"plan":"pro"}] |
| browser-wizard | trigger | 0/1 | 0/1 | 1/1 | run failed: Run limit exceeded: maxToolCalls |
| browser-login | trigger | 0/1 | 1/1 | 1/1 | missing "1,284.50" |
| browser-pagination | trigger | 0/1 | 0/1 | 1/1 | missing "34.00" |
| browser-none-arithmetic | non_trigger | 1/1 | 1/1 | 0/1 |  |

