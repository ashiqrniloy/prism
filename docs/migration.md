# Migration guide

## 0.5.3 → 0.5.4 (export-shape break in `@arnilo/prism`)


Run-limit process ceilings split from host policy (plan 067). `HARD_RUN_LIMITS` shrinks to the two process-safety axes (`maxRequestBytes`/`maxResponseBytes`, 64 MiB) and `HARD_MAX_RUN_COST` is removed — delete imports; no replacement exists because product axes have no hard cap. `RunLimits` policy axes (turns, attempts, tool rounds/calls, wall time, tokens) now accept `number | null`, where `null` explicitly disables the axis and omitted keys keep the `DEFAULT_RUN_LIMITS` fence; byte axes reject `null`. Resolution stays narrowing-only (`null` acts as +Infinity), an omitted `maxProviderAttempts` lifts to at least a raised/disabled `maxTurns`, and the former `$10k` `maxCost` ceiling is gone (any finite non-negative amount is valid). `resolveRunLimits` returns the new `ResolvedRunLimits` type (policy axes `number | null`). Durable run state without a wall limit omits `deadlineAt`; older checkpoints carrying one still resume with it. `DEFAULT_RUN_LIMITS` values and all breach semantics are unchanged.

## 0.5.2 → 0.5.3 (additive)


Content-only tool results fold onto `tool_result.result` at construction. Serializers join sibling `type:text` blocks when `result` is missing, so coding tools that return `content` (not `value`) no longer reach the model as JSON `"null"`. No import, store, or peer-range break; bump `@arnilo/prism*` to `^0.5.3`.

## 0.5.1 → 0.5.2 (additive)


Stream tokens coalesce on persist (adjacent `text`/`thinking` deltas merge). Replay serializers join those parts with an empty string instead of a newline. No import, store, or peer-range break; bump `@arnilo/prism*` to `^0.5.2`.

## 0.5.0 → 0.5.1 (additive)


