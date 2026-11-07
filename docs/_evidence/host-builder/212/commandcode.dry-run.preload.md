# Host-builder evaluation

Round 1, dryRun run, preload loading, started 2026-11-07T10:15:19.475Z. Verdict: **no-claims**.

- Pre-registered criteria hash `ee29e22e5b5fc0b6…`, locked at 2026-11-07T09:29:57.121Z.
- Trials per task: 1. Runtime revision `20119d6ba680`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## commandcode (stealth/glyph-cluster:free)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 0.667 | 1.000 | 1.000 | 56.0 | 0/3 | 0/3 | 0/3 | 1295271 (175015) | 30913 | n/a | 222134 ms |
| skill | 1.000 | 0.667 | 1.000 | 1.000 | 57.7 | 3/3 | 0/3 | 1/3 | 2535896 (128911) | 35140 | n/a | 280021 ms |
| skill+mcp | 1.000 | 0.333 | 0.667 | 1.000 | 46.3 | 3/3 | 3/3 | 0/3 | 958720 (120064) | 19161 | n/a | 145532 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [-1.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| public_surface_only | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| public_surface_only | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 9066897 | 1225105 | 216391 | n/a |
| skill | 21 | 17751272 | 902377 | 245980 | n/a |
| skill+mcp | 21 | 6711040 | 840448 | 134127 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 1/1 | 1/1 | 1/1 |  |
| headless-host | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill+mcp | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| acp-serve | none | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 33 | expect(result.status).toBe("completed"); 34 | const text = JSON.stringify( 35 | (last?.messages ?? []).flatMap((message) => messag |
| upgrade-0-12 | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | skill+mcp | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |

