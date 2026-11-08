# Host-builder evaluation

Round 1, live run, preload loading, started 2026-11-07T23:10:30.580Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 3. Runtime revision `ab3606f33749`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (gemma4:31b)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.667 | 0.429 | 0.857 | 0.857 | 33.9 | 0/21 | 0/21 | 8/21 | 28604693 (1194293) | 74124 | n/a | 226377 ms |
| skill | 0.714 | 0.524 | 0.857 | 0.952 | 27.6 | 21/21 | 0/21 | 5/21 | 20855985 (991729) | 59434 | n/a | 208688 ms |
| skill+mcp | 0.762 | 0.429 | 0.857 | 0.952 | 23.3 | 21/21 | 19/21 | 2/21 | 12096611 (592803) | 53954 | n/a | 147404 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.048 | [-0.286, 0.333] | 1.000 | not significant |
| acceptance_tests_pass | 0.095 | [-0.095, 0.333] | 1.000 | not significant |
| public_surface_only | 0.000 | [-0.190, 0.190] | 1.000 | not significant |
| no_retired_names | 0.095 | [0.000, 0.286] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.095 | [-0.190, 0.381] | 1.000 | not significant |
| acceptance_tests_pass | 0.000 | [-0.286, 0.286] | 1.000 | not significant |
| public_surface_only | 0.000 | [-0.190, 0.190] | 1.000 | not significant |
| no_retired_names | 0.095 | [0.000, 0.286] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.048 | [-0.095, 0.190] | 1.000 | not significant |
| acceptance_tests_pass | -0.095 | [-0.286, 0.000] | 1.000 | not significant |
| public_surface_only | 0.000 | [-0.143, 0.143] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/3 | 0/3 | 2/3 | 3/3 | src/host.ts(37,17): error TS18048: 'c.declaration' is possibly 'undefined'. src/host.ts(45,7): error TS2322: Type '(Skill | undefined)[]' is not assignable to type 'readonly Skill[]'. |
| headless-host | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 29 | { onRequest: (request: never) => void (last = request) }, 30 | ), 31 | ], 32 | }); 33 | try { 34 | expect(agent.skills.some((skil |
| headless-host | skill+mcp | 3/3 | 0/3 | 2/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| approval-ask | none | 2/3 | 2/3 | 3/3 | 3/3 | src/host.ts(23,43): error TS2339: Property 'ask' does not exist on type 'HostUi'. |
| approval-ask | skill | 3/3 | 2/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/approval-ask.test.ts: 298 | const kernel = parseVersion(options.kernelVersion); 299 | const versions = new Map(ordered.map((entry) => [entry.name, parseVersi |
| approval-ask | skill+mcp | 2/3 | 2/3 | 3/3 | 3/3 | src/host.ts(18,32): error TS1127: Invalid character. src/host.ts(18,58): error TS1002: Unterminated string literal. src/host.ts(19,7): error TS1005: ',' expected. src/host.ts(19,15): error TS1005: ',' |
| sqlite-resume | none | 1/3 | 2/3 | 2/3 | 3/3 | src/test-sessions.ts(7,5): error TS2322: Type 'string' is not assignable to type 'ModelSpec'. src/test-sessions.ts(14,5): error TS2353: Object literal may only specify known properties, and 'input' do |
| sqlite-resume | skill | 2/3 | 3/3 | 2/3 | 3/3 | src/persistence.test.ts(11,41): error TS2353: Object literal may only specify known properties, and 'text' does not exist in type 'ProviderEvent'. src/persistence.test.ts(11,71): error TS2551: Propert |
| sqlite-resume | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | none | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-NXvxI0/ |
| acp-serve | skill | 3/3 | 3/3 | 3/3 | 3/3 |  |
| acp-serve | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | none | 3/3 | 3/3 | 3/3 | 3/3 |  |
| compaction-slot | skill | 1/3 | 3/3 | 2/3 | 3/3 | src/verify.ts(6,5): error TS2322: Type 'string' is not assignable to type 'ModelSpec'. src/verify.ts(8,7): error TS2322: Type 'ModelProvider' is not assignable to type 'PackageInput'. src/verify.ts(9, |
| compaction-slot | skill+mcp | 2/3 | 1/3 | 2/3 | 3/3 | src/verify-host.ts(5,22): error TS2345: Argument of type 'string' is not assignable to parameter of type 'readonly ProviderEvent[]'. src/verify-host.ts(8,5): error TS2322: Type 'string' is not assigna |
| package-conformance | none | 1/3 | 1/3 | 2/3 | 3/3 | src/no-force-push.test.ts(22,7): error TS2322: Type '{ name: string; parameters: { type: string; properties: { command: { type: string; }; }; required: string[]; }; execute: (args: any) => Promise<{ r |
| package-conformance | skill | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.ts(8,17): error TS2339: Property 'register' does not exist on type 'HookRegistrar'. src/no-force-push.ts(8,40): error TS7006: Parameter 'call' implicitly has an 'any' type. |
| package-conformance | skill+mcp | 0/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.test.ts(18,7): error TS2353: Object literal may only specify known properties, and 'providers' does not exist in type 'AgentConfig'. src/no-force-push.test.ts(45,9): error TS2353: Ob |
| upgrade-0-12 | none | 3/3 | 0/3 | 3/3 | 0/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 5 | 6 | /** A `ModelRef` that cannot name a provider and a model. The message never carries a credential value. */ 7 | export class Mod |
| upgrade-0-12 | skill | 3/3 | 0/3 | 2/3 | 2/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 33 | expect(result.status).toBe("completed"); 34 | const text = JSON.stringify( 35 | (last?.messages ?? []).flatMap((message) => messag |
| upgrade-0-12 | skill+mcp | 3/3 | 0/3 | 2/3 | 2/3 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 254 | // 1. Resolve inputs. 255 | const normalized = options.inputs.map((input) => normalizePackageInput(input)); 256 | const seen = ne |

