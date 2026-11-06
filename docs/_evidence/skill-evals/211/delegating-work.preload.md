# Skill evaluation: delegating-work

Round 1, live run, preload loading, started 2026-11-06T10:11:39.308Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:c5e830760597…`; dataset `sha256:15a5431c23fd…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (no measured benefit: no significant gain on task_success or tool_misuse).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.978 | 0 | 112266 (51259) | 19224 | n/a | 55089 ms |
| no-skill | 0.933 | 0 | 74726 (57608) | 17735 | n/a | 56612 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [-0.067, 0.200], q = 1.000, not significant.

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 0/45.

Tool calls per run (load_skill excluded), mean: skill 0.7, no-skill 0.8.

Skill arm task success by loading: loaded 19/20, not loaded 25/25.

Skill loading: recall 47% (17/36 trigger trials), precision 85%, loaded on 3/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-sum-invoice | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-extract-emails | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-diff-config | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-longest-word | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-iso-dates | trigger | 2/3 | 3/3 | 1/3 | the analyst child was never used |
| delegate-classify-reviews | trigger | 3/3 | 3/3 | 3/3 |  |
| delegate-average | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-find-bug | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-cheapest-quote | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-secret-in-config | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-trivial-no-child | trigger | 3/3 | 0/3 | 1/3 |  |
| delegate-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-leap | non_trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-none-synonym | non_trigger | 3/3 | 3/3 | 2/3 |  |

