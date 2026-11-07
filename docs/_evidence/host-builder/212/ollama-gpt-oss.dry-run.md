# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T21:04:24.300Z. Verdict: **inconclusive**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 1. Runtime revision `d9785f968725`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (gpt-oss:120b)

Decision: **inconclusive** (comparison skill_vs_none failed: Missing scorer typecheck_passes on paired item acp-serve).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 0.000 | 1.000 | 1.000 | 19.0 | 0/2 | 0/2 | 0/2 | 2108794 (176842) | 15183 | n/a | 63765 ms |
| skill | 0.667 | 0.000 | 0.667 | 0.667 | 26.7 | 0/3 | 0/3 | 0/3 | 693709 (38637) | 9954 | n/a | 48361 ms |
| skill+mcp | 0.667 | 0.000 | 0.333 | 0.667 | 27.0 | 0/3 | 1/3 | 1/3 | 2340122 (125994) | 9474 | n/a | 57183 ms |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 14761558 | 1237894 | 106281 | n/a |
| skill | 21 | 4855963 | 270459 | 69678 | n/a |
| skill+mcp | 21 | 16380854 | 881958 | 66318 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill+mcp | 1/1 | 0/1 | 0/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: 36 | const result = await session.run("read the note and echo"); 37 | expect(result.status).toBe("completed"); 38 | const results = (l |
| acp-serve | none | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: Ollama Cloud stream error: Internal Server Error (ref: dd89e139-d9bb-4709-a840-2394b53c756e) |
| acp-serve | skill | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked } = a |
| acp-serve | skill+mcp | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-bW4lgv/ |
| upgrade-0-12 | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/upgrade-0-12.test.ts: 33 | expect(result.status).toBe("completed"); 34 | const text = JSON.stringify( 35 | (last?.messages ?? []).flatMap((message) => messag |
| upgrade-0-12 | skill | 0/1 | 0/1 | 0/1 | 0/1 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |
| upgrade-0-12 | skill+mcp | 0/1 | 0/1 | 0/1 | 0/1 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |

