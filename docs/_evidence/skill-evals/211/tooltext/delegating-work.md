# Skill evaluation: delegating-work

Round 1, live run, natural loading, started 2026-11-06T12:56:41.147Z. Verdict: **observed**.

- Package: `@arnilo/prism-delegate`; skills revision `sha256:c5e830760597…`; dataset `sha256:15a5431c23fd…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `1ea4b29062f7`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **observed** (natural loading: trigger recall 0.31, precision 1.00; reported, not a ship gate).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 0 | 108803 (22959) | 17853 | n/a | 63158 ms |
| no-skill | 0.933 | 0 | 79467 (53970) | 16997 | n/a | 59106 ms |

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 0/45.

Tool calls per run (load_skill excluded), mean: skill 0.8, no-skill 0.8.

Skill arm task success by loading: loaded 11/11, not loaded 34/34.

Skill loading: recall 31% (11/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| delegate-count-errors | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-sum-invoice | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-extract-emails | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-diff-config | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-longest-word | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-iso-dates | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-classify-reviews | trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-average | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-find-bug | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-cheapest-quote | trigger | 3/3 | 3/3 | 1/3 |  |
| delegate-secret-in-config | trigger | 3/3 | 3/3 | 2/3 |  |
| delegate-trivial-no-child | trigger | 3/3 | 0/3 | 0/3 |  |
| delegate-none-capital | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-leap | non_trigger | 3/3 | 3/3 | 0/3 |  |
| delegate-none-synonym | non_trigger | 3/3 | 3/3 | 0/3 |  |

