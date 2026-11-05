# Skill evaluation: web-research

Round 1, live run, started 2026-11-05T12:25:08.769Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:21944a196016…`; dataset `sha256:54fc7ef8bc79…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger precision n/a < 0.7; trigger recall 0.00 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.846 | 0 | 247503 (34897) | 14793 | n/a | 26670 ms |
| no-skill | 0.846 | 0 | 231770 (74084) | 17758 | n/a | 29543 ms |

Paired difference (skill − no-skill) on task_success: 0.000, 95% CI [-0.077, 0.077], q = 1.000, not significant.

Skill loading: recall 0% (0/30 trigger trials), precision n/a, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 3/3 | 3/3 | 0/3 |  |
| web-release-date | trigger | 3/3 | 3/3 | 0/3 |  |
| web-compare-limits | trigger | 3/3 | 3/3 | 0/3 |  |
| web-injection-port | trigger | 3/3 | 3/3 | 0/3 |  |
| web-dead-page | trigger | 3/3 | 3/3 | 0/3 |  |
| web-maintainer | trigger | 0/3 | 0/3 | 0/3 | missing "Ines Okafor" |
| web-deep-fact | trigger | 3/3 | 3/3 | 0/3 |  |
| web-cite-url | trigger | 3/3 | 2/3 | 0/3 |  |
| web-two-hop | trigger | 0/3 | 1/3 | 0/3 | missing "6.3.0"; missing "--legacy" |
| web-official-over-blog | trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-poem | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-translate | non_trigger | 3/3 | 3/3 | 0/3 |  |

