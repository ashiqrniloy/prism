# Host-builder evaluation

Round 1, dryRun run, natural loading, started 2026-11-07T10:00:56.773Z. Verdict: **inconclusive**.

- Pre-registered criteria hash `ee29e22e5b5fc0b6…`, locked at 2026-11-07T09:29:57.121Z.
- Trials per task: 1. Runtime revision `20119d6ba680`. Skill `sha256:d6f77d7615fb…`, indexes `sha256:986940dc89d1…`.

## kilo (nvidia/nemotron-3.5-super-vl:free)

Decision: **inconclusive** (comparison skill_vs_none failed: Missing scorer typecheck_passes on paired item acp-serve).

| Arm | typecheck_passes | acceptance_tests_pass | public_surface_only | no_retired_names | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 1.000 | 0.000 | 1.000 | 1.000 | 66.5 | 0/2 | 0/2 | 1/2 | 3467157 (510005) | 70729 | n/a | 333004 ms |
| skill | n/a | n/a | n/a | n/a | n/a | 0/0 | 0/0 | 0/0 | 1054112 (195584) | 7683 | n/a | 40813 ms |
| skill+mcp | n/a | n/a | n/a | n/a | n/a | 0/0 | 0/0 | 0/0 | 1525660 (302908) | 9286 | n/a | 203431 ms |

Full-run estimate (tasks x trials x arm, scaled from this dry run):

| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |
| --- | --- | --- | --- | --- | --- |
| none | 21 | 24270099 | 3570035 | 495103 | n/a |
| skill | 21 | 7378784 | 1369088 | 53781 | n/a |
| skill+mcp | 21 | 10679620 | 2120356 | 65002 | n/a |

| Task | Arm | typecheck | acceptance | surface | retired | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| headless-host | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/headless-host.test.ts: # Unhandled error between tests ------------------------------- error: Cannot find module '../src/host.ts' from '/tmp/hbe-headless-hos |
| headless-host | skill | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: ENOTDIR: not a directory, stat '/tmp/hbe-headless-host-Rc5zfo/node_modules/@arnilo/prism/src/agent-session/runtime-registry.ts/AGENTS.md' |
| headless-host | skill+mcp | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded","message":"Free model usage |
| acp-serve | none | 1/1 | 0/1 | 1/1 | 1/1 | bun test v1.4.4 (38afee6c8) __acceptance__/acp-serve.test.ts: 53 | 54 | test("an ACP client approves an edit through session/request_permission", async () => { 55 | const { initialized, prompt, asked  |
| acp-serve | skill | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: ENOTDIR: not a directory, stat '/tmp/hbe-acp-serve-lTxs81/node_modules/@arnilo/prism/src/contracts-core/agent.ts/AGENTS.md' |
| acp-serve | skill+mcp | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded","message":"Free model usage |
| upgrade-0-12 | none | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: ENOTDIR: not a directory, stat '/tmp/hbe-upgrade-0-12-k0V3yk/node_modules/@arnilo/prism/src/contracts.ts/AGENTS.md' |
| upgrade-0-12 | skill | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: ENOTDIR: not a directory, stat '/tmp/hbe-upgrade-0-12-Q4XLBu/node_modules/@arnilo/prism/src/index.ts/AGENTS.md' |
| upgrade-0-12 | skill+mcp | 0/0 | 0/0 | 0/0 | 0/0 | UNSCORED x1: run failed: Kilo request failed: 429 Kilo's free models are limited to 200 requests per hour. {"error":"Rate limit exceeded","error_type":"rate_limit_exceeded","message":"Free model usage |

