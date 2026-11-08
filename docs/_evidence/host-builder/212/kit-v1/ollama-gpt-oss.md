# Host-builder evaluation

Round 1, live run, natural loading, started 2026-11-07T21:49:36.980Z. Verdict: **inconclusive**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 3. Runtime revision `ab3606f33749`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (gpt-oss:120b)

Decision: **inconclusive** (48 unscored record(s) from provider or harness failures; rerun).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.786 | 0.190 | 0.857 | 0.857 | 42.1 | 0/16 | 0/16 | 6/16 | 17686018 (921346) | 128943 | n/a | 280448 ms |
| skill | 0.548 | 0.143 | 0.857 | 0.857 | 39.9 | 0/14 | 0/14 | 8/14 | 18833384 (1002904) | 115219 | n/a | 222476 ms |
| skill+mcp | 0.905 | 0.333 | 0.905 | 0.857 | 37.4 | 0/21 | 9/21 | 8/21 | 22770223 (997887) | 159300 | n/a | 265894 ms |

**skill − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | -0.238 | [-0.405, -0.095] | 0.500 | not significant |
| acceptance_tests_pass | -0.048 | [-0.405, 0.238] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − none**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.119 | [-0.095, 0.381] | 1.000 | not significant |
| acceptance_tests_pass | 0.143 | [0.000, 0.429] | 1.000 | not significant |
| public_surface_only | 0.048 | [-0.143, 0.286] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.357 | [0.095, 0.643] | 0.500 | not significant |
| acceptance_tests_pass | 0.190 | [-0.048, 0.500] | 1.000 | not significant |
| public_surface_only | 0.048 | [-0.143, 0.286] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 2/2 | 0/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud request failed: 500 {"error":"Internal Server Error (ref: 3519d56b-8eae-49c3-bc76-2b7e54fac726)"}  |
| headless-host | skill | 2/2 | 0/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud request failed: 500 {"error":"Internal Server Error (ref: b23bcad8-f04b-4eed-a665-20dcd29ef437)"}  |
| headless-host | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| approval-ask | none | 2/2 | 0/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud request failed: 500 {"error":"Internal Server Error (ref: 67cc61b3-c3bb-491e-aa52-b644bbf98329)"}  |
| approval-ask | skill | 1/2 | 1/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud stream error: Internal Server Error (ref: 371f78f0-ea87-4cd3-8dfd-f56490cb2f01) |
| approval-ask | skill+mcp | 3/3 | 3/3 | 3/3 | 3/3 |  |
| sqlite-resume | none | 1/2 | 2/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud request failed: 500 {"error":"Internal Server Error (ref: 5849fffc-ecf0-4dec-9e59-eff5df8a518e)"}  |
| sqlite-resume | skill | 0/1 | 0/1 | 1/1 | 1/1 | UNSCORED x2: run failed: Ollama Cloud stream error: Internal Server Error (ref: c0c6c46a-04cd-4045-a038-4ee7e4f4dc46) |
| sqlite-resume | skill+mcp | 3/3 | 3/3 | 2/3 | 3/3 | testHost.ts: testing import outside a test: @arnilo/prism/testing |
| acp-serve | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 2/3 | 0/3 | 3/3 | 3/3 | src/acp.ts(21,11): error TS2304: Cannot find name 'acpHost'. src/acp.ts(26,18): error TS2304: Cannot find name 'serveAcp'. |
| acp-serve | skill+mcp | 2/3 | 0/3 | 3/3 | 3/3 | src/acp.ts(9,10): error TS2304: Cannot find name 'ModelSpec'. src/acp.ts(10,23): error TS2304: Cannot find name 'PackageInput'. src/acp.ts(13,22): error TS2304: Cannot find name 'Agent'. src/acp.ts(16 |
| compaction-slot | none | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| compaction-slot | skill | 2/2 | 1/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud stream error: Internal Server Error (ref: 4da76331-b02d-4824-9a6f-ee1a72cebc40) |
| compaction-slot | skill+mcp | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| package-conformance | none | 2/2 | 0/2 | 2/2 | 2/2 | UNSCORED x1: run failed: Ollama Cloud stream error: Internal Server Error (ref: 726be9fc-fae6-4981-99a6-d5fee7e34754) |
| package-conformance | skill | 2/3 | 0/3 | 3/3 | 3/3 | src/no-force-push.test.ts(24,13): error TS2339: Property 'result' does not exist on type 'ToolResult'. src/no-force-push.test.ts(24,21): error TS2339: Property 'events' does not exist on type 'ToolRes |
| package-conformance | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | missing required file(s): src/no-force-push.ts, src/no-force-push.test.ts |
| upgrade-0-12 | none | 0/2 | 0/2 | 0/2 | 0/2 | UNSCORED x1: run failed: Ollama Cloud request failed: 500 {"error":"Internal Server Error (ref: ae1bf19d-9f22-46be-a333-23d368923f55)"}  |
| upgrade-0-12 | skill | 0/1 | 0/1 | 0/1 | 0/1 | UNSCORED x2: run failed: Ollama Cloud stream error: Internal Server Error (ref: 5352cfb1-c62e-48dc-94cf-ee83f6d14bfc) |
| upgrade-0-12 | skill+mcp | 2/3 | 0/3 | 2/3 | 0/3 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |

