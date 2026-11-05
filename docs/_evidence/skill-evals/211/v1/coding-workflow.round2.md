# Skill evaluation: coding-workflow

Round 2, live run, started 2026-11-05T14:55:28.181Z. Verdict: **remove**.

- Package: `@arnilo/prism-tools-coding`; skills revision `sha256:d8762ce6a1a8…`; dataset `sha256:c019b118e58c…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.07 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.949 | 2 | 778764 (30678) | 26044 | n/a | 40548 ms |
| no-skill | 0.949 | 1 | 765461 (29534) | 27504 | n/a | 41092 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [0.000, 0.000], q = 1.000, not significant.

Skill loading: recall 7% (2/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| code-off-by-one | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-slugify | trigger | 3/3 | 3/3 | 1/3 |  |
| code-rename-across-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-missing-price | trigger | 3/3 | 3/3 | 0/3 |  |
| code-rounding-two-files | trigger | 3/3 | 3/3 | 0/3 |  |
| code-config-page-size | trigger | 3/3 | 3/3 | 0/3 |  |
| code-add-chunk | trigger | 3/3 | 3/3 | 0/3 |  |
| code-remove-deprecated | trigger | 2/3 | 2/3 | 1/3 | forbidden pattern still in src/totals.js |
| code-missing-await | trigger | 3/3 | 3/3 | 0/3 |  |
| code-validate-qty | trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-percent | non_trigger | 3/3 | 3/3 | 0/3 |  |
| code-none-reverse | non_trigger | 2/3 | 2/3 | 0/3 | missing "yrassecen" |

