# Host-builder evaluation

Round 1, live run, natural loading, started 2026-11-08T06:23:38.751Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4571c4884fac0b9f…`, locked at 2026-11-08T05:28:45.749Z.
- Trials per task: 3. Runtime revision `bc87e53904fb`. Skill `sha256:8f3436c586b5…`, indexes `sha256:20f8a95ecc05…`.

## ollama-cloud (gemma4:31b)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.667 | 0.238 | 0.810 | 0.857 | 33.8 | 0/21 | 0/21 | 9/21 | 25244084 (1130356) | 90630 | n/a | 352391 ms |
| skill | 0.667 | 0.667 | 0.905 | 1.000 | 23.4 | 21/21 | 0/21 | 4/21 | 19067033 (1055417) | 54815 | n/a | 677471 ms |
| skill+mcp | 0.762 | 0.619 | 0.905 | 0.952 | 28.8 | 21/21 | 21/21 | 2/21 | 13183054 (551566) | 60266 | n/a | 213566 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [-0.190, 0.190] | 1.000 | not significant |
| acceptance_tests_pass | 0.429 | [0.238, 0.667] | 0.125 | not significant |
| public_surface_only | 0.095 | [-0.095, 0.333] | 1.000 | not significant |
| no_retired_names | 0.143 | [0.000, 0.429] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.095 | [-0.095, 0.238] | 1.000 | not significant |
| acceptance_tests_pass | 0.381 | [0.190, 0.619] | 0.125 | not significant |
| public_surface_only | 0.095 | [-0.143, 0.333] | 1.000 | not significant |
| no_retired_names | 0.095 | [0.000, 0.286] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.095 | [-0.095, 0.333] | 1.000 | not significant |
| acceptance_tests_pass | -0.048 | [-0.333, 0.190] | 1.000 | not significant |
| public_surface_only | 0.000 | [-0.190, 0.190] | 1.000 | not significant |
| no_retired_names | -0.048 | [-0.143, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 2/3 | 0/3 | 2/3 | 3/3 | src/host.test.ts(2,28): error TS2307: Cannot find module './src/host' or its corresponding type declarations. src/host.test.ts(10,9): error TS7034: Variable 'providers' implicitly has type 'any[]' in  |
| headless-host | skill | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| headless-host | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| approval-ask | none | 1/3 | 1/3 | 2/3 | 3/3 | src/host.ts(19,7): error TS2353: Object literal may only specify known properties, and 'on' does not exist in type '(hooks: HookRegistrar) => void'. src/host.ts(19,12): error TS7006: Parameter 'hooks' |
| approval-ask | skill | 2/3 | 2/3 | 2/3 | 3/3 | src/host.ts(14,55): error TS2307: Cannot find module '@arnilo/prism-tools-coding/security/approval' or its corresponding type declarations. src/host.ts(18,23): error TS7031: Binding element 'action' i |
| approval-ask | skill+mcp | 2/3 | 2/3 | 3/3 | 3/3 | src/host.ts(19,29): error TS2345: Argument of type '(call: ToolCallHookPayload) => { result: { toolCallId: any; name: string; value: string; }; ask?: undefined; } | { result?: undefined; ask: string;  |
| sqlite-resume | none | 2/3 | 2/3 | 3/3 | 3/3 | src/persistence.test.ts(11,5): error TS2353: Object literal may only specify known properties, and 'version' does not exist in type 'ModelSpec'. src/persistence.test.ts(34,37): error TS2339: Property  |
| sqlite-resume | skill | 1/3 | 3/3 | 2/3 | 3/3 | src/host.test.ts(14,20): error TS2339: Property 'append' does not exist on type 'Session'. src/host.test.ts(21,36): error TS2339: Property 'list' does not exist on type 'Session'. src/host.test.ts(31, |
| sqlite-resume | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 2/3 | 2/3 | 3/3 | 3/3 | src/acp.ts(3,25): error TS2305: Module '"@arnilo/prism-acp"' has no exported member 'Stream'. |
| acp-serve | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | none | 3/3 | 2/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 60 | return match; 61 | } 62 | if (assigned !== undefined) return { owner: "host", impl: assigned }; 63 | if (list.length === 1) ret |
| compaction-slot | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill+mcp | 3/3 | 3/3 | 2/3 | 3/3 | test-host.ts: testing import outside a test: @arnilo/prism/testing |
| package-conformance | none | 0/3 | 0/3 | 1/3 | 3/3 | src/no-force-push.test.ts(19,34): error TS2322: Type 'Promise<{ value: string; }>' is not assignable to type 'Promise<ToolResult> | ToolResult'. src/no-force-push.test.ts(38,23): error TS2345: Argumen |
| package-conformance | skill | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.test.ts(31,32): error TS2322: Type 'Promise<{ text: string; }>' is not assignable to type 'Promise<ToolResult> | ToolResult'. src/no-force-push.test.ts(37,40): error TS2339: Property |
| package-conformance | skill+mcp | 0/3 | 1/3 | 3/3 | 3/3 | src/no-force-push.test.ts(13,7): error TS2353: Object literal may only specify known properties, and 'testCalls' does not exist in type 'PackageConformanceOptions'. src/no-force-push.test.ts(36,7): er |
| upgrade-0-12 | none | 3/3 | 0/3 | 3/3 | 0/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 5 | 6 | /** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */ 7 | export class Mod |
| upgrade-0-12 | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| upgrade-0-12 | skill+mcp | 2/3 | 1/3 | 2/3 | 2/3 | src/host.ts(21,7): error TS2322: Type 'unknown' is not assignable to type 'PackageInput'. src/host.ts(22,7): error TS2322: Type 'unknown' is not assignable to type 'PackageInput'. src/host.ts(23,7): e |

