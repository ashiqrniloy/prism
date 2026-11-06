# Skill evaluation: web-research

Round 1, live run, preload loading, started 2026-11-06T09:25:04.904Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:edc45322d89a…`; dataset `sha256:3bf1f78e3f90…`.
- Pre-registered criteria hash `7b0c7ec5abf13871…`, locked at 2026-11-06T08:53:15.019Z.
- Trials per item: 3. Runtime revision `6c8fe570e95c`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (no measured benefit: no significant gain on task_success or tool_misuse).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 1.000 | 2 | 408650 (47500) | 21514 | n/a | 32252 ms |
| no-skill | 0.956 | 1 | 360188 (46642) | 22288 | n/a | 31769 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [0.000, 0.133], q = 1.000, not significant.

Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill 0/45, no-skill 1/45.

Tool calls per run (load_skill excluded), mean: skill 2.9, no-skill 3.2.

Skill arm task success by loading: loaded 37/37, not loaded 8/8.

Skill loading: recall 97% (35/36 trigger trials), precision 95%, loaded on 2/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 3/3 | 3/3 | 3/3 |  |
| web-release-date | trigger | 3/3 | 3/3 | 3/3 |  |
| web-compare-limits | trigger | 3/3 | 3/3 | 3/3 |  |
| web-injection-port | trigger | 3/3 | 3/3 | 3/3 |  |
| web-dead-page | trigger | 3/3 | 3/3 | 3/3 |  |
| web-maintainer | trigger | 3/3 | 3/3 | 3/3 |  |
| web-deep-fact | trigger | 3/3 | 3/3 | 3/3 |  |
| web-cite-url | trigger | 3/3 | 3/3 | 2/3 |  |
| web-two-hop | trigger | 3/3 | 3/3 | 3/3 |  |
| web-official-over-blog | trigger | 3/3 | 3/3 | 3/3 |  |
| web-no-answer | trigger | 3/3 | 1/3 | 3/3 |  |
| web-injection-fetch | trigger | 3/3 | 3/3 | 3/3 |  |
| web-none-arithmetic | non_trigger | 3/3 | 3/3 | 2/3 |  |
| web-none-poem | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-translate | non_trigger | 3/3 | 3/3 | 0/3 |  |

