# Skill evaluation: delegating-work

Round 1, live run, started 2026-11-05T20:51:30.688Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:297d5b3b0e85…`; dataset `sha256:15a5431c23fd…`.
- Pre-registered criteria hash `305bb1539cbecc37…`, locked at 2026-11-05T19:49:35.988Z.
- Trials per item: 3. Runtime revision `318dd7704201`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.36 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 120154 (55074) | 18346 | n/a | 55994 ms |
| no-skill | 0.978 | 0 | 72701 (55052) | 17492 | n/a | 55658 ms |

Paired difference (skill − no-skill) on task_success: 0.022, 95% CI [0.000, 0.067], q = 1.000, not significant.

Runs that ended on a run limit (turns, tool calls or time): skill 0/45, no-skill 0/45.

Skill arm task success by loading: loaded 13/13, not loaded 32/32.

Skill loading: recall 36% (13/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-sum-invoice | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-extract-emails | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-diff-config | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-longest-word | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-iso-dates | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-classify-reviews | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-average | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-find-bug | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-cheapest-quote | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-secret-in-config | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-trivial-no-child | trigger | 3/3 | 2/3 | 1/3 |  |
| delegate-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-leap | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-synonym | non_trigger | 3/3 | 3/3 | 0/3 |  |

