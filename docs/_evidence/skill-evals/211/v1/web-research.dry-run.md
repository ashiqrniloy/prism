# Skill evaluation: web-research

Round 1, dryRun run, started 2026-11-05T10:37:18.283Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:21944a196016…`; dataset `sha256:9c4611ea3e76…`.
- Pre-registered criteria hash `3e5fa2c60cddf193…`, locked at 2026-11-05T10:37:12.273Z.
- Trials per item: 1. Runtime revision `22d7482ab23d`.

## openrouter (nvidia/nemotron-3-ultra-550b-a55b:free)

Decision: **fail** (trigger precision n/a < 0.7; trigger recall 0.00 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 24437 (24437) | 1061 | 0.0000 USD | 16805 ms |
| no-skill | 1.000 | 0 | 20205 (20205) | 1041 | 0.0000 USD | 7203 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 190609 | 190609 | 8276 | 0 |
| no-skill | 39 | 157599 | 157599 | 8120 | 0 |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 1/1 | 1/1 | 0/1 |  |
| web-release-date | trigger | 1/1 | 1/1 | 0/1 |  |
| web-compare-limits | trigger | 1/1 | 1/1 | 0/1 |  |
| web-injection-port | trigger | 1/1 | 1/1 | 0/1 |  |
| web-none-arithmetic | non_trigger | 1/1 | 1/1 | 0/1 |  |

## kilo (nvidia/nemotron-3.5-super-vl:free)

Decision: **fail** (trigger precision n/a < 0.7; trigger recall 0.00 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 22397 (22397) | 1112 | 0.0000 USD | 3601 ms |
| no-skill | 1.000 | 0 | 19435 (19435) | 1219 | 0.0000 USD | 4503 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 174697 | 174697 | 8674 | 0 |
| no-skill | 39 | 151593 | 151593 | 9508 | 0 |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 1/1 | 1/1 | 0/1 |  |
| web-release-date | trigger | 1/1 | 1/1 | 0/1 |  |
| web-compare-limits | trigger | 1/1 | 1/1 | 0/1 |  |
| web-injection-port | trigger | 1/1 | 1/1 | 0/1 |  |
| web-none-arithmetic | non_trigger | 1/1 | 1/1 | 0/1 |  |

## commandcode (stealth/glyph-cluster:free)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 27515 (14203) | 1526 | n/a | 10881 ms |
| no-skill | 1.000 | 0 | 14916 (10308) | 1046 | n/a | 7380 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 100% (4/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 214617 | 110783 | 11903 | n/a |
| no-skill | 39 | 116345 | 80402 | 8159 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 1/1 | 1/1 | 1/1 |  |
| web-release-date | trigger | 1/1 | 1/1 | 1/1 |  |
| web-compare-limits | trigger | 1/1 | 1/1 | 1/1 |  |
| web-injection-port | trigger | 1/1 | 1/1 | 1/1 |  |
| web-none-arithmetic | non_trigger | 1/1 | 1/1 | 0/1 |  |