Kernel constructs valid provider requests: session correlation, default cache breakpoints, and `thinkingLevel` on `AgentConfig` / `RunOptions`. Clay may drop host-only `createSessionCachePolicy`. OpenCode Go raw `generate` without `sessionId` throws `ProviderRequirementError` (`ERR_PRISM_PROVIDER_REQUIREMENT`) before fetch instead of an upstream 400. Observational memory uses derived `om:{session.id}`; LLM compaction uses the agent session id. See [migrate-to-0.5.md](migrate-to-0.5.md#8-provider-request-construction--additive-plan-066--051).

## What it does


Prism 0.0.6 preserves documented 0.0.3 agent construction except for two intentional Phase 3 public-API cleanups:

1. **`session.run()` / `session.prompt()` return `AgentRunResult`** and `session.stream()` starts one owned run after subscribing. Callers that ignored the previous `Promise<void>` keep working; failed/aborted runs reject with `AgentRunError` (`.result` attached).
2. **`AgentConfig.extensions` / `settings` / `credentials` are removed.** Wire extensions through `createExtensionKernel()`, read settings in the host, and pass credential resolvers to the provider edge.

## When to use it


Read this page when:

- you are taking an app from the `createMemorySessionStore()` / `createJsonlSessionStore()` path to a multi-process, multi-tenant, or durable database backend;
- you are hardening an agent that previously relied on "every scoped tool/skill is active" and need to name capabilities explicitly;
- you are adopting 0.0.6 persistence, checkpoints/leases, workflows, structured output, multimodality, or explicit tool safety for the first time.

If you are new to Prism, start at [Session stores](session-stores.md) and [Agent/session runtime](agent-session-runtime.md) instead.

## Inputs / request


There is no runtime import for this page. The migrations below use these surfaces:

| Surface | Where | Migration role |
| --- | --- | --- |
| `SessionStore` | `@arnilo/prism` | Runtime seam swapped from memory/JSONL to DB. |
| `createSqlitePersistence` | `@arnilo/prism-session-store-sqlite` | Local durable session, ledger, query, checkpoint, and lease adapter. |
| `createPostgresPersistence` | `@arnilo/prism-session-store-postgres` | Multi-process pooled persistence with advisory-lock migrations. |
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

Runnable references: [`examples/workflow-sqlite-resume.ts`](../examples/workflow-sqlite-resume.ts), credential-gated [`examples/workflow-postgres-resume.ts`](../examples/workflow-postgres-resume.ts), and the network-free custom-adapter example [`examples/external-app-db-backed.ts`](../examples/external-app-db-backed.ts).

Step 1: replace the development store with a first-party adapter. Use PostgreSQL instead when multiple processes or sustained concurrent writers matter.

```ts
// Before: development store, single process.
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
const oldStore = createJsonlSessionStore("./sessions.jsonl");

// After: local durable adapter. The same object implements SessionStore,
// RunLedger, ProductionPersistenceStore, checkpoints, and leases.
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
const store = createSqlitePersistence({ filename: "./prism.db" });
```

Custom adapters remain supported through `SessionStore` / `ProductionPersistenceStore`; implement indexed `readBranchPath()` rather than full-session scans.

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

Prism 0.0.5 persistence adapters automatically apply additive schema step `002_usage_scope`, then `003_run_feedback`. Migration 003 creates immutable owned run/trace feedback with a run FK, cascade deletion, JSON tag/scorer/evaluation ID lists, and owner/run/trace cursor indexes. Existing rows are unchanged. Custom adapters may omit optional `ProductionPersistenceStore.feedback`; adopters implement `RunFeedbackStore` append/query/delete semantics and must verify exact linked-run ownership before insert.

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


- **Persistence remains host-configured.** Optional SQLite/PostgreSQL packages ship adapters and versioned setup, but hosts choose connection paths/pools, TLS, credentials, retention, tenant policy, and lifecycle. Core only consumes `SessionStore`, `RunLedger`, feedback, checkpoint, and lease contracts.
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


- [Evaluations](evaluations.md): optional `@arnilo/prism-evals` scorers/datasets/experiments over `AgentRunResult`.
- [AI SDK provider adapter](providers/ai-sdk.md): optional `@arnilo/prism-provider-ai-sdk` `LanguageModelV4` bridge.
- [Working and semantic memory](working-and-semantic-memory.md): optional `@arnilo/prism-memory` working/semantic recall primitives.
- [Retrieval-augmented generation](rag.md): optional text/Markdown chunk, index, retrieval, and citation helpers.
- [Web-standard server handler](server.md): optional authorized agent/workflow HTTP routes.
- [Supervisor delegation](supervisors.md) and [A2A interoperability](a2a.md): optional install only; core agent/workflow behavior is unchanged. Child factories now receive package-derived memory IDs and narrowing permission, while remote endpoints require exact HTTPS origin allow-lists.
- [MCP client/server exposure](mcp-tools.md): selected MCP tools/commands and bounded Web transport.
- [Database persistence](database-persistence.md): production contracts, reference schema, indexes, conditional append, retention, migrations, and custom adapters.
- [SQLite persistence](sqlite-persistence.md): local durable first-party adapter and writer ceiling.
- [PostgreSQL persistence](postgres-persistence.md): pooled multi-process adapter, TLS/pool ownership, and live gate.
- [Session stores](session-stores.md): `SessionStore` contract, `SessionAppendOptions`, `SessionAppendConflictError`, branch handles, `readBranchPath`.
- [Session stores and branching](session-stores-and-branching.md): detailed branch semantics and helper reference.
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` record shapes, redaction, and event/usage ordering.
- [Node JSONL session store](node-jsonl-session-store.md): development-only JSONL adapter and its limits.
- [Agent definitions](agent-definitions.md): declarative `AgentDefinition`, `resolveAgentDefinition`, and the explicit-capability-activation migration.
- [Context and skills](context-and-skills.md): `RunOptions.activeSkills`, `Skill.context`, `toolNames` enforcement.
- [Contribution registries](contribution-registries.md): strict `duplicate: "error"` mode for capability shadowing prevention.
- [Release and install](release-and-install.md): packaged surfaces and the offline test budget that gate these migrations.

Historical release migrations live in [history/](history/README.md).
