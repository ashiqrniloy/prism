# Migration guide

## What it does

This page is the single navigation entry for the two cross-cutting migrations external apps hit when moving from Prism's development defaults to its production persistence and explicit-capability surfaces:

1. **In-memory / JSONL → database-backed persistence** — swap the single-process development `SessionStore` for a host-implemented `ProductionPersistenceStore` / `SessionStore` adapter, and optionally attach a durable `RunLedger`.
2. **Permissive capability defaults → explicit capability activation** — move from "omitted tool/skill lists activate everything in scope" (pre-Phase 38 behavior) to named, fail-closed tool/skill activation.

It is a thin, link-first guide: it states before/after shapes and points at the detailed pages for schema, indexes, redaction, branch handles, capability semantics, and security.

## When to use it

Read this page when:

- you are taking an app from the `createMemorySessionStore()` / `createJsonlSessionStore()` path to a multi-process, multi-tenant, or durable database backend;
- you are hardening an agent that previously relied on "every scoped tool/skill is active" and need to name capabilities explicitly;
- you are adopting the Phase 34–40 production surfaces (atomic append, branch handles, run/event/tool/usage ledger, security boundary hardening) for the first time.

If you are new to Prism, start at [Session stores](session-stores.md) and [Agent/session runtime](agent-session-runtime.md) instead.

## Inputs / request

There is no runtime import for this page. The migrations below use these surfaces:

| Surface | Where | Migration role |
| --- | --- | --- |
| `SessionStore` | `@arnilo/prism` | Runtime seam swapped from memory/JSONL to DB. |
| `ProductionPersistenceStore` | `@arnilo/prism` | Adapter-facing contract for paginated, multi-tenant reads (`query*`, optional `readBranchPath`). |
| `RunLedger` / `RunLedgerRecord` | `@arnilo/prism` | Durable run/event/tool-call/usage ledger attached via `AgentConfig.runLedger` / `RunOptions.runLedger`. |
| `SessionAppendOptions` / `SessionAppendConflictError` / `SessionBranchHandle` | `@arnilo/prism` | Atomic append, retry dedup, durable branch handles. |
| `AgentDefinition.tools` / `skills` | `@arnilo/prism` | Named, fail-closed capability activation (Phase 38). |
| `activateAllCapabilities` | `@arnilo/prism` | Temporary all-tools/all-skills compatibility opt-in while migrating. |

## Outputs / response / events

These migrations are configuration swaps: they do not add `AgentEvent` variants or change runtime event order. The observable differences are:

- reads come from a database instead of an in-memory map / JSONL file;
- branches are addressable by a storable `(sessionId, leafId)` handle;
- a run leaves durable `RunRecord` / `AgentEventRecord` / `ToolCallRecord` / `UsageRecord` rows;
- an agent with omitted `tools`/`skills` activates **no** capabilities instead of every in-scope one.

## Request/response example

Persistence migration (before/after):

```json
// Before — development SessionStore, single process, no ledger.
{
  "store": "createMemorySessionStore() | createJsonlSessionStore(path)",
  "runLedger": null,
  "ownership": null
}
```

```json
// After — host-implemented database-backed adapter + durable ledger.
{
  "store": "createDbSessionStore({ pool })",
  "runLedger": "createDbRunLedger({ pool })",
  "ownership": { "tenantId": "t1", "accountId": "a1", "userId": "u1" }
}
```

Capability migration (before/after):

```json
// Before (pre-Phase 38) — omitted tools/skills could receive every scoped capability.
{ "name": "doc", "model": "openai/gpt-4o" }

// After — explicit names; omitted means none.
{ "name": "doc", "model": "openai/gpt-4o", "tools": ["read"], "skills": ["brief"] }
```

## Implementation example

### Migration 1 — in-memory / JSONL → database-backed persistence

A complete, network-free reference adapter that implements these contracts against in-memory tables (and wires a `RunLedger`, branch-handle checkout, fork, and prior-run timeline resume) lives at [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts). The steps below mirror its structure.

Step 1: implement a `SessionStore` (or the richer `ProductionPersistenceStore`) against your database. The runtime only requires `append(entry, options?)`, `list(sessionId)`, and optional `get(id)` / `readBranchPath(query)`.

```ts
// Before: development store, single process.
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
const store = createJsonlSessionStore("./sessions.jsonl");

// After: host-implemented database adapter implementing the documented contract, no real DB needed to satisfy the contract.
import type { SessionStore, SessionEntry, SessionAppendOptions, PersistencePage, SessionBranchRead } from "@arnilo/prism";

const store: SessionStore = {
  async append(entry: SessionEntry, options?: SessionAppendOptions) {
    // 1. idempotency dedup: insert (session_id, expected_parent_id, idempotency_key, entry_id)
    //    into prism_session_append_idempotency; unique hit => SessionAppendConflictError { idempotencyDuplicate: true }
    // 2. expectedParentId existence check => SessionAppendConflictError { expectedParentId } if missing
    // 3. insert prism_session_entries row; duplicate id fails the transaction
    // 4. optionally compare-and-swap prism_branches.leaf_entry_id
  },
  async list(sessionId: string) { /* O(n) development fallback only */ return []; },
  async readBranchPath(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>> {
    // one recursive CTE / ancestor query — do NOT list(sessionId)+in-memory walk for long sessions
    return { items: [] };
  },
};
```

Step 2: optionally attach a durable run/event/tool/usage ledger and ownership scope so a process exit leaves enough to resume and bill:

```ts
import { createAgent, type RunLedger } from "@arnilo/prism";

const runLedger: RunLedger = {
  // appendRun / appendEvent / appendToolCall / appendUsage — redact before storage, preserve per-run order
  async appendRun(record) { /* insert prism_runs */ },
  async appendEvent(record) { /* insert prism_agent_events with monotonic sequence per run_id */ },
  async appendToolCall(record) { /* insert prism_tool_calls */ },
  async appendUsage(record) { /* insert prism_usage */ },
};

const agent = createAgent({
  model,
  provider,
  store,
  runLedger,
  ownership: { tenantId: "t1", accountId: "a1", userId: "u1" },
});
```

Step 3: store branch handles `(sessionId, leafId)` in your app state and use checkout to move an existing session to a previous or sibling leaf. The runtime's branch helpers (`getSessionBranchEntries`, `rebuildSessionContext`) consume `readBranchPath` so large sessions never require a full `list(sessionId)` load.

What you leave behind and why:

- `createMemorySessionStore()` — process-local maps; lost on restart, no cross-process locking. Keep for tests.
- `createJsonlSessionStore()` — single-process file adapter; reads are linear in file size, no cross-process lock, no durable idempotency table, two writers to the same file can race. Keep for local/dev only.

See [Database persistence](database-persistence.md) for the full reference schema, indexes, conditional-append transaction pattern, retention, and NoSQL mapping; [Session stores](session-stores.md) for the `SessionStore` contract and branch helpers; [Session stores and branching](session-stores-and-branching.md) for branch semantics; [Runs and usage ledger](runs-and-usage.md) for the `RunLedger` record shapes and ordering rules.

### Migration 2 — permissive capability defaults → explicit capability activation

Pre-Phase 38 behavior could treat an omitted `tools` list as "every scoped tool"; some hosts also expected all scoped skills to be available. Phase 38 changes the safe default: omitted `tools` and omitted `skills` mean no active capabilities.

```ts
import { resolveAgentDefinition } from "@arnilo/prism";

// Before: omitted tools could receive every scoped tool.
resolveAgentDefinition({ name: "doc", model: "openai/gpt-4o" }, context);

// After: list the capabilities this agent may use.
resolveAgentDefinition(
  { name: "doc", model: "openai/gpt-4o", tools: ["read"], skills: ["brief"] },
  context,
);
```

