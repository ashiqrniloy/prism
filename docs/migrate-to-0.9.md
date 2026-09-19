# Migrate Prism 0.8 to 0.9

> **Status: 0.9.0** (attention budget axes, turn traces, cache-stable disclosure, per-turn tool narrowing, guardrail packs, background agents, checkpoint metadata, session search, deterministic turns, shared work scopes).

This document details migration steps, behavioral changes, and compatibility notes for upgrading from Prism 0.8.0 to 0.9.0.

0.9.0 is a lockstep minor for all **eleven** publishable packages. Node `>=22` stays the floor. **Nothing was removed**: no import path moved, no export was dropped, and every new surface defaults to 0.8 behavior — a host that only moves its dependency ranges keeps 0.8 request bytes, stores, and tool lists. The four deltas below sit inside existing surfaces, so they are readable without opting into anything.

---

## Behavior changes inside existing surfaces

### 1. A limit death delivers three records, and only the last one is terminal

`run_limit_exceeded` was treated as terminal by the in-memory, NATS, and Postgres event sources and by AG-UI replay, so a consumer that stopped at the first breach record ended one record early — before the `budget_exhausted` attribution and before the run's terminal `error`. The terminal set is now exactly `agent_finished`, `agent_denied`, and `error`, decided by one exported predicate that every stream-ending site shares.

```ts
// before — the stream could end on the breach record
for await (const item of source.subscribe({ ... })) {
  if (item.record.type === "run_limit_exceeded") break; // missed budget_exhausted and the error
}

// after — the breach and its attribution are not terminal; the error is
for await (const item of source.subscribe({ ... })) {
  if (isTerminalAgentEventType(item.record.type)) break; // ends on the run's error
}
```

