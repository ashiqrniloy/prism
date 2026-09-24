# Plan 120 Task 0 — primitive inventory

Date: 2026-09-23 (UTC probes). Tree: working copy at plan 120 Task 0. Node v26.9.0. No credentials, no home paths.

Rejected: skip the review. Rejected: full design essay. This file is the inventory later tasks consume. It does not redesign.

## 1. `readBranchPath` — who implements it

Contract: `src/contracts-core/session.ts:L46-L53`. Comment at `src/contracts-core/session.ts:L50-L52` states the built-in memory and JSONL stores omit `readBranchPath` and the runtime falls back to `list()`. `SessionBranchRead` is `src/contracts-core/session.ts:L216-L221`. `BranchReader` is `src/contracts-core/session.ts:L227`. Persistence mirror: `src/contracts-core/persistence.ts:L404-L406`. Page type: `src/contracts-core/persistence.ts:L32`.

Implementations (graft grep `readBranchPath`, 35 hits / 11 files):

| Site | Span | Notes |
| --- | --- | --- |
| SQLite | `packages/prism-core/src/sessions/sqlite/persistence.ts:L438-L467` | recursive CTE, `ORDER BY depth DESC` (root first) |
| Postgres | `packages/prism-core/src/sessions/postgres/persistence.ts:L374-L402` | same shape |
| Example reference store | `examples/external-app-db-backed.ts:L102-L117` | always implements it |
| Memory store | absent | `createMemorySessionStore` returns append/list/get/searchSessions only |
| JSONL store | absent | `graft skeleton src/node/session-store-jsonl.ts` methods: append, list, get, searchSessions. No `readBranchPath`. |

Rejected: JSONL implements readBranchPath. The plan's Task 1 "match the JSONL adapter" sentence is false. Page/cursor convention to copy is SQLite/Postgres, not JSONL.

Cursor codec: `packages/prism-core/src/sessions/codecs/cursor.ts:L1-L8`. `encodeBranchCursor` returns `String(offset)`. `decodeBranchCursor` requires a non-negative integer. Both adapters slice the full chain at that offset (`packages/prism-core/src/sessions/sqlite/persistence.ts:L460`).

Conformance: `src/testing/session-store-conformance.ts:L28` `exerciseReadBranchPath`. Assert at `src/testing/session-store-conformance.ts:L112-L116`: chain must be root→leaf (`ids[0] === "root"`, last id `"branch"`). Callers that already pass the flag: sqlite test, postgres integration test, `examples/external-app-db-backed.ts:L242`, `src/__tests__/conformance-helpers.test.ts`. Docs sentence: `docs/database-persistence.md:243`.

Runtime preference already exists: `src/agent-session/session.ts:L628-L633` `branchReader()`. Used by `entries()` `src/agent-session/session.ts:L584`, `clone()` `src/agent-session/session.ts:L610`, `snapshot()` `src/agent-session/session.ts:L880-L881`.

## 2. Clone sites on the snapshot path

`cloneEntry` is `structuredClone` at `src/session-stores.ts:L457-L458`.

Memory store (no reader) per `snapshot()`:

1. `list()` clones every session entry: `src/session-stores.ts:L241`.
2. `rebuildSessionContextCore` → `getSessionBranchEntriesCore` clones the branch again: `src/session-stores.ts:L107`.
3. Compaction path only: `messages.push(cloneEntry(entry.message))` at `src/session-stores.ts:L160`. No-compaction path reuses the already-cloned message (`src/session-stores.ts:L144` flatMap). So the third clone is not unconditional.

Reader path (what Task 1 turns the memory store into):

1. `readBranchFromReader` drains pages then calls `getSessionBranchEntriesCore` (clone 1): `src/session-stores.ts:L75-L85`.
2. `rebuildSessionContextFromReader` feeds that ordered branch back into `rebuildSessionContextCore`, which walks and clones again (clone 2). The redundant re-walk is the ponytail comment at `src/session-stores.ts:L127-L129`.
3. Compaction message re-clone (clone 3) at `src/session-stores.ts:L160`.

`MAX_BRANCH_PAGES = 64` at `src/session-stores.ts:L62`.

Task 1 win is still real: drop the `list()` full-session clone by implementing `readBranchPath`, and drop the re-walk clone. Do not claim 3N on every snapshot — 3N is the compaction+list case.

## 3. Token-estimate divergence (measured)

Probe (dist, not src — `node --experimental-strip-types` cannot resolve `src/context-budget.ts` `.js` specifiers):

```
node --input-type=module  # imports dist/context-budget.js, dist/usage-estimation.js,
                          # packages/memory/dist/compaction/{llm,observational-memory}/tokens.js
```

