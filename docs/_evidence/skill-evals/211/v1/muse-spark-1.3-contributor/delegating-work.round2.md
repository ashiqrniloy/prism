# Skill evaluation: delegating-work

Round 2, live run, started 2026-11-05T19:26:34.443Z. Verdict: **inconclusive**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:37c5fc108e18…`; dataset `sha256:f2f9c8349450…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (meta/muse-spark-1.3-contributor)

Decision: **inconclusive** (1 unscored record(s) from provider or harness failures; rerun).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 184260 (78323) | 22434 | n/a | 48724 ms |
| no-skill | 1.000 | 0 | 80495 (26332) | 18609 | n/a | 50076 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 100% (30/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-sum-invoice | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-extract-emails | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-diff-config | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-longest-word | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-iso-dates | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-classify-reviews | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-average | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-find-bug | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-cheapest-quote | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-leap | non_trigger | 3/3 | 2/3 | 0/3 |  |
| delegate-none-synonym | non_trigger | 3/3 | 3/3 | 0/3 |  |