**Migration actions**
- Keep reading past `run_limit_exceeded` and `budget_exhausted`; the stream ends on `error`. A consumer that wants the attribution reads until `isTerminalAgentEventType(type)` is `true` (or the iterator ends).
- No configuration, no flag: this is the shipped delivery contract for pages, subscriptions, and replays. See [Agent events § Durable AgentEventSource](agent-events.md#durable-agenteventsource).

### 2. `provider_turn_finished` carries stop reason, budgets, tools, and cache metrics

The turn event gains attributed metadata: `stopReason` from one closed taxonomy (`end_turn`, `tool_calls`, `max_output_tokens`, `content_filter`, `abort`, `provider_error`, `unknown`), a `budgets` snapshot (`inputTokens?`, `inputCap?`, `runInputBudget?`, `runInputUsed`, `turns`, `maxTurns`), the effective tool menu as counts plus `tools.idsHash`, and provider-reported `cache` counts (`cacheReadTokens?`, `cacheWriteTokens?`, `hitRate?`). `agent_finished` carries the run-level `finishReason`/`stopDetail`, `AgentRunResult.stopReason` names host-policy and loop-ceiling stops, and the execution timeline adds `turns[i].stopReason` plus `timeline.exhaustion`.

```ts
source.subscribe({ ... }); // each provider_turn_finished.metadata:
// { latencyMs, stopReason: "tool_calls", budgets: { runInputUsed: 43_000, turns: 3, maxTurns: 16 }, tools: { count: 7, idsHash: "sha256:…" } }
```

**Migration actions**
- Consumers that deep-equal `metadata` (or reject unknown keys) must allow the new fields; consumers that read specific keys are unaffected.
- Read `metadata.cache` only when present — unknown cache usage stays absent rather than zero-filled.

### 3. Progressive disclosure is cache-stable

Late-expanding context (skill bodies, deferred tool schemas, loaded references) now lands at cache-stable positions: the request tail, or an explicit documented invalidation of the segment that changed. The default group order and the catalogs' slot are unchanged, so a host that never loads late context sends the same bytes as 0.8; hosts that do get append-only growth instead of a rewritten prefix.

```ts
// assert it against your own assembly (fixture provider, network-free, no keys)
await runPrefixStabilityConformance({ agent, minContinuity: 0.95 }); // ≥95% shared serialized prefix per turn
```

Sizing: measured 100% / 95.7% / 95.8% shared prefix on the padded fixture for three consecutive requests; `minContinuity` defaults to `0.95` and is checked over messages **and** tool schemas. Cache reads/writes and per-turn hit rate are now recorded on usage records and `provider_turn_finished.metadata.cache`. See [Prefix stability conformance](prefix-stability-conformance.md) and [Provider caching](provider-caching.md).

### 4. A provider that reports no usage is charged a labeled estimate

A usage-less provider used to contribute zero tokens. `AgentConfig.usageEstimation` now defaults to `"fallback"`: one labeled `TokenEstimate` is recorded at the existing usage seam, and the label survives everywhere the number goes.

```ts
const meter = session.contextMeter();
// { inputTokens: 43_000, source: "estimated", inputCap: 200_000, runInputBudget: 500_000, usedRatio: 0.215 }
const estimate = estimateMessageTokens(messages, "claude-sonnet-4.5"); // { tokens, confidence: "medium" | "low", … }
```

**Migration actions**
- Billing or reporting code must read the `estimated` flag (and `confidence`) rather than treating every usage row as provider truth; reported usage always wins and is never overwritten.
- Set `usageEstimation: "off"` to keep the 0.8 zero-for-no-usage behavior. Estimates charge the token counters for usage-less vendors but never a price, so a configured `maxCost` stays fail-closed.

---

## Additive surfaces (inert unless wired)

### 5. Attention budget axes and durable folding

`attentionCompiler.trigger` replaces the single `triggerRatio` gate with one axis, a predicate, or an any-of array: `{ kind: "input_ratio", ratio }` (the legacy axis), `{ kind: "run_input_ratio", ratio }` (fires against `RunLimits.maxInputTokens` — the case that used to be inert when the run cap sat below the model window), `{ kind: "token_floor", tokens }`, and a predicate function. Omitted, `triggerRatio` (default `0.75`) is the only axis and behavior is byte-identical to 0.8.

```ts
const attention = createAttentionCompiler(
  { trigger: [{ kind: "run_input_ratio", ratio: 0.75 }, { kind: "token_floor", tokens: 120_000 }], durable: true },
  { model, runInputBudget: limits.maxInputTokens },
);
```

Sizing: one session-store write per fold (not per turn); folding stays default-off, and `durable: true` requires a checkpoint store (`runState`) or the run throws `AgentRunStateError` before its first provider turn. See [Attention compiler](attention-compiler.md).

### 6. Per-turn tool narrowing

`AgentConfig.toolNarrowing` / `RunOptions.toolNarrowing` (run wins) is a host callback invoked before each provider turn: it receives `{ turn, lastAssistantText?, toolIds }` and must return a subset of the run grant. Extra or unknown names are dropped — the runtime emits `tool_narrowing_clamped` with the dropped names — and a throw fails the turn instead of sending a partial schema.

```ts
await session.run("fix the failing test", {
  toolNarrowing: async ({ turn, toolIds }) => (turn > 2 ? toolIds.filter((id) => id === "read" || id === "edit") : toolIds),
});
```

Sizing and cache cost: changing the toolset rewrites provider schemas, so pair narrowing with tool search or deferred disclosure (where the tail contract above applies), and read menu identity from `provider_turn_finished.metadata.tools.idsHash` — identical consecutive subsets keep the same hash. Absent callback: 0.8 menu, byte-identical. See [Tools](tools.md).

### 7. Guardrail packs

`AgentSessionConfig.guardrailPacks` (or `compileGuardrailPacks(refs)` for hosts that dispatch tools directly) compiles declarative, restrictive-only rule sets onto the tool stages once per session. Four built-ins ship: `coding-standard` (`no-unrelated-file-edits`, `no-test-rewrites`), `destructive-commands`, `validation-respect`, and `secrets-hygiene`. Every pack ships a trajectory scorer (`createGuardrailPackScorer`) so enforcement can be graded, and pack denials are attributed as `pack:<pack>/<rule>`.

```ts
const agent = createAgent({ /* … */, session: { guardrailPacks: ["secrets-hygiene", "destructive-commands"] } });
// compiled from existing seams: interruptBeforeTool, the extension kernel, enforceExecutionPolicy
```

Sizing: `guardrailPacks` accepts at most 8 packs and 64 rules per pack; containment in `coding-standard` is lexical (`options.roots` defaults to `[process.cwd()]`, symlinks are not resolved), so an `ExecutionPolicy` stays the hard boundary. See [Guardrails](guardrails.md#guardrail-packs).

### 8. Background (session-lifetime) child agents and child-event passthrough

`delegate` / `delegateAsync` / `spawn_agent` accept `lifetime: "session"`, `report: "on-complete" | "milestones" | "stream"`, `milestone`, and `budgetShare`; a host `SupervisorChild.policy` sets the ceiling and a model request can only narrow it (report is clamped, `everyTurns` can only be raised, share takes the lower value, session lifetime must be host-enabled). Session-lifetime children survive caller turns until `cancel_agent` / `cancel(delegationId)`. New events: `child_milestone`, `child_failed` (with the plan-087 `RunLimitBreach` attribution), `delegation_child_events_capped`, `delegation_child_events_coalesced`.

```ts
const { delegationId } = await supervisor.delegateAsync({ childId: "researcher", input: "survey the repo", lifetime: "session", report: "milestones", milestone: { everyTurns: 3 }, budgetShare: 0.25 });
supervisor.subscribe(); // … child_milestone … child_failed (on a limit or error)
```

Sizing: child events per delegation 256/4096, child-event bytes 32 KiB/256 KiB, child events per second 10/1000 (default/hard, per child) — 10/s is trivial for a UI, raise it only for a child whose tool events are the UI. Exceeding rate coalesces into one `delegation_child_events_coalesced` marker with the dropped count (never throws). Defaults are exactly 0.8: `lifetime: "task"`, `report: "on-complete"`, no milestone, no share, no subscription. See [Supervisors](supervisors.md) and [Multi-agent patterns](multi-agent-patterns.md).

### 9. Checkpoint sidecar metadata and cross-layer restore hooks

Hosts attach an opaque, redacted metadata map (≤4 KiB) to every checkpoint record — git commit, document version, workspace fingerprint — without charging `maxStateBytes`, and register restore hooks that put each recorded layer back before a resume claims the run.

```ts
createAgentRunLifecycle({ runState: { checkpointMetadata: () => ({ gitCommit: head, docVersion: "v12" }) },
  restoreHooks: [async ({ metadata, signal }) => { await checkout(metadata.gitCommit, { signal }); }] });
```

Sizing: `MAX_AGENT_RUN_METADATA_BYTES` is 4 KiB (fixed, no override), the whole map is redacted unconditionally (no public-key exemption), and each hook has a 10-second default timeout (`DEFAULT_CHECKPOINT_RESTORE_TIMEOUT_MS`) with sequential execution; any hook failure aborts the restore with `{ hook, error }`. Legacy records without metadata read as `undefined`, and an oversize or non-string map reads as absent rather than failing a resume — unused, behavior is unchanged. See [Durable runs](durable-runs.md).

### 10. Bounded workspace session search

`SessionStore.searchSessions?(query)` is part of the store contract: filters by workspace root (`metadata.workspaceRoot`), time, provider/model, label/summary, entry kind, ownership, and an optional full-text `query`; hits carry `sessionId`, optional `leafId`, and the matched entry pointer (`entryId`, `runId`, 1-based `turn`, store `score`, bounded `snippet`) — never credentials or whole transcripts. SQLite FTS5 and the Postgres `tsvector` column are maintained additively at append time (migration 004, no background job); memory and JSONL stores scan linearly through the shared `searchLinearSessions` matcher.

```ts
const page = await store.searchSessions!({ workspaceRoot: "/repo", query: "flake", kind: "any", limit: 20 });
const { page } = await searchSessions({ bySession, leafBySession, query: "flake" }); // linear caps apply
```

Sizing: on the 100k-turn fixture the index is 18.8% of transcript page bytes (stored tool output is never indexed) and query p95 is 38 ms against the 100 ms ceiling; unindexed stores are O(corpus) per query and accept `maxLinearSessions` / `maxLinearEntries` / `maxLinearBytes` overrides bounded by their hard caps. See [Session stores](session-stores.md) and `examples/session-search.ts`.

### 11. Deterministic no-model turns

The `beforeProviderTurn` middleware hook receives `BeforeProviderTurnPayload` (`sessionId`, `runId`, `turn`, `userText`) and may answer the turn from host data by returning a `DeterministicTurnAnswer` — no provider request, zero model cost, no hallucination surface. Answers are validated (`validateDeterministicTurnAnswer` / `resolveDeterministicTurn`), the turn is recorded as `deterministic` on the timeline and in usage, and `DeterministicTurnProvenance` names the middleware that produced it. `createDeterministicTurnScorer` grades the behavior in evals.

```ts
middleware.use<BeforeProviderTurnPayload>("beforeProviderTurn", async (payload, next) =>
  payload.userText.startsWith("status:")
    ? { ...payload, answer: { text: await hostStatus(payload.userText), provenance: { middleware: "status" } } }
    : next(payload));
```

Sizing: no provider turn, no usage beyond a zero-cost record; the hook runs only for turns that reach the provider boundary (a turn already ended by a run limit, host turn policy, or suspension never reaches it), and host middleware is trusted code — it must not use the hook to bypass `RunLimits` or guardrails. See [Middleware hooks](middleware-hooks.md#no-model-turns-beforeproviderturn).

### 12. Shared work scopes for observational memory

`om.attach(session, { sharedScopes })` lets several sessions contribute to and read one observational-memory scope under explicit owner grants (`controller.grant(scopeId, principalIds)` / `revoke`). Only ids bound to that exact scope are shared; the owner branch is the only grant authority; every resolve re-reads it, so revocation lands on the next read, and `onScopeAccess` audits each grant/denial.

```ts
om.attach(session, {
  appendEntry: (entry, options) => store.append(entry, options),
  sharedScopes: { "build-42": { ownerSessionId, entries: (id) => store.list(id) } },
  onScopeAccess: (event) => audit.info("om.scope.access", event),
});
```

Sizing: one local write per append (flush stays local — no second writer on a branch); one branch read plus fold per participating branch per context resolve and per shared-scope recall, not per observation; 1,024 principals per scope and 256-character principal ids, on top of the existing scope caps (256 scopes, depth 8, 4,096 binds, 512-character labels). Session-private scopes stay the default: with no `sharedScopes` configured, behavior is byte-identical to 0.8. See [Compaction and observational memory](compaction-observational-memory.md#shared-work-scopes-opt-in) and `examples/shared-work-scope.ts`.

### 13. Retrieval revocation and a zero-service reranker

Deletion and revocation propagate through derived artifacts: `createDeletionPropagator` deletes vector rows and then hands the invalidation set (`collectInvalidationIds` / `listInvalidatedIds`) to host handlers, and `repointSource` / `retireWikiSources` (plus the `createWikiDeletionHandler` / `createWikiRepointHandler` helpers) keep wiki pages and summaries consistent. `createAccessRecheck` rechecks governed sources per query and reports denials through an audit sink. Reranking no longer needs a research project: `resolveReranker({ kind: "local" })` / `createLocalReranker()` runs an in-process cross-encoder behind the `LocalRerankRuntime` seam, with the same `runRerankerConformance` contract as every other reranker; TEI and hosted adapters are unchanged.

```ts
const reranker = resolveReranker({ kind: "local" });            // Xenova/bge-reranker-base via a host-owned runtime
const access = createAccessRecheck({ store, onDenied: audit.warn });
const propagator = createDeletionPropagator({ store, handlers: [createRagDeletionHandler(vectors), createWikiDeletionHandler(wiki)] });
```

Sizing: the local reranker declares no inference dependency — the built-in loader resolves `@huggingface/transformers` at first use (pass `runtime` to inject your own, or `allowRemoteModels: false` for a no-network posture after the model is cached); propagation and repoint walks are bounded by `HARD_PROPAGATION_EDGES` / `HARD_REPOINT_RECORDS` and fail closed past them. See [RAG](rag.md#local-reranker), [Embeddings](embeddings.md), and [Knowledge sync](knowledge-sync.md).

---

## Operator / release honesty (not a host API break)

- **Compatibility baseline regenerated**: `+119` public names across `@arnilo/prism` (+49), `@arnilo/prism-memory` (+60), and `@arnilo/prism-core` (+10); **zero removals** and zero renames. One declaration change is consumer-visible at the type level: the `recordUsage` callback accepted by `generateProviderTurn` / `generateWithRetry` now returns `Promise<Usage | undefined>` instead of `Promise<void>`, so a hand-written callback that returned nothing must return the usage (or `undefined`).
- **Budgets rebaselined with recorded reasons**: root packed/unpacked/file count, per-package export ceilings, and the non-null assertion ratchet carry the measured 0.9.0 values and the plans that moved them.
- **This-tree Postgres evidence**: `release:gate` reports the durable Postgres surface as pass only when `scripts/postgres-evidence.json` matches the current `git rev-parse HEAD`; a stale phase baseline is blocked rather than inherited.
- **Version literals agree** across all eleven manifests, the lockfile, `src/index.ts`, the docs banner, the release workflow tag lists, and the generated package-truth artifact (`scripts/version-literal-gate.test.mjs`).

## Upgrade steps

1. Bump every `@arnilo/*` dependency and peer to `^0.9.0` (all **eleven** manifests cut together; a range that only *satisfies* 0.9.0 is refused by the release gate). The published predecessor is 0.8.0.
2. Build and run the host suite. No import path moved, so compile errors should be limited to the `recordUsage` callback return type above and to code that deep-equals `provider_turn_finished.metadata`.
3. Re-read §1–§4 if the host tails durable agent events, parses provider-turn metadata, uses progressive disclosure or prompt caching, or bills usage for vendors that report no usage.
4. Adopt §5–§13 only where the host wants the new surfaces. Omitted, request bytes, stores, and tool lists stay 0.8.
5. Run the new migration 004 on SQLite/Postgres stores if the host wants indexed session search; existing tables and columns are untouched, and 0.8 stores open unchanged.
6. Optional: `PRISM_TEST_POSTGRES_URL=… npm run test:postgres` then `npm run release:gate` to reproduce this-tree Postgres evidence.

## Rollback

Pin the previous published line: `@arnilo/prism@0.8.0` and its siblings, exact pins per package. Session, checkpoint, and ledger schema are unchanged across 0.8.0 → 0.9.0 apart from the additive session-search index (migration 004), which a 0.8.0 process never reads; observability rows written under 0.9.0 carry extra metadata fields that 0.8.0 ignores. Revert host config to 0.8.0 semantics by dropping `attentionCompiler.trigger` / `durable`, `toolNarrowing`, `guardrailPacks`, `usageEstimation`, `checkpointMetadata` / `restoreHooks`, `sharedScopes`, and the session-lifetime child options — every default already matches 0.8.0.

## Related APIs

- [Migration guide](migration.md): the era index of migration cuts with replacement tables and rollback notes.
- [Migrate Prism 0.7 to 0.8](migrate-to-0.8.md): work-family import map, messaging channels, connected apps, durable runs.
- [Release and install](release-and-install.md): packed surfaces, install rules, support matrix, and the offline test budget.
- [Agent events](agent-events.md), [Runs and usage](runs-and-usage.md), [Observability](observability.md), [Tools](tools.md), [Guardrails](guardrails.md), [Supervisors](supervisors.md), [Session stores](session-stores.md): owning pages for the 0.9.0 additions.