Text (`estimateTextTokens` / `estimateTextTokensForFamily`):

| id | root | memory-llm | memory-om | family unknown | family claude-sonnet-4.5 | family gpt-4o |
| --- | --- | --- | --- | --- | --- | --- |
| ascii-short `hello world` | 3 | 3 | 3 | 4 | 3 | 3 |
| empty | 0 | 0 | 0 | 0 | 0 | 0 |
| one-char `a` | 1 | 1 | 1 | 1 | 1 | 1 |
| cjk `中文测试` | 1 | 1 | 1 | 3 | 3 | 3 |
| emoji | 1 | 1 | 1 | 2 | 2 | 1 |
| mixed | 4 | 4 | 4 | 5 | 5 | 4 |
| fenced | 9 | 9 | 9 | 11 | 11 | 8 |

Text primitive is identical across the three `ceil(length/4)` sites: `src/context-budget.ts:L87`, `packages/memory/src/compaction/llm/tokens.ts:L3`, `packages/memory/src/compaction/observational-memory/tokens.ts:L3`. Accidental duplication. Safe to import the root function. `estimateTextTokensForFamily` (`src/usage-estimation.ts:L70`) is a different algorithm (CJK / fence ratios). Do not collapse it into `ceil(length/4)`.

Messages (`estimateMessageTokens`):

| id | root flatten | memory-llm block sum | memory-om JSON.stringify(block) |
| --- | --- | --- | --- |
| user-text | 3 | 4 | 9 |
| asst-tool | 5 | 8 | 18 |
| tool-result | 3 | 6 | 19 |
| thinking | 1 | 4 | 9 |
| image | 3 | 4 | 10 |
| empty-content | 0 | 1 | 0 |

Message divergence is legitimate, not drift: root flattens via `messageText` (`src/context-budget.ts:L456`); llm adds `ceil(role/4)` plus per-block (`packages/memory/src/compaction/llm/tokens.ts:L7-L8`); om stringifies each block (`packages/memory/src/compaction/observational-memory/tokens.ts:L7-L8`). Pin three columns. Do not force one message implementation this plan — that moves compaction thresholds.

## 4. Interruption literals — four sites, not three

All in `src/agent-session/session/tool-round.ts`.

| Site | Span | kind | reason | extra fields |
| --- | --- | --- | --- | --- |
| `suspendGatedRound` | `src/agent-session/session/tool-round.ts:L214-L221` | `elicitation` iff single.kind is elicitation, else `tool_approval` | single.reason, else `` `${n} tool side effects require approval` `` | optional toolCallId, toolName, **guardrail** |
| `suspendNested` | `src/agent-session/session/tool-round.ts:L261-L267` | `single?.kind ?? "tool_approval"` | single.reason, else `` `${n} approval request(s) need a decision` `` | optional toolCallId, toolName. No guardrail |
| `bindDispatchToolCall` | `src/agent-session/session/tool-round.ts:L458-L464` | always `tool_approval` | `decision.reason` | toolCallId + toolName always set. No guardrail |
| `replayDurableNestedAndPending` | `src/agent-session/session/tool-round.ts:L553-L559` | `single?.kind ?? "tool_approval"` | always `` `${n} approval request(s) remain` `` (even when n is 1) | optional toolCallId, toolName. No guardrail |

A builder may share the shape. It must not unify reason strings, the elicitation kind test, or the guardrail spread. Those are behavior.

## 5. Lease and idempotency writers

Lease factory: `src/leases.ts:L14` `createMemoryLeaseStore`. Map never deletes.

| Writer | Span | Effect |
| --- | --- | --- |
| `tryAcquireLease` | `src/leases.ts:L37` | `records.set`. Method name is `tryAcquireLease`, not `acquireLease` |
| fencing | `src/leases.ts:L31` | `(current?.fencingToken ?? 0) + 1` |
| `renewLease` | `src/leases.ts:L53` | `records.set` |
| `releaseLease` | `src/leases.ts:L64` | sets `expiresAt` to now. Does not delete |
| `getLease` | `src/leases.ts:L67` | read only; expired returns null |

