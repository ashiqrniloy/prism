# Host-builder evaluation

Round 1, live run, preload loading, started 2026-11-08T08:52:26.300Z. Verdict: **inconclusive**.

- Pre-registered criteria hash `4571c4884fac0b9f…`, locked at 2026-11-08T05:28:45.749Z.
- Trials per task: 3. Runtime revision `bc87e53904fb`. Skill `sha256:8f3436c586b5…`, indexes `sha256:20f8a95ecc05…`.

## ollama-cloud (gemma4:31b)

Decision: **inconclusive** (8 unscored record(s) from provider or harness failures; rerun).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.643 | 0.286 | 0.690 | 0.929 | 33.0 | 0/20 | 0/20 | 7/20 | 26847409 (1255953) | 72973 | n/a | 208574 ms |
| skill | 0.857 | 0.571 | 1.000 | 1.000 | 26.1 | 20/20 | 0/20 | 4/20 | 18412064 (958592) | 69235 | n/a | 205732 ms |
| skill+mcp | 0.857 | 0.667 | 0.952 | 0.905 | 27.3 | 21/21 | 21/21 | 2/21 | 12209283 (461379) | 62994 | n/a | 143455 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.214 | [-0.024, 0.429] | 0.333 | not significant |
| acceptance_tests_pass | 0.286 | [-0.000, 0.571] | 0.333 | not significant |
| public_surface_only | 0.310 | [0.071, 0.619] | 0.333 | not significant |
| no_retired_names | 0.071 | [0.000, 0.214] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.214 | [0.046, 0.405] | 0.333 | not significant |
| acceptance_tests_pass | 0.381 | [0.143, 0.667] | 0.250 | not significant |
| public_surface_only | 0.262 | [0.024, 0.571] | 0.333 | not significant |
| no_retired_names | -0.024 | [-0.071, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [-0.143, 0.143] | 1.000 | not significant |
| acceptance_tests_pass | 0.095 | [-0.238, 0.381] | 1.000 | not significant |
| public_surface_only | -0.048 | [-0.143, 0.000] | 1.000 | not significant |
| no_retired_names | -0.095 | [-0.286, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/3 | 0/3 | 1/3 | 3/3 | src/host.test.ts(2,38): error TS2307: Cannot find module 'vitest' or its corresponding type declarations. src/host.test.ts(4,10): error TS2305: Module '"node:os"' has no exported member 'os'. src/host |
| headless-host | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| headless-host | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| approval-ask | none | 2/3 | 1/3 | 3/3 | 3/3 | src/host.ts(19,7): error TS2353: Object literal may only specify known properties, and '"tool.call"' does not exist in type '(hooks: HookRegistrar) => void'. src/host.ts(19,21): error TS7006: Paramete |
| approval-ask | skill | 3/3 | 2/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/approval-ask.test.ts: 64 | 65 | function layerObject(name: string, label: string, value: unknown): JsonObject { 66 | if (value === undefined) return {}; 67 | |
| approval-ask | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| sqlite-resume | none | 3/3 | 2/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| sqlite-resume | skill | 2/2 | 2/2 | 2/2 | 2/2 | UNSCORED x1: run failed: The operation timed out. |
| sqlite-resume | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 298 | const kernel = parseVersion(options.kernelVersion); 299 | const versions = new Map(ordered.map((entry) => [entry.name, parseVersion( |
| acp-serve | skill | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | none | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill | 2/3 | 2/3 | 3/3 | 3/3 | src/host.test.ts(8,7): error TS2322: Type 'string' is not assignable to type 'ModelSpec'. src/host.test.ts(29,7): error TS2322: Type 'string' is not assignable to type 'ModelSpec'. |
| compaction-slot | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| package-conformance | none | 0/3 | 0/3 | 0/3 | 3/3 | src/no-force-push.ts(2,38): error TS2307: Cannot find module '@arnilo/prism/contracts' or its corresponding type declarations. |
| package-conformance | skill | 1/3 | 1/3 | 3/3 | 3/3 | src/no-force-push.ts(8,17): error TS2339: Property 'register' does not exist on type 'HookRegistrar'. src/no-force-push.ts(8,40): error TS7006: Parameter 'call' implicitly has an 'any' type. |
| package-conformance | skill+mcp | 0/3 | 1/3 | 3/3 | 3/3 | src/no-force-push.test.ts(36,29): error TS2339: Property 'history' does not exist on type 'Session'. src/no-force-push.test.ts(43,22): error TS7006: Parameter 'c' implicitly has an 'any' type. src/no- |
| upgrade-0-12 | none | 1/2 | 0/2 | 1/2 | 1/2 | UNSCORED x1: run failed: ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch() |
| upgrade-0-12 | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| upgrade-0-12 | skill+mcp | 3/3 | 1/3 | 2/3 | 1/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 54 | function pick(name: SlotName, assigned: unknown): { readonly owner: string; readonly impl: unknown } { 55 | assertSlot(name); 56 | |

