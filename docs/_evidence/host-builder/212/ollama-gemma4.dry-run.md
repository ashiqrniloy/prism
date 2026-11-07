# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T21:04:24.300Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 1. Runtime revision `d9785f968725`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (gemma4:31b)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 0.000 | 0.667 | 0.667 | 25.7 | 0/3 | 0/3 | 0/3 | 2595255 (171767) | 7953 | n/a | 61689 ms |
| skill | 1.000 | 0.667 | 1.000 | 1.000 | 19.0 | 3/3 | 0/3 | 0/3 | 1317541 (78469) | 5883 | n/a | 38765 ms |
| skill+mcp | 1.000 | 0.667 | 0.667 | 1.000 | 20.0 | 3/3 | 3/3 | 0/3 | 960498 (50386) | 5227 | n/a | 37575 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.667 | [0.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| no_retired_names | 0.333 | [0.000, 1.000] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.667 | [0.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [-1.000, 1.000] | 1.000 | not significant |
| no_retired_names | 0.333 | [0.000, 1.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [-1.000, 1.000] | 1.000 | not significant |
| public_surface_only | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 18166785 | 1202369 | 55671 | n/a |
| skill | 21 | 9222787 | 549283 | 41181 | n/a |
| skill+mcp | 21 | 6723486 | 352702 | 36589 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 35 | const session = await agent.session(); 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status |
| headless-host | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| headless-host | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| acp-serve | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | none | 1/1 | 0/1 | 1/1 | 0/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 54 | function pick(name: SlotName, assigned: unknown): { readonly owner: string; readonly impl: unknown } { 55 | assertSlot(name); 56 | |
| upgrade-0-12 | skill | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | skill+mcp | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |

