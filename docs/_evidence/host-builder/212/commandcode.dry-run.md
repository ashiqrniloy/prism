# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T09:30:05.489Z. Verdict: **no-claims**.

- Pre-registered criteria hash `ee29e22e5b5fc0b6…`, locked at 2026-11-07T09:29:57.121Z.
- Trials per task: 1. Runtime revision `20119d6ba680`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## commandcode (stealth/glyph-cluster:free)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 1.000 | 0.667 | 1.000 | 84.0 | 0/3 | 0/3 | 0/3 | 2065255 (312609) | 47938 | n/a | 370598 ms |
| skill | 1.000 | 0.667 | 0.667 | 1.000 | 35.0 | 3/3 | 0/3 | 0/3 | 734693 (125413) | 17840 | n/a | 130813 ms |
| skill+mcp | 1.000 | 1.000 | 1.000 | 1.000 | 35.0 | 3/3 | 3/3 | 0/3 | 620825 (112409) | 14619 | n/a | 116437 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| public_surface_only | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 14456785 | 2188263 | 335566 | n/a |
| skill | 21 | 5142851 | 877891 | 124880 | n/a |
| skill+mcp | 21 | 4345775 | 786863 | 102333 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 1/1 | 1/1 | 1/1 |  |
| headless-host | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| headless-host | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | none | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | none | 1/1 | 1/1 | 0/1 | 1/1 | src/host.ts: testing import outside a test: @arnilo/prism/testing |
| upgrade-0-12 | skill | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = op |
| upgrade-0-12 | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |

