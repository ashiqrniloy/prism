# Host-builder evaluation

Round 1, live run, natural loading, started 2026-11-07T21:49:36.980Z. Verdict: **no-claims**.

- Pre-registered criteria hash `4eb996e7a34feed8…`, locked at 2026-11-07T21:01:17.547Z.
- Trials per task: 3. Runtime revision `ab3606f33749`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## ollama-cloud (beam)

Decision: **no-claims** (no significant improvement; nothing to claim).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 0.857 | 0.000 | 0.857 | 0.857 | 20.3 | 0/21 | 0/21 | 1/21 | 8196753 (1168017) | 39927 | n/a | 502939 ms |
| skill | 0.857 | 0.000 | 0.857 | 0.857 | 19.9 | 17/21 | 0/21 | 0/21 | 8255464 (1127976) | 50253 | n/a | 170315 ms |
| skill+mcp | 0.857 | 0.048 | 0.857 | 0.857 | 22.2 | 14/21 | 14/21 | 3/21 | 9045246 (1174910) | 66998 | n/a | 510291 ms |

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
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.048 | [0.000, 0.143] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

**skill+mcp − skill**

| Scorer | Difference | 95% CI | q | Verdict |
| --- | --- | --- | --- | --- |
| typecheck_passes | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| acceptance_tests_pass | 0.048 | [0.000, 0.143] | 1.000 | not significant |
| public_surface_only | 0.000 | [0.000, 0.000] | 1.000 | not significant |
| no_retired_names | 0.000 | [0.000, 0.000] | 1.000 | not significant |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| approval-ask | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/approval-ask.test.ts: 40 | test("an approved edit runs and asks exactly once", async () => { 41 | const gate = createScriptedHostUi({ confirm: true, select:  |
| approval-ask | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/approval-ask.test.ts: 40 | test("an approved edit runs and asks exactly once", async () => { 41 | const gate = createScriptedHostUi({ confirm: true, select:  |
| approval-ask | skill+mcp | 3/3 | 1/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/approval-ask.test.ts: 40 | test("an approved edit runs and asks exactly once", async () => { 41 | const gate = createScriptedHostUi({ confirm: true, select:  |
| sqlite-resume | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| sqlite-resume | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| sqlite-resume | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/sqlite-resume.test.ts: 22 | await session.run("first question"); 23 | await session.run("second question"); 24 | const before = await session.messages(); 25  |
| acp-serve | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-RDaQKw/ |
| acp-serve | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-HDCCEs/ |
| acp-serve | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/acp.ts' from '/tmp/hbe-acp-serve-S95WSv/ |
| compaction-slot | none | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| compaction-slot | skill | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| compaction-slot | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | bun test v1.4.4 (38afee6c8) __acceptance__/compaction-slot.test.ts: 4 | 5 | test("memory-compaction owns the compaction slot and the local package still loads", async () => { 6 | const agent = await c |
| package-conformance | none | 3/3 | 0/3 | 3/3 | 3/3 | missing required file(s): src/no-force-push.ts, src/no-force-push.test.ts |
| package-conformance | skill | 3/3 | 0/3 | 3/3 | 3/3 | missing required file(s): src/no-force-push.ts, src/no-force-push.test.ts |
| package-conformance | skill+mcp | 3/3 | 0/3 | 3/3 | 3/3 | missing required file(s): src/no-force-push.ts, src/no-force-push.test.ts |
| upgrade-0-12 | none | 0/3 | 0/3 | 0/3 | 0/3 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |
| upgrade-0-12 | skill | 0/3 | 0/3 | 0/3 | 0/3 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |
| upgrade-0-12 | skill+mcp | 0/3 | 0/3 | 0/3 | 0/3 | src/host.ts(3,29): error TS2307: Cannot find module '@arnilo/prism-coding-tools' or its corresponding type declarations. |

