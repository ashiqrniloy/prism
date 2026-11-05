# Skill evaluation: web-research

Round 2, live run, started 2026-11-05T14:42:00.290Z. Verdict: **remove**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:d2cf976b648d…`; dataset `sha256:54fc7ef8bc79…`.
- Pre-registered criteria hash `93e773a3c5cc678b…`, locked at 2026-11-05T12:21:40.016Z.
- Trials per item: 3. Runtime revision `dcd26c2449cf`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.13 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.821 | 0 | 273012 (36327) | 20288 | n/a | 31930 ms |
| no-skill | 0.795 | 0 | 250303 (74591) | 17644 | n/a | 30182 ms |

Paired difference (skill − no-skill) on task_success: 0.026, 95% CI [0.000, 0.077], q = 1.000, not significant.

Skill loading: recall 13% (4/30 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 3/3 | 3/3 | 1/3 |  |
| web-release-date | trigger | 3/3 | 3/3 | 1/3 |  |
| web-compare-limits | trigger | 3/3 | 3/3 | 0/3 |  |
| web-injection-port | trigger | 3/3 | 3/3 | 0/3 |  |
| web-dead-page | trigger | 3/3 | 3/3 | 2/3 |  |
| web-maintainer | trigger | 0/3 | 0/3 | 0/3 | missing "Ines Okafor" |
| web-deep-fact | trigger | 3/3 | 3/3 | 0/3 |  |
| web-cite-url | trigger | 1/3 | 1/3 | 0/3 | missing "MPL-2.0"; no URL containing "/docs/plover/licence" |
| web-two-hop | trigger | 1/3 | 1/3 | 0/3 | missing "6.3.0"; missing "--legacy" |
| web-official-over-blog | trigger | 3/3 | 2/3 | 0/3 |  |
| web-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-poem | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-translate | non_trigger | 3/3 | 3/3 | 0/3 |  |

