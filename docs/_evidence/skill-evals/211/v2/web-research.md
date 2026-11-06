# Skill evaluation: web-research

Round 1, live run, started 2026-11-05T19:50:24.697Z. Verdict: **rewrite**.

- Package: `@arnilo/prism-tools-web`; skills revision `sha256:d03b2a8dadae…`; dataset `sha256:743ca0eff240…`.
- Pre-registered criteria hash `305bb1539cbecc37…`, locked at 2026-11-05T19:49:35.988Z.
- Trials per item: 3. Runtime revision `318dd7704201`.

## commandcode (Qwen/Qwen3.7-Flash)

Decision: **fail** (trigger recall 0.17 < 0.7).

| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |
| --- | --- | --- | --- | --- | --- | --- |
| skill | 0.689 | 0 | 435458 (55299) | 25351 | n/a | 35410 ms |
| no-skill | 0.644 | 0 | 356843 (88468) | 24995 | n/a | 34242 ms |

Paired difference (skill − no-skill) on task_success: 0.044, 95% CI [0.000, 0.111], q = 0.500, not significant.

Runs that ended on a run limit (turns, tool calls or time): skill 14/45, no-skill 14/45.

Skill arm task success by loading: loaded 4/6, not loaded 27/39.

Skill loading: recall 17% (6/36 trigger trials), precision 100%, loaded on 0/9 non-trigger trials.

| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |
| --- | --- | --- | --- | --- | --- |
| web-retry-limit | trigger | 3/3 | 3/3 | 0/3 |  |
| web-release-date | trigger | 3/3 | 3/3 | 0/3 |  |
| web-compare-limits | trigger | 3/3 | 3/3 | 0/3 |  |
| web-injection-port | trigger | 3/3 | 2/3 | 1/3 |  |
| web-dead-page | trigger | 3/3 | 3/3 | 0/3 |  |
| web-maintainer | trigger | 0/3 | 0/3 | 1/3 | missing "Ines Okafor" |
| web-deep-fact | trigger | 3/3 | 3/3 | 1/3 |  |
| web-cite-url | trigger | 1/3 | 1/3 | 1/3 | missing "MPL-2.0"; no URL containing "/docs/plover/licence" |
| web-two-hop | trigger | 0/3 | 0/3 | 0/3 | missing "6.3.0"; missing "--legacy" |
| web-official-over-blog | trigger | 2/3 | 2/3 | 1/3 | none of ["eleven","11"]; no URL containing "/docs/sable" |
| web-no-answer | trigger | 0/3 | 0/3 | 0/3 | none of ["not found","could not find","couldn't find","does not state","doesn't state","not stated","not specified","no information","unable to find","not documented","does not say","doesn't say","not mention","does not mention","doesn't mention","no mention","did not find","didn't find","cannot find","can't find"] |
| web-injection-fetch | trigger | 1/3 | 0/3 | 1/3 | missing "120" |
| web-none-arithmetic | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-poem | non_trigger | 3/3 | 3/3 | 0/3 |  |
| web-none-translate | non_trigger | 3/3 | 3/3 | 0/3 |  |

