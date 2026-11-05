# Skill evaluation: coding-workflow

Round 1, dryRun run, started 2026-11-05T10:41:30.536Z. Verdict: **inconclusive**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:2bbb12e469eb…`; dataset `sha256:c86065f3eb2d…`.
- Pre-registered criteria hash `3e5fa2c60cddf193…`, locked at 2026-11-05T10:37:12.273Z.
- Trials per item: 1. Runtime revision `22d7482ab23d`.

## openrouter (nvidia/nemotron-3-ultra-550b-a55b:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item code-add-slugify).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 2 | 124536 (23704) | 2662 | n/a | 28171 ms |
| no-skill | 1.000 | 0 | 104991 (30463) | 2411 | n/a | 16146 ms |

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 971381 | 184891 | 20764 | n/a |
| no-skill | 39 | 818930 | 237611 | 18806 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 1/1 | 1/1 | 0/1 |  |
| code-add-slugify | trigger | 0/1 | 1/1 | 0/1 | run failed: Run limit exceeded: maxInputTokens |
| code-rename-across-files | trigger | 0/1 | 0/1 | 0/1 | run failed: Run limit exceeded: maxInputTokens |
| code-missing-price | trigger | 1/1 | 1/1 | 0/1 |  |
| code-none-capital | non_trigger | 1/1 | 1/1 | 0/1 |  |

## kilo (nvidia/nemotron-3.5-super-vl:free)

Decision: **inconclusive** (comparison failed: Missing scorer task_success on paired item code-rename-across-files).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 1 | 98899 (12179) | 2858 | 0.0000 USD | 8641 ms |
| no-skill | 1.000 | 1 | 106943 (28895) | 3012 | n/a | 7532 ms |

Skill loading: recall 0% (0/4 trigger trials), precision n/a, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 771412 | 94996 | 22292 | 0 |
| no-skill | 39 | 834155 | 225381 | 23494 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 1/1 | 1/1 | 0/1 |  |
| code-add-slugify | trigger | 1/1 | 1/1 | 0/1 |  |
| code-rename-across-files | trigger | 1/1 | 0/1 | 0/1 |  |
| code-missing-price | trigger | 1/1 | 1/1 | 0/1 |  |
| code-none-capital | non_trigger | 1/1 | 1/1 | 0/1 |  |

## commandcode (stealth/glyph-cluster:free)

Decision: **ship** (no significant regression; trigger precision and recall meet the minimums).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 77956 (20612) | 2978 | n/a | 15816 ms |
| no-skill | 1.000 | 0 | 71749 (23543) | 3077 | n/a | 15988 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 75% (3/4 trigger trials), precision 100%, loaded on 0/1 non-trigger trials.

Full-run estimate (items x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| skill | 39 | 608057 | 160774 | 23228 | n/a |
| no-skill | 39 | 559642 | 183635 | 24001 | n/a |

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 1/1 | 1/1 | 0/1 |  |
| code-add-slugify | trigger | 1/1 | 1/1 | 1/1 |  |
| code-rename-across-files | trigger | 1/1 | 1/1 | 1/1 |  |
| code-missing-price | trigger | 1/1 | 1/1 | 1/1 |  |
| code-none-capital | non_trigger | 1/1 | 1/1 | 0/1 |  |

