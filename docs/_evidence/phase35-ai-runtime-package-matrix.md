# Phase 35 — AI runtime package coverage and multi-agent baselines

Network-free audit of every first-party manifest (root + 60 workspaces = 61). Mock providers and in-process stores only; no credentials, live endpoints, prompt bodies, or secrets.

**Class:** `hot-path` (on every model call) · `optional-in-run` (selected into a run) · `persistence-coordination` (durable/state seams) · `setup-only` (umbrellas / DX, not on the call path).

**Path:** `model-call` · `prompt-assembly` · `tool-execution` · `coordination` · `storage` · `telemetry` · `setup-only`.

**Effects** (latency / concurrency / memory / I/O / artifact): `none` · `low` · `medium` · `high`.

## Manifest inventory (61)

| Manifest | Workspace | Class | Path | Latency | Concurrency | Memory | I/O | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| @arnilo/prism | `.` | hot-path | model-call | high | high | medium | low | high |
| @arnilo/prism-acp-agent | `packages/acp-agent` | optional-in-run | coordination | medium | medium | medium | low | low |
| @arnilo/prism-ag-ui | `packages/ag-ui` | optional-in-run | telemetry | low | medium | medium | low | medium |
| @arnilo/prism-antigravity-agent | `packages/antigravity-agent` | optional-in-run | model-call | high | medium | medium | medium | low |
| @arnilo/prism-browser | `packages/browser` | optional-in-run | tool-execution | high | low | high | high | low |
| @arnilo/prism-obscura | `packages/obscura` | optional-in-run | tool-execution | medium | low | medium | medium | low |
| @arnilo/prism-coding-agent | `packages/coding-agent` | optional-in-run | tool-execution | medium | medium | high | high | medium |
| @arnilo/prism-coding-security | `packages/coding-security` | optional-in-run | tool-execution | low | low | medium | medium | low |
| @arnilo/prism-compaction-llm | `packages/compaction-llm` | optional-in-run | prompt-assembly | high | low | medium | low | low |
| @arnilo/prism-compaction-observational-memory | `packages/compaction-observational-memory` | optional-in-run | prompt-assembly | medium | low | high | low | low |
| @arnilo/prism-computer-use-linux | `packages/computer-use-linux` | optional-in-run | tool-execution | medium | low | medium | medium | low |
| @arnilo/prism-credentials-node | `packages/credentials-node` | persistence-coordination | storage | low | low | low | medium | low |
| @arnilo/prism-document-reader | `packages/document-reader` | optional-in-run | tool-execution | medium | low | high | medium | low |
| @arnilo/prism-enterprise-postgres | `packages/enterprise-postgres` | persistence-coordination | storage | medium | high | medium | high | low |
| @arnilo/prism-evals | `packages/evals` | optional-in-run | model-call | high | medium | medium | low | low |
| @arnilo/prism-mcp | `packages/mcp` | optional-in-run | tool-execution | medium | medium | medium | medium | low |
| @arnilo/prism-memory | `packages/memory` | optional-in-run | prompt-assembly | medium | low | high | medium | low |
| @arnilo/prism-model-router | `packages/model-router` | optional-in-run | model-call | medium | high | low | low | low |
| @arnilo/prism-observability-opentelemetry | `packages/observability-opentelemetry` | optional-in-run | telemetry | low | low | low | medium | low |
| @arnilo/prism-policy | `packages/policy` | persistence-coordination | coordination | low | medium | medium | medium | low |
| @arnilo/prism-all | `packages/prism-all` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-base | `packages/prism-base` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-caveman | `packages/prism-caveman` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-code | `packages/prism-code` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-compaction | `packages/prism-compaction` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-dev | `packages/prism-dev` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-graft | `packages/prism-graft` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-impeccable | `packages/prism-impeccable` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-openapi-tools | `packages/prism-openapi-tools` | optional-in-run | tool-execution | medium | low | low | medium | low |
| @arnilo/prism-ponytail | `packages/prism-ponytail` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-providers | `packages/prism-providers` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-sdk | `packages/prism-sdk` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-wiki | `packages/prism-wiki` | setup-only | setup-only | none | none | none | none | medium |
| @arnilo/prism-provider-ai-sdk | `packages/provider-ai-sdk` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-alibaba | `packages/provider-alibaba` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-anthropic | `packages/provider-anthropic` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-azure | `packages/provider-azure` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-bedrock | `packages/provider-bedrock` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-clinepass | `packages/provider-clinepass` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-deepseek | `packages/provider-deepseek` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-google | `packages/provider-google` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-kimi | `packages/provider-kimi` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-neuralwatt | `packages/provider-neuralwatt` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-ollama | `packages/provider-ollama` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-openai | `packages/provider-openai` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-opencode-go | `packages/provider-opencode-go` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-openrouter | `packages/provider-openrouter` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-vertex | `packages/provider-vertex` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-xai | `packages/provider-xai` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-provider-zai | `packages/provider-zai` | optional-in-run | model-call | high | medium | low | high | low |
| @arnilo/prism-rag | `packages/rag` | optional-in-run | prompt-assembly | medium | low | high | medium | low |
| @arnilo/prism-server | `packages/server` | optional-in-run | coordination | medium | high | medium | medium | low |
| @arnilo/prism-session-store-codecs | `packages/session-store-codecs` | persistence-coordination | storage | low | low | low | none | low |
| @arnilo/prism-session-store-nats | `packages/session-store-nats` | persistence-coordination | storage | medium | high | medium | high | low |
| @arnilo/prism-session-store-postgres | `packages/session-store-postgres` | persistence-coordination | storage | medium | high | medium | high | low |
| @arnilo/prism-session-store-sqlite | `packages/session-store-sqlite` | persistence-coordination | storage | medium | medium | medium | high | low |
| @arnilo/prism-supervisor | `packages/supervisor` | optional-in-run | coordination | medium | high | medium | none | low |
| @arnilo/prism-tool-validator-json-schema | `packages/tool-validator-json-schema` | optional-in-run | tool-execution | low | low | low | none | low |
| @arnilo/prism-web-tools | `packages/web-tools` | optional-in-run | tool-execution | high | low | low | high | low |
| @arnilo/prism-work-tools | `packages/work-tools` | optional-in-run | tool-execution | high | low | low | high | low |
| @arnilo/prism-workflows | `packages/workflows` | optional-in-run | coordination | medium | high | medium | low | low |

