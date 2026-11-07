# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T21:04:24.304Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 1. Runtime revision `d9785f968725`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (beam)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.667 | 0.000 | 0.667 | 0.667 | 19.7 | 0/3 | 0/3 | 0/3 | 632278 (119318) | 4607 | n/a | 42317 ms |
| skill | 0.667 | 0.000 | 0.667 | 0.667 | 15.3 | 3/3 | 0/3 | 0/3 | 509022 (109214) | 4155 | n/a | 32972 ms |
| skill+mcp | 0.667 | 0.000 | 0.667 | 0.667 | 16.0 | 1/3 | 1/3 | 0/3 | 473601 (144577) | 2943 | n/a | 27497 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 4425946 | 835226 | 32249 | n/a |
| skill | 21 | 3563154 | 764498 | 29085 | n/a |
| skill+mcp | 21 | 3315207 | 1012039 | 20601 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill+mcp | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| acp-serve | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-KE80lQ/ |
| acp-serve | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-N5ftB6/ |
| acp-serve | skill+mcp | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-ONaIij/ |
| upgrade-0-12 | none | 0/1 | 0/1 | 0/1 | 0/1 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |
| upgrade-0-12 | skill | 0/1 | 0/1 | 0/1 | 0/1 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |
| upgrade-0-12 | skill+mcp | 0/1 | 0/1 | 0/1 | 0/1 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |

