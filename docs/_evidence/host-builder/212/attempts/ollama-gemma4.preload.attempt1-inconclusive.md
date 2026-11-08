# Host-builder evaluation

Round 1, live run, preload loading, started 2026-11-08T06:23:38.751Z. Verdict: **inconclusive**.

- Pre-registered criteria hash `4571c4884fac0b9f…`, locked at 2026-11-08T05:28:45.749Z.
- Trials per task: 3. Runtime revision `bc87e53904fb`. Skill `sha256:8f3436c586b5…`, indexes `sha256:20f8a95ecc05…`.

## ollama-cloud (gemma4:31b)

Decision: **inconclusive** (8 unscored record(s) from provider or harness failures; rerun).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.810 | 0.238 | 0.857 | 0.857 | 32.4 | 0/20 | 0/20 | 7/20 | 25474754 (1145250) | 61604 | n/a | 346183 ms |
| skill | 0.786 | 0.595 | 1.000 | 1.000 | 25.1 | 20/20 | 0/20 | 4/20 | 19536719 (1218095) | 63344 | n/a | 736353 ms |
| skill+mcp | 0.762 | 0.571 | 0.905 | 0.857 | 29.5 | 21/21 | 21/21 | 5/21 | 11814670 (377678) | 58500 | n/a | 161604 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | -0.024 | [-0.071, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.357 | [0.095, 0.667] | 0.500 | not significant |
| public_surface_only | 0.143 | [0.000, 0.429] | 1.000 | not significant |
| no_retired_names | 0.143 | [0.000, 0.429] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | -0.048 | [-0.190, 0.095] | 1.000 | not significant |
| acceptance_tests_pass | 0.333 | [0.000, 0.667] | 0.750 | not significant |
| public_surface_only | 0.048 | [-0.190, 0.381] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | -0.024 | [-0.190, 0.167] | 1.000 | not significant |
| acceptance_tests_pass | -0.024 | [-0.429, 0.286] | 1.000 | not significant |
| public_surface_only | -0.095 | [-0.238, 0.000] | 1.000 | not significant |
| no_retired_names | -0.143 | [-0.429, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 3/3 | 0/3 | 0/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 35 | const session = await agent.session(); 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status |
| headless-host | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| headless-host | skill+mcp | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| approval-ask | none | 2/3 | 1/3 | 3/3 | 3/3 | src/host.ts(23,9): error TS2353: Object literal may only specify known properties, and 'beforeExecute' does not exist in type 'ToolsCodingConfig'. src/host.ts(23,31): error TS7006: Parameter 'call' im |
| approval-ask | skill | 1/2 | 1/2 | 2/2 | 2/2 | UNSCORED x1: run failed: The operation timed out. |
| approval-ask | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| sqlite-resume | none | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| sqlite-resume | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| sqlite-resume | skill+mcp | 2/3 | 3/3 | 3/3 | 3/3 | src/verify-sqlite.ts(41,28): error TS2339: Property 'history' does not exist on type 'Session'. src/verify-sqlite.ts(64,34): error TS2339: Property 'history' does not exist on type 'Session'. |
| acp-serve | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 3/3 | 2/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: (fail) an ACP client approves an edit through session/request_permission [60004.09ms] ^ this test timed out after 60000ms. (fail) an ACP c |
| acp-serve | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | none | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill+mcp | 3/3 | 2/3 | 2/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 54 | function pick(name: SlotName, assigned: unknown): { readonly owner: string; readonly impl: unknown } { 55 | assertSlot(name); 5 |
| package-conformance | none | 0/2 | 0/2 | 2/2 | 2/2 | UNSCORED x1: run failed: The operation timed out. |
| package-conformance | skill | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.test.ts(22,13): error TS2820: Type '"tool-call"' is not assignable to type '"content_delta" | "continuation_required" | "done" | "error" | "message_start" | "tool_call" | "tool_call_ |
| package-conformance | skill+mcp | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.test.ts(35,14): error TS2322: Type 'ToolCallContent' is not assignable to type 'ProviderEvent'. src/no-force-push.test.ts(82,14): error TS2322: Type 'ToolCallContent' is not assignab |
| upgrade-0-12 | none | 3/3 | 0/3 | 3/3 | 0/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 5 | 6 | /** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */ 7 | export class Mod |
| upgrade-0-12 | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| upgrade-0-12 | skill+mcp | 2/3 | 0/3 | 2/3 | 0/3 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |

