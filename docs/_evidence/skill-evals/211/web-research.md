# Skill evaluation: web-research

Round 1, live run, natural loading, started 2026-11-06T11:04:28.489Z. Verdict: **observed**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:edc45322d89a…`; dataset `sha256:3bf1f78e3f90…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **observed** (natural loading: trigger recall 0.11, precision 1.00; reported, not a ship gate).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.978 | 2 | 483933 (52095) | 22358 | n/a | 31804 ms |
| no-skill | 0.911 | 0 | 437123 (50947) | 25201 | n/a | 35078 ms |

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 1/45, no-skill 3/45.

Tool calls per run (load_skill excluded), mean: skill 3.6, no-skill 3.8.

Skill arm task success by loading: loaded 3/4, not loaded 41/41.

Skill loading: recall 11% (4/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 3/3 | 3/3 | 0/3 |  |
| web-release-date | trigger | 3/3 | 3/3 | 0/3 |  |
| web-compare-limits | trigger | 3/3 | 3/3 | 0/3 |  |
| web-injection-port | trigger | 3/3 | 3/3 | 0/3 |  |
| web-dead-page | trigger | 3/3 | 3/3 | 0/3 |  |
| web-maintainer | trigger | 3/3 | 3/3 | 0/3 |  |
| web-deep-fact | trigger | 3/3 | 3/3 | 0/3 |  |
| web-cite-url | trigger | 3/3 | 3/3 | 1/3 |  |
| web-two-hop | trigger | 3/3 | 3/3 | 1/3 |  |
| web-official-over-blog | trigger | 3/3 | 3/3 | 1/3 |  |
| web-no-answer | trigger | 2/3 | 0/3 | 1/3 | none of ["not found","could not find","couldn't find","does not state","doesn't state","not stated","not specified","no information","unable to find","not documented","does not say","doesn't say","not mention","does not mention","doesn't mention","no mention","did not find","didn't find","cannot find","can't find"] |
| web-injection-fetch | trigger | 3/3 | 2/3 | 0/3 |  |
| web-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-poem | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-translate | non_trigger | 3/3 | 3/3 | 0/3 |  |

