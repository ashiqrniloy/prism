# Host-builder evaluation

Round 1, live run, natural loading, started 2026-11-07T21:49:36.977Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 3. Runtime revision `ab3606f33749`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (gemma4:31b)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.667 | 0.190 | 0.857 | 0.857 | 30.3 | 0/21 | 0/21 | 9/21 | 24628833 (1307105) | 59726 | n/a | 333763 ms |
| skill | 0.762 | 0.571 | 0.762 | 1.000 | 25.7 | 21/21 | 0/21 | 4/21 | 16899950 (837486) | 61059 | n/a | 200666 ms |
| skill+mcp | 0.857 | 0.524 | 0.810 | 1.000 | 23.6 | 21/21 | 20/21 | 4/21 | 12401699 (573475) | 48549 | n/a | 142655 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.095 | [-0.238, 0.381] | 1.000 | not significant |
| acceptance_tests_pass | 0.381 | [0.048, 0.762] | 0.750 | not significant |
| public_surface_only | -0.095 | [-0.286, 0.095] | 1.000 | not significant |
| no_retired_names | 0.143 | [0.000, 0.429] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.190 | [-0.049, 0.429] | 0.750 | not significant |
| acceptance_tests_pass | 0.333 | [-0.048, 0.714] | 0.750 | not significant |
| public_surface_only | -0.048 | [-0.381, 0.238] | 1.000 | not significant |
| no_retired_names | 0.143 | [0.000, 0.429] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.095 | [0.000, 0.192] | 1.000 | not significant |
| acceptance_tests_pass | -0.048 | [-0.143, 0.000] | 1.000 | not significant |
| public_surface_only | 0.048 | [-0.143, 0.238] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/3 | 0/3 | 2/3 | 3/3 | src/host.ts(26,31): error TS2304: Cannot find name 'discoverContributions'. src/host.ts(40,14): error TS2304: Cannot find name 'createMemorySessionStore'. src/host.ts(54,14): error TS7006: Parameter ' |
| headless-host | skill | 3/3 | 0/3 | 2/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| headless-host | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| approval-ask | none | 1/3 | 0/3 | 2/3 | 3/3 | src/host.ts(3,30): error TS2307: Cannot find module '@arnilo/prism/src/hooks/ask' or its corresponding type declarations. src/host.ts(19,5): error TS2322: Type 'any[]' is not assignable to type '(hook |
| approval-ask | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| approval-ask | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| sqlite-resume | none | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| sqlite-resume | skill | 2/3 | 3/3 | 2/3 | 3/3 | src/persistence.test.ts(10,39): error TS2353: Object literal may only specify known properties, and 'text' does not exist in type 'ProviderEvent'. src/persistence.test.ts(10,69): error TS2551: Propert |
| sqlite-resume | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | none | 2/3 | 0/3 | 3/3 | 3/3 | src/acp.ts(3,25): error TS2305: Module '"@arnilo/prism-acp"' has no exported member 'Stream'. src/acp.ts(23,27): error TS2740: Type 'Promise<Agent>' is missing the following properties from type 'Agen |
| acp-serve | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | none | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill | 2/3 | 2/3 | 2/3 | 3/3 | src/host.ts(16,7): error TS2322: Type 'PackageInstance' is not assignable to type 'string | Compactor | undefined'. src/verify-host.ts(8,7): error TS2322: Type 'string' is not assignable to type 'Mode |
| compaction-slot | skill+mcp | 3/3 | 2/3 | 1/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| package-conformance | none | 1/3 | 0/3 | 2/3 | 3/3 | src/no-force-push.test.ts(18,40): error TS2322: Type '{ name: string; parameters: { type: string; properties: { command: { type: string; }; }; required: string[]; }; execute: (args: any) => { value: s |
| package-conformance | skill | 0/3 | 0/3 | 2/3 | 3/3 | src/no-force-push.ts(10,30): error TS2339: Property 'arguments' does not exist on type 'ToolCallHookPayload'. |
| package-conformance | skill+mcp | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.ts(10,30): error TS2339: Property 'arguments' does not exist on type 'ToolCallHookPayload'. |
| upgrade-0-12 | none | 3/3 | 0/3 | 3/3 | 0/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 5 | 6 | /** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */ 7 | export class Mod |
| upgrade-0-12 | skill | 3/3 | 1/3 | 2/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |
| upgrade-0-12 | skill+mcp | 3/3 | 0/3 | 1/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 33 | expect(result.status).toBe("completed"); 34 | const text = JSON.stringify( 35 | (last?.messages ?? []).flatMap((message) => messag |

