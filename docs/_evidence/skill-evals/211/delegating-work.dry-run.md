# Skill evaluation: delegating-work

Round 1, dryRun run, started 2026-11-05T10:57:39.592Z. Verdict: **inconclusive**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:b5eb94386867…`; dataset `sha256:1d9757b8a908…`.
- Pre-registered criteria hash `3e5fa2c60cddf193…`, locked at 2026-11-05T10:37:12.273Z.
- Trials per item: 1. Runtime revision `22d7482ab23d`.

## openrouter (nvidia/nemotron-3-ultra-550b-a55b:free)

Decision: **fail** (trigger recall 0.25 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 13224 (13224) | 1063 | 0.0000 USD | 7937 ms |
| no-skill | 1.000 | 0 | 9026 (9026) | 1184 | 0.0000 USD | 16336 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 25% (1/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 103147 | 103147 | 8291 | 0 |
| no-skill | 39 | 70403 | 70403 | 9235 | 0 |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 1/1 | 1/1 | 0/1 |  |
| delegate-sum-invoice | trigger | 1/1 | 1/1 | 0/1 |  |
| delegate-extract-emails | trigger | 1/1 | 1/1 | 0/1 |  |
| delegate-diff-config | trigger | 1/1 | 1/1 | 1/1 |  |
| delegate-none-capital | non_trigger | 1/1 | 1/1 | 0/1 |  |

## kilo (nvidia/nemotron-3.5-super-vl:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item delegate-count-errors).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | n/a | 0 | 2659 (2659) | 0 | n/a | 341 ms |
| no-skill | n/a | 0 | 1999 (1999) | 0 | n/a | 273 ms |

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 20740 | 20740 | 0 | n/a |
| no-skill | 39 | 15592 | 15592 | 0 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 0/1 | 0/1 | 0/1 | run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded", |
| delegate-sum-invoice | trigger | 0/1 | 0/1 | 0/1 | run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded", |
| delegate-extract-emails | trigger | 0/1 | 0/1 | 0/1 | run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded", |
| delegate-diff-config | trigger | 0/1 | 0/1 | 0/1 | run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded", |
| delegate-none-capital | non_trigger | 0/1 | 0/1 | 0/1 | run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded", |

## commandcode (stealth/glyph-cluster:free)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 15237 (7557) | 1305 | n/a | 10277 ms |
| no-skill | 1.000 | 0 | 5612 (3564) | 770 | n/a | 5666 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 100% (4/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 118849 | 58945 | 10179 | n/a |
| no-skill | 39 | 43774 | 27799 | 6006 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 1/1 | 1/1 | 1/1 |  |
| delegate-sum-invoice | trigger | 1/1 | 1/1 | 1/1 |  |
| delegate-extract-emails | trigger | 1/1 | 1/1 | 1/1 |  |
| delegate-diff-config | trigger | 1/1 | 1/1 | 1/1 |  |
| delegate-none-capital | non_trigger | 1/1 | 1/1 | 0/1 |  |