Counts: 1 hot-path, 40 optional-in-run, 7 persistence-coordination, 11 setup-only.

## Multi-agent baseline

Command:

```bash
node scripts/benchmark.mjs --scenario multi-agent-runtime
```

Fixture (also `scripts/budgets.json#multiAgentRuntime`): 5 warmups, 20 measured ops, 8 ms mock provider/tool delay, session waves 1/4/16/32, supervisor `maxActiveChildren=4`, workflow `maxConcurrency=2` with 4 independent agent nodes, tool `toolConcurrency=4` over 8 calls, abort storm n=32. Network-free; in-process memory stores.

Recorded 2026-08-27, Node v24.19.0, Linux x64 (AMD Ryzen 9 PRO 7940HS). Ceilings in `scripts/budgets.json` are sanity bounds, not portable SLOs.

| Scenario | ops | p50 ms | p95 ms | ops/s | heap Δ | queued | dropped | peak provider | completions | abort ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| independentSessions-1 | 20 | 8.596 | 8.975 | 116.06 | 652776 | 9 | 0 | 1 | 20 | — |
| independentSessions-4 | 20 | 8.877 | 9.138 | 112.43 | 663096 | 36 | 0 | 4 | 80 | — |
| independentSessions-16 | 20 | 9.539 | 10.396 | 103.88 | 1946816 | 144 | 0 | 16 | 320 | — |
| independentSessions-32 | 20 | 9.630 | 10.145 | 103.05 | 2020992 | 288 | 0 | 32 | 640 | — |
| supervisorFanOut | 20 | 8.824 | 9.356 | 112.30 | 297792 | 8 | 0 | 4 | 80 | — |
| supervisorSaturation | 20 | 8.876 | 9.033 | 112.98 | 0 | 0 | 0 | 4 | 80 | — |
| workflowAgentNodes | 20 | 17.590 | 17.913 | 56.72 | 362168 | 10 | 0 | 2 | 80 | — |
| toolConcurrency | 20 | 17.182 | 17.392 | 58.14 | 276128 | 0 | 0 | 4 | 20 | — |
| abortStorm | 20 | 3.457 | 4.410 | 278.43 | 1767936 | 0 | 0 | 32 | 0 | 5.478 |

## Invariants

- 32 independent sessions complete; peak provider calls = 32; no shared-state rejection; active count returns to 0.
- Supervisor fan-out of 4 stays at `maxActiveChildren`; 32 attempted with cap 4 yields 4 successes and 28 `SupervisorLimitError`; `activeAfter` 0.
- Four parallel workflow agent nodes under concurrency 2 emit 4 `node_started` / 4 `node_finished` and 4 outputs; peak provider calls = 2.
- Fan-out maps 8×20 ms items at concurrency 2 with ≥1.75× vs sequential and peak workers ≤ 2; output stays input-ordered.
- Abort storm: all 32 runs settle within 1 s and active provider/tool counts return to 0.

## Verification (Task 6, 2026-08-28)

Network-free gates: `typecheck`, `lint`, `format:check`, `npm test`, `test:coverage`, `pack:dry-run`, `security:threat-suites` pass. Memory-store router reservations at 16 and 32 workers admit exactly 3 of 26-token/100-cap slots (no oversubscription). Three repeats of `multi-agent-runtime` (same 5+20 fixture); median p95 vs frozen ceilings:

| Scenario | 3-run median p50 | 3-run median p95 | Ceiling |
| --- | ---: | ---: | ---: |
| independentSessions-1 | 8.784 | 9.933 | 250 |
| independentSessions-4 | 9.178 | 9.850 | 250 |
| independentSessions-16 | 9.963 | 10.616 | 500 |
| independentSessions-32 | 11.211 | 11.994 | 1000 |
| supervisorFanOut | 9.104 | 10.355 | 500 |
| supervisorSaturation | 9.738 | 10.286 | 500 |
| workflowFanOut | 82.851 | 84.495 | 500 |
| workflowAgentNodes | 18.513 | 19.738 | 500 |
| toolConcurrency | 17.895 | 19.055 | 500 |
| abortStorm | 1.592 | 3.258 | 2000 |

`workflowFanOut` 3-run speedup 1.87×, peak workers 2. Some 8 ms-fixture rows sit >10% above the Task 1 single-run recorded p95 (1–2 ms scheduler noise); all remain well under ceilings. Ceilings not raised.

Protected skip: `PRISM_TEST_POSTGRES_URL` unset. `npm run test:postgres` exits 1 at `require-postgres-url` (default gates stay network-free). `release:gate` blocked — cannot cut a release without durable postgres evidence. Enterprise postgres 16-client contention and phase6-postgres rows not re-measured on this host. No router retry/backoff change.