Public contract: `docs/operations.md:23` — "Expired rows retain their fencing counter; the next owner inherits `fencingToken + 1`." `docs/public-contracts.md:150` calls fences monotonically increasing. `docs/operations.md:17` says `acquireLease`; the code method is `tryAcquireLease` (docs drift, not this task's fix).

Rejected: delete expired lease rows. A sweep that drops the record resets the next fence to 1 and breaks `docs/operations.md:23`. Task 3 may cap the map only by changing that sentence and naming the reset in the changelog. Tombstones that keep only `fencingToken` preserve the contract and still grow one entry per historical key — they do not bound distinct keys.

Idempotency sets named `idempotencySeen` (safe to bound; docs already say in-process, reset on restart):

- `src/session-stores.ts:L230` allocate, `src/session-stores.ts:L261` has, `src/session-stores.ts:L282` add. Key is session + key + expectedParentId.
- `src/node/session-store-jsonl.ts:L41`, `src/node/session-store-jsonl.ts:L58`, `src/node/session-store-jsonl.ts:L68`.
- Docs: `docs/session-stores.md:155` (process-local maps), `docs/node-jsonl-session-store.md:73` (resets on restart, not durable).

## 6. Branch coverage — Node instrument, core only

Plan 114 disposition stands: Bun 1.4.2 lcov has no BRDA/BRF/BRH (`docs/_evidence/phase114-bun-coverage.md` §1.3). Archived Node number there: lines 93.00 / branches 86.49 / functions 93.62 (`docs/_evidence/phase114-bun-coverage.md` §2.3).

Re-measure, warm dist, Node v26.9.0:

```
# unfiltered — DO NOT use. Loads scripts via tests. all files branches 76.73
node --test --experimental-test-coverage dist/__tests__/*.test.js
# 22:07:04Z–22:07:25Z, exit 1 (timing flake, see below)

# core only — this is the number
node --test --experimental-test-coverage --test-coverage-include='dist/**' --test-coverage-exclude='dist/__tests__/**' dist/__tests__/*.test.js
# 22:07:44Z–22:08:04Z (~20s, warm). exit 1 on the same flake.
# all files | 93.00 | 86.49 | 93.62
```

Column order is line % / branch % / funcs %. Core branch freeze seed is **86.49**. Plan 023 floor = 86.49 − 3pp = **83.49**. Under the Task 6 3-minute ceiling, so the audit can sit in `npm test`. Not a cold run (no cache drop).

The exit 1 is `dist/__tests__/field-policy.test.js` "policy pass adds under 10% overhead…" — load-sensitive timing assert (172.8% vs 10% cap on this busy machine). 2068 pass / 1 fail. Not a coverage failure. The audit must not treat that flake as a branch-floor miss.

Rejected: c8. Rejected: unfiltered `all files` row as the core number.

## 7. Examples — 109 files, 41 already executed, 68 not

`examples/*.ts` count: **109**.

Already executed:

- `src/__tests__/docs.test.ts:L3368` `demos` array: **38** files, spawned after `tsc -p examples` emit (`src/__tests__/docs.test.ts:L3358`). Asserts exit 0, non-empty output, no secret-shaped stdout.
- Dedicated spawn tests, not in that array: `src/__tests__/crew-hierarchy-example.test.ts`, `src/__tests__/handoff-swarm-example.test.ts`, `src/__tests__/messaging-outbox-example.test.ts`.

`docs/release-and-install.md:317` says docs tests execute `examples/*.ts`. They execute 38, not 109. Task 7 must not respawn the 41. It must cover the 68 below plus set-equality so a new file fails until triaged.

Static signals on the 68 (not a skip manifest — Task 7 finalizes by spawn):

- Env: `docker-process-session.ts` (env+docker), `enterprise-postgres-state.ts` (pg), `open-connector-sidecar.ts` is already in the 38 and uses `OOMOL_CONNECT_RUNTIME_TOKEN`, `workflow-postgres-resume.ts` is already in the 38 and uses `PRISM_TEST_POSTGRES_URL`.
- URL/fetch among the 68: `ag-ui-mcp-apps.ts`, `ag-ui-server.ts`, `artifact-review-delivery.ts`, `coding-browser-evaluation.ts`, `mcp-server.ts`, `oauth-login.ts`, `phase9-coding-intelligence.ts`, `provider-xai-oauth.ts`, `web-research.ts`.
- Provider-package imports among the 68: `ai-sdk-provider.ts`, `openrouter-model-cache-override.ts`, `provider-clinepass.ts`, `provider-deepseek.ts`, `provider-xai.ts`, `provider-xai-oauth.ts`.

Unexecuted filenames (68):

`ag-ui-mcp-apps.ts`, `ag-ui-server.ts`, `agent-durable-approval.ts`, `ai-sdk-provider.ts`, `api-key-auth.ts`, `artifact-review-delivery.ts`, `attention-budget-axes.ts`, `attention-compiler.ts`, `autonomous-coding-loop.ts`, `behavior-evaluation.ts`, `coding-browser-evaluation.ts`, `coding-goal-verify.ts`, `coding-tools-capability-gaps.ts`, `config-settings.ts`, `context.ts`, `conversation-durable-replay.ts`, `distributed-events-and-tool-effects.ts`, `docker-process-session.ts`, `drive-rag-sync.ts`, `durable-coding-workflow.ts`, `durable-investigation.ts`, `enterprise-identity.ts`, `enterprise-policy-audit.ts`, `enterprise-postgres-state.ts`, `enterprise-work-connectors.ts`, `evals.ts`, `evaluation-gate.ts`, `execution-timeline.ts`, `extensions.ts`, `governed-provider.ts`, `guardrail-packs.ts`, `host-artifact-loop.ts`, `hosted-sandbox.ts`, `impeccable.ts`, `jsonl-stores-branching.ts`, `manifests.ts`, `mcp-server.ts`, `memory-fabric.ts`, `messaging-agent.ts`, `oauth-login.ts`, `obscura.ts`, `openrouter-model-cache-override.ts`, `phase9-coding-intelligence.ts`, `provider-clinepass.ts`, `provider-deepseek.ts`, `provider-xai-oauth.ts`, `provider-xai.ts`, `rag.ts`, `realtime-voice-host.ts`, `run-feedback.ts`, `scanned-document-rag.ts`, `sdk-basics.ts`, `secure-agent.ts`, `server-deployment-seams.ts`, `session-search.ts`, `signal-agent.ts`, `skills.ts`, `spawn-agent-tool.ts`, `supervisor-a2a.ts`, `system-prompts.ts`, `telegram-agent.ts`, `tool-narrowing-planes.ts`, `tools.ts`, `web-research.ts`, `web-standard-server.ts`, `work-scopes-coding-loop.ts`, `workflow-schedules-replay.ts`, `working-semantic-memory.ts`.

`createMockProvider` appears in 42 of 109 files. Several executed demos (crew-hierarchy) use inline `AIProvider` objects instead, so absence of that string is not "needs network".

## 8. Count-delta census

`scripts/package-truth.mjs:L82-L86` already records the decision from plan 070 Task 15: historical `hasCodingTools ? -46` deltas stay in the freeze suites. `workspaceShape()` at `scripts/package-truth.mjs:L90` is the live-tree helper. Do not move frozen expected numbers into the helper.

Live `hasCodingTools ?` sites (grep):

- `scripts/phase13-freeze.test.mjs:L147` through `scripts/phase21-freeze.test.mjs` (phase13–21, nine files). Predicate: `workspaceShape().names.includes("prism-coding-tools")` (see `scripts/phase13-freeze.test.mjs:L145`).
- `scripts/phase27-release.test.mjs:L78` (`hasWork ? -45 : hasCodingTools ? -42 : hasCore ? -14 : 0`).
- `scripts/benchmark-multi-agent.test.mjs:L67` (`hasWorkFamily ? 12 : … : hasCodingTools ? 34`).
- `scripts/phase24-truth.test.mjs:L27` uses `hasCodingToolsPackage` via `existsSync`, not the same ternary.

Not in this pattern (plan list was wrong): `src/__tests__/docs.test.ts` and `src/__tests__/release.test.ts` use live `truth.counts` or frozen historical strings. `scripts/phase29-freeze.test.mjs`, `scripts/phase30-release.test.mjs`, `scripts/phase34-freeze.test.mjs` assert frozen baseline numbers. Plan 057 retired those phase files from the default suite (`docs/release-and-install.md:317`).

## 9. JSONL writers (Task 2 substrate)

Only writer: `appendFile` at `src/node/session-store-jsonl.ts:L69`. No truncate, no compaction rewrite in this file. Cache invalidation is: refresh after `append`, stat-miss on external edit. A compaction-rewrite test has nothing to attach to in this module.

## Decisions later tasks must follow

1. Task 1 copies SQLite/Postgres page semantics (`packages/prism-core/src/sessions/codecs/cursor.ts:L1`), returns root→leaf, updates the omit-comment at `src/contracts-core/session.ts:L50`.
2. Task 2 caches parses; writer set is `appendFile` only.
3. Task 3 bounds idempotency sets. Lease sweep that drops fencing violates `docs/operations.md:23` — contract edit or no sweep.
4. Task 4 builder covers four sites; reason strings stay distinct.
5. Task 5 may share the text primitive; must pin three message columns and a family column.
6. Task 6 uses `--test-coverage-include=dist/**` and freezes 86.49. Rejected: c8.
7. Task 7 spawns the 68, not the 41 already executed.
8. Task 8 extracts live predicates only. Frozen deltas stay per plan 070.
