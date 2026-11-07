# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T10:46:51.968Z. Verdict: **no-claims**.

- Pre-registered criteria hash `ee29e22e5b5fc0b6…`, locked at 2026-11-07T09:29:57.121Z.
- Trials per task: 1. Runtime revision `20119d6ba680`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## openrouter (nvidia/nemotron-3-ultra-550b-a55b:free)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 0.000 | 0.333 | 1.000 | 44.3 | 0/3 | 0/3 | 1/3 | 4834111 (480799) | 13506 | n/a | 177134 ms |
| skill | 1.000 | 0.000 | 0.333 | 1.000 | 45.0 | 0/3 | 0/3 | 0/3 | 4527692 (551404) | 16588 | 0.0000 USD | 173262 ms |
| skill+mcp | 0.667 | 0.333 | 0.333 | 1.000 | 36.3 | 0/3 | 2/3 | 1/3 | 3619935 (428383) | 17153 | n/a | 148703 ms |

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
| typecheck_passes | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | -0.333 | [-1.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.333 | [0.000, 1.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 33838777 | 3365593 | 94542 | n/a |
| skill | 21 | 31693844 | 3859828 | 116116 | 0 |
| skill+mcp | 21 | 25339545 | 2998681 | 120071 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| headless-host | skill | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| headless-host | skill+mcp | 0/1 | 0/1 | 0/1 | 1/1 | src/host.ts(52,13): error TS2304: Cannot find name 'assertTrusted'. |
| acp-serve | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill+mcp | 1/1 | 1/1 | 1/1 | 1/1 |  |
| upgrade-0-12 | none | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |
| upgrade-0-12 | skill | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |
| upgrade-0-12 | skill+mcp | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |

