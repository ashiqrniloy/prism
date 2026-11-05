# Skill evaluation: delegating-work

Round 2, live run, started 2026-11-05T15:51:28.463Z. Verdict: **remove**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:37c5fc108e18…`; dataset `sha256:f2f9c8349450…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.30 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.974 | 0 | 100011 (48482) | 19114 | n/a | 60435 ms |
| no-skill | 1.000 | 0 | 64877 (50646) | 14847 | n/a | 56615 ms |

Paired difference (skill − no-skill) on task_success: -0.026, 95% CI [-0.077, 0.000], q = 1.000, not significant.

Skill loading: recall 30% (9/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-sum-invoice | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-extract-emails | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-diff-config | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-longest-word | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-iso-dates | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-classify-reviews | trigger | 2/3 | 3/3 | 1/3 | the analyst child was never used |
| delegate-average | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-find-bug | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-cheapest-quote | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-leap | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-synonym | non_trigger | 3/3 | 3/3 | 0/3 |  |