Temporary compatibility shim (use only while migrating old configs):

```ts
resolveAgentDefinition(
  { name: "legacy", model: "openai/gpt-4o" },
  { ...context, activateAllCapabilities: true },
);
```

`activateAllCapabilities: true` intentionally scans/list-activates every in-scope tool/skill. New configs should list names and use strict contribution registries so a third-party package cannot silently shadow a capability name:

```ts
import { createContributionRegistries } from "@arnilo/prism";

const registries = createContributionRegistries({ duplicate: "error" });
```

Runtime skill activation remains explicit: `RunOptions.activeSkills` narrows per run after an agent has a skill registry configured, and `Skill.toolNames` is enforced fail-closed before the first provider turn. See [Agent definitions](agent-definitions.md), [Context and skills](context-and-skills.md), and [Contribution registries](contribution-registries.md) for the full capability semantics.

## Extension and configuration notes

- **Persistence is host-owned.** Prism ships no database adapter, no DDL, no migration runner. Hosts own connection pools, transactions, cursor encoding, retention jobs, and tenant isolation. The runtime only talks to `SessionStore` (+ optional `readBranchPath`) and `RunLedger`.
- **`RunLedger` is not a `SessionStore` replacement.** Messages, branches, and session entries still flow through `SessionStore.append()`; the ledger records run/event/tool/usage facts. See [Runs and usage ledger](runs-and-usage.md).
- **Capability activation is config over code.** Every seam lives on `AgentDefinition` / `AgentDefinitionResolutionContext` / `RunOptions`; no auto-activation, no privilege grant. A declaration cannot grant permissions or bypass `toolNames`.
- **Migration order is decoupled.** You can adopt database persistence without changing capability activation, and vice versa. Both migrations are independent config swaps.
- **Strict duplicate mode for new registries.** `createContributionRegistries({ duplicate: "error" })` makes a third-party package fail loud instead of silently shadowing a capability name during migration.

## Security and performance notes

- **Never store provider credentials or secrets in the persistence contract.** `ProductionPersistenceStore`, `RunLedger`, `AgentEventRecord`, `ToolCallRecord`, `UsageRecord`, and `AgentDefinitionRecord` never require API keys, resolvers, or provider instances. Redact `SessionEntry` / event / tool-call / usage payloads before storage; the runtime redacts `AgentEvent`s via `redactAgentEvent` and ledger records via `redactRunLedgerRecord` before calling the adapter.
- **JSONL is a development-only adapter.** No cross-process lock, no durable idempotency table, no tenant isolation, no retention enforcement, no migrations. Do not use it as a production multi-writer store.
- **Avoid full-session scans in production.** Implement `readBranchPath(query)` with a recursive CTE / ancestor query and cursor-paginate `query*` from indexed columns. `list(sessionId)` + in-memory parent walk is the development fallback only.
- **`activateAllCapabilities` widens blast radius.** It activates every in-scope tool/skill, so prefer named lists. Strict duplicate mode catches capability-name collisions early.
- **`toolNames` enforcement is fail-closed.** A skill demanding an inactive tool throws at activation, before any provider turn — for both the old and new migration paths.

## Related APIs

- [Database persistence](database-persistence.md): production persistence contracts, reference schema, indexes, conditional append, retention, migrations, NoSQL mapping.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference.
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` record shapes, redaction, and event/usage ordering.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter and its limits.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition`, `resolveAgentDefinition`, and the explicit-capability-activation migration.
- [Context and skills](context-and-skills.md): `RunOptions.activeSkills`, `Skill.context`, `toolNames` enforcement.
- [Contribution registries](contribution-registries.md): strict `duplicate: "error"` mode for capability shadowing prevention.
- [Release and install](release-and-install.md): packaged surfaces and the offline test budget that gate these migrations.
