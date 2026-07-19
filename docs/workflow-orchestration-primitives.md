# Workflow orchestration primitives

## What it does

This page freezes the Plan 057 Task 0 inventory and Task 1 adapter-contract lock for workflow orchestration. It maps existing `@arnilo/prism` orchestration, CLI/RPC, event, approval, and persistence seams; records capability gap **C-009** (workflow/graph orchestration); pins performance and security limits for Tasks 2–7; and documents the final public design for `@arnilo/prism-workflows`.

Interactive TUI (**C-012**) is **out of scope** for Plan 057 and deferred. Workflow start/status/cancel/resume is delivered through public package APIs and optional RPC/`CommandDefinition` bindings.

**Final Task 7 architecture (2026-07-14):** DAG/coordinator semantics remain package-local. Reusable versioned checkpoints, atomic leases, and bounded async event fan-in live in core as `CheckpointStore`, `LeaseStore`, and `EventMultiplexer`. Workflow adapters are thin domain facades; lease fencing plus checkpoint CAS prevents stale-worker commits.

**Phase 8 addendum (2026-07-15):** `@arnilo/prism-workflows` extends the same checkpoint JSON/state machine with `suspended` and terminal `denied` statuses, `suspend()`, persisted suspension/resume records, and `workflow_suspended` / `workflow_resumed` events. An approved resume requires the displayed checkpoint `expectedVersion`; the first checkpoint write CAS-claims it before node execution. Suspended runs are absent from coordinator `queued`/`running` polls, so no worker or polling loop remains active. No SQL migration or second approval store is required.

**Phase 11 addendum (2026-07-16):** schedules use a separate generic checkpoint namespace plus per-fire `LeaseStore` claims and deterministic queued-run IDs; SQLite/PostgreSQL need no workflow-specific table or migration. Background execution remains `enqueueWorkflow` + the existing coordinator. Nested workflow nodes call the same runner with inherited policy/ownership/checkpoint/event seams. Shared JSON state is validated, redacted, byte/history bounded, and checkpointed by version. Replay creates a new checkpoint with immutable source lineage and copied terminal evidence; approval-bearing prior paths cannot be copied.

## When to use it

- **Workflow package authors** should start here, then follow [Agent/session runtime](agent-session-runtime.md), [Agent loops](agent-loops.md), [Runs and usage ledger](runs-and-usage.md), [CLI/RPC](cli-rpc.md), and [Database persistence](database-persistence.md).
- **Host authors** use CLI/RPC and `CommandDefinition` as the non-interactive control seam for start/status/cancel/resume.
- **Core maintainers** own generic `CheckpointStore` and `EventMultiplexer`; workflow node/DAG vocabulary remains outside core.
- **Security reviewers** use the threat model and design matrix on this page as the acceptance baseline for Plan 057 Tasks 2–7.

## Inventory (2026-07-14 baseline)

Static review of `src/agents.ts`, `src/agent-loops.ts`, `src/rpc.ts`, `src/cli-runner.ts`, `src/execution-policy.ts`, `src/contracts.ts`, `src/session-stores.ts`, `src/security.ts`, `packages/coding-security/src/approval.ts`, `packages/session-store-sqlite/**`, `packages/session-store-postgres/**`, and docs under `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/agent-loops.md`, `docs/cli-rpc.md`, `docs/session-stores*.md`, `docs/runs-and-usage.md`, `docs/host-security.md`, `docs/tool-execution-primitives.md`, `docs/persistence-credentials-multimodality-primitives.md`, Plans 053–056.

### Orchestration and per-run control (shipped)

| Surface | Location | Behavior today | Workflow relevance |
| --- | --- | --- | --- |
| `AgentSession` | `src/agents.ts` | `run`, `prompt`, `compact`, `subscribe`, `abort`, `entries`, `checkout`, `fork`, `clone` | One agent session = one workflow **agent node** runtime; branch resume via `leafId` |
| Run exclusivity | `src/agents.ts` | One active `run()` per session; concurrent runs reject | Workflow scheduler owns one session per agent node or serializes runs per session |
| `AbortSignal` | `RunOptions.signal`, `session.abort()` | Bridges to assembly, provider, tools, compaction, retry | Workflow cancellation propagates `signal` to in-flight node runs |
| `AgentLoopStrategy` | `src/agent-loops.ts` | Replaceable per-run turn loop | **Not** multi-node DAG; workflow package orchestrates multiple runs |
| `singleShotLoop` | `src/agent-loops.ts` | Assemble → generate → tools (optional parallel `toolConcurrency`) → next turn | Default node behavior for agent nodes |
| `generateValidateReviseLoop` | `src/agent-loops.ts` | Generate → validate → revise with `Artifact*` callbacks | Pattern for validate/repair **within** one node; not cross-node DAG |
| `LoopContext` | `src/agent-loops.ts` | `assemble`, `generate`, `dispatchToolCall`, `appendMessage`, `emit`, `history`, `signal` | Custom loops can be workflow **function nodes** without reimplementing runtime |
| `maxToolRounds` / `toolConcurrency` | `AgentConfig` / `RunOptions` / `LoopContext` | Bounded tool turns; opt-in parallel dispatch with index-slot ordering | Workflow sets per-node limits; fan-out/join is workflow-owned |
| `CommandDefinition` | `src/contracts.ts` | Host RPC commands via `runRpcServer({ commands })` | Workflow package exposes optional `createWorkflowCommands()` for start/status/cancel/resume |
| Middleware | `src/middleware.ts` | Ordered hooks at provider/input/tool/compaction/retry/session boundaries | Workflow does not need new hooks for v1 |
| Compaction / retry | `src/compaction.ts`, `src/retry.ts` | Per-session/run policies | Workflow nodes inherit agent/session config; graph-level retry is package-owned |

**Frozen boundary:** Core owns single-session run lifecycle, provider turns, tool dispatch, store append, redaction, and `AgentEvent` emission. Multi-node dependency scheduling, typed node I/O mapping, fan-out/join, workflow checkpoints, and workflow run control belong in `@arnilo/prism-workflows`.

### CLI/RPC host seam (shipped)

| Surface | Location | Behavior today | Workflow relevance |
| --- | --- | --- | --- |
| `runCli` / `prism` bin | `src/cli-runner.ts` | `print`, `json`, `rpc` modes; thin `AgentSession` adapter | Non-interactive hosts stay on RPC/print; workflow control uses `command` RPC |
| `runRpcServer` | `src/rpc.ts` | LF-delimited JSON stdin/stdout; concurrent commands during active run | Hosts register workflow commands beside session commands |
| RPC commands | `src/rpc.ts` | `prompt`, `followUp`, `abort`, `state`, `messages`, `setModel`, `compact`, `switchSession`, `forkSession`, `cloneSession`, `checkout`, `command` | Workflow start/status/cancel/resume bind through `command` |
| Branch handles | `src/rpc.ts` | `handleId`, `sessionId`, `leafId`; fork does not overwrite parent handle | Agent-node resume reuses session/`leafId` from checkpoint metadata |
| Active-run rules | `src/rpc.ts` | Second `prompt`/`followUp` fails closed; `abort` immediate; events keep prompt `id` | Workflow scheduler must not overlap `run()` on the same session |
| JSON event mode | `src/cli-runner.ts` | One `{ type: "event", event: AgentEvent }` per line | Reference for structured streaming; workflow emits package-local `WorkflowEvent` |
| Discovery flags | `src/cli-runner.ts` | Opt-in `--discover`, `--agents-config`; no auto-activate | Workflow hosts wire registries explicitly; no hidden globals |

**Host-control decision (replaces TUI for Plan 057):** Feature-complete workflow control is programmatic (`runWorkflow` / `resumeWorkflow` / status helpers) plus optional RPC/`CommandDefinition` bindings. No interactive terminal package ships in this plan.

### Events and observability (shipped)

| Surface | Location | Behavior today | Workflow relevance |
| --- | --- | --- | --- |
| `AgentEvent` | `src/contracts.ts` | Normalized lifecycle, message, tool, compaction, retry, artifact, error variants | Per-session event stream; workflow may subscribe per agent node |
| `session.subscribe()` | `src/agents.ts` | Bounded `AsyncIterable<AgentEvent>`; default `maxQueuedEvents: 1024`, `overflow: "close"` | Workflow event adapter sets per-session bounds when observing agent nodes |
| `event_subscriber_overflow` | `src/agents.ts` | Subscriber closed after overflow notice | Workflow summarizer drops/coalesces; emits `workflow_event_overflow` |
| `redactAgentEvent` | `src/redaction.ts` | All subscriber/ledger events redacted when redactor active | Workflow persists only redacted node outputs/checkpoints |
| `RunLedger` | `src/contracts.ts` | Durable `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage` | Workflow run record + per-node run ids; serialized `ledgerChain` (R-004) |
| Provider/tool metadata | `docs/observability.md` | `provider_turn_*`, `ToolExecutionMetadata` | Workflow progress / node diagnostics |
| OpenTelemetry adapter | `@arnilo/prism-observability-opentelemetry` | Optional span/metric mapping | Workflow examples may attach |

**Final architecture (Task 6):** Core exports generic `createEventMultiplexer<T>()`. `@arnilo/prism-workflows` keeps its domain `WorkflowEvent` union but delegates bounded queues, source fan-in, overflow, abort, and close behavior to the core primitive.

### Approval and execution policy (shipped)

| Surface | Location | Behavior today | Workflow relevance |
| --- | --- | --- | --- |
| `PermissionPolicy` | `src/security.ts` | `tool:<name>:execute` before validation/execute | Workflow propagates host policy into tool/agent nodes |
| `ExecutionPolicy` | `src/execution-policy.ts` | `check(action)` → `ExecutionDecision`; `ExecutionAction` with `kind`, `paths`, `command`, `risk` | Dangerous workflow tool nodes attach `workflowId`/`nodeId` in `metadata` |
| `createCodingApprovalPolicy` | `packages/coding-security` | Roots, read-only, command rules, `approve` callback, cache scopes, timeout/abort | Host supplies `approve`; workflow does not own UI |
| `CodingApprovalFn` | `packages/coding-security` | `(request) => boolean \| Promise<boolean>` with `signal` | Host implements callback (CLI prompt, RPC, CI deny, etc.) |
| Tool blocked events | `AgentEvent` | `tool_execution_blocked` with `reason` | Surfaces as node failure / workflow event |
| MCP / shell trust | `docs/host-security.md` | Host configures transport, bounds, registration | Workflow examples document safe policy wiring |

**Gap:** No core `ApprovalHandler` type for non-coding actions. Hosts keep owning approval UX. Workflow package only requires that tool nodes honor existing `ExecutionPolicy` / permission seams with workflow/node metadata.

### Persistence and resume (shipped)

| Surface | Location | Behavior today | Workflow relevance |
| --- | --- | --- | --- |
| `SessionStore` | `src/contracts.ts` | Atomic append, idempotency, `expectedParentId`, branch fork | Agent-node session history; not workflow graph state |
| `readBranchPath` | `SessionStore` / `ProductionPersistenceStore` | Ancestor chain without full session scan | Resume agent node at `leafId` |
| `ProductionPersistenceStore` | `src/contracts.ts` | Cursor queries plus optional generic checkpoint and lease capabilities | Workflow adapter consumes versioned storage without SQL handles |
| SQLite / Postgres packages | `packages/session-store-*` | Session/run/query persistence + package-owned `prism_checkpoints` / `prism_leases` | Expose durable checkpoint and atomic lease capabilities |
| `RunRecord` / ownership | `src/contracts.ts` | `tenantId`, `accountId`, `userId`, `idempotencyKey` | Workflow run scoped to tenant; propagate to node runs |
| `SessionEntry` `kind: "custom"` | `src/contracts.ts` | Opaque `data` payload on branch | Dev-only checkpoint embedding; production uses dedicated workflow tables |
| Redaction before persist | `src/redaction.ts` | `redactSessionEntry`, `redactRunLedgerRecord` | Checkpoints must redact before write |

**Final architecture (Tasks 6–7):** Core exports database-neutral `CheckpointStore` / `LeaseStore` plus memory references. SQLite/PostgreSQL persistence exposes `checkpoints` and `leases`. Workflows adapt checkpoints and use leases for bounded polling, exclusive claims, heartbeat renewal, expiry takeover, durable cancellation, and fenced CAS writes; workflow code owns no database table.

## Capability gaps

| ID | Capability | Review rank | Status after Task 0 rework | Owner |
| --- | --- | ---: | --- | --- |
| C-009 | Workflow/graph orchestration | 9 | Task 7 shipped durable multi-process coordination (enqueue/claim/renew/takeover/fencing/cancel) | `@arnilo/prism-workflows` |
| C-012 | Interactive TUI | 12 | **Deferred / out of scope for Plan 057** | Future optional plan/package only |

## Rejected options

| Option | Why rejected |
| --- | --- |
| Workflow state machine in core | Violates bounded core; domain vocabulary stays in optional package |
| Full-screen or readline TUI in this plan | User deferred C-012; CLI/RPC already provide host control seams |
| Core `WorkflowEvent` / DAG types | Host apps without workflows should not import graph contracts |
| Core global approval UI | Host-owned; workflow only propagates policy metadata |
| Workflow-specific checkpoint tables | Replaced by generic core `CheckpointStore` implemented by persistence packages |
| Examples-only checkpoint snippets | Rejected; Task 3 shipped first-party adapters + resume/list/cancel APIs |

## ADR decision table (final through Task 7)

| Concern | Option A | Option B | **Chosen** | Rationale |
| --- | --- | --- | --- | --- |
| Orchestration location | Core DAG engine | Optional package over `AgentSession` | **Optional package** | Matches review gap #9 and loop-strategy boundary |
| Node execution | New runtime | Existing `session.run()` per agent node | **`session.run()`** | Reuse redaction, ledger, tools, abort |
| Validate/repair across nodes | Core workflow DSL | Package graph + `generateValidateReviseLoop` inside nodes | **Package graph** | Cross-node deps in workflow; within-node repair in loop |
| Checkpoints | Generic core `CheckpointStore` | Workflow-owned SQL adapters | **Core store + package facade** | Reusable capability; persistence packages own storage |
| Event fan-in | Generic core multiplexer | Package queue duplication | **Core multiplexer + package facade** | One bounded/abort-aware implementation |
| Distributed ownership | Process-local active map | Generic leases + package coordinator | **LeaseStore + fenced checkpoint CAS** | Atomic claims and monotonic fences prevent split brain across processes |
| Host control (no TUI) | Interactive terminal package | Public APIs + optional RPC/`CommandDefinition` | **Public APIs + optional commands** | Replaces former TUI Tasks for feature completeness |
| Approval prompts | Core `ApprovalHandler` | Durable workflow suspension + host `ExecutionPolicy` | **Checkpoint suspension** | Survives restart; approved tool execution still rechecks current host policy |
| Interactive TUI | Ship in Plan 057 | Defer C-012 | **Defer** | Explicit product decision after Task 0 |

## Locked package adapter contracts (Task 1)

These TypeScript shapes are the frozen public contracts for Tasks 2–3. Implementations live in `@arnilo/prism-workflows` only.

### Checkpoint adapter

```ts
import type { OwnershipScope, SecretRedactor } from "@arnilo/prism";

/** Schema version for checkpoint payload layout (package-owned). */
export const WORKFLOW_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "aborted";

export interface WorkflowNodeCheckpoint {
  readonly nodeId: string;
  readonly status: "pending" | "ready" | "running" | "succeeded" | "failed" | "skipped" | "aborted";
  /** Redacted, size-bounded node output. Omitted when pending/running/skipped. */
  readonly output?: unknown;
  readonly error?: { readonly message: string; readonly code?: string | number };
  readonly attempt?: number;
  /** Agent-node resume pointers only — never full transcripts. */
  readonly sessionId?: string;
  readonly leafId?: string;
  readonly runId?: string;
}

export interface WorkflowCheckpointValue {
  readonly schemaVersion: typeof WORKFLOW_CHECKPOINT_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly runId: string;
  readonly definitionHash: string;
  readonly status: WorkflowRunStatus;
  readonly readyNodeIds: readonly string[];
  readonly completedNodeIds: readonly string[];
  readonly nodes: Readonly<Record<string, WorkflowNodeCheckpoint>>;
  readonly workflowInput?: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly redacted: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkflowCheckpointSaveInput {
  readonly workflowId: string;
  readonly runId: string;
  /** Monotonic adapter version; conflict on stale write fails closed. */
  readonly version: number;
  readonly ownership?: OwnershipScope;
  readonly value: WorkflowCheckpointValue;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointRecord {
  readonly workflowId: string;
  readonly runId: string;
  readonly version: number;
  readonly ownership?: OwnershipScope;
  readonly value: WorkflowCheckpointValue;
  readonly updatedAt: string;
}

export interface WorkflowCheckpointLoadInput {
  readonly workflowId: string;
  readonly runId: string;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointListInput {
  readonly workflowId?: string;
  readonly ownership?: OwnershipScope;
  readonly status?: WorkflowRunStatus | readonly WorkflowRunStatus[];
  readonly cursor?: string;
  /** Default 100; hard-capped by package (see performance limits). */
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface WorkflowCheckpointListPage {
  readonly items: readonly WorkflowCheckpointRecord[];
  readonly nextCursor?: string;
}

/**
 * Package-local workflow checkpoint facade over core CheckpointStore.
 * Implementations MUST: redact before persist, enforce maxCheckpointBytes,
 * fail closed on tenant/version/schema mismatch, honor AbortSignal.
 */
export interface WorkflowCheckpointAdapter {
  save(input: WorkflowCheckpointSaveInput): Promise<void>;
  load(input: WorkflowCheckpointLoadInput): Promise<WorkflowCheckpointRecord | null>;
  list?(input: WorkflowCheckpointListInput): Promise<WorkflowCheckpointListPage>;
  delete?(input: WorkflowCheckpointLoadInput): Promise<boolean>;
}

export interface WorkflowCheckpointAdapterOptions {
  readonly maxCheckpointBytes?: number; // default 1 MiB
  readonly maxNodeOutputBytes?: number; // default 4 MiB
  readonly redactor?: SecretRedactor;
  /** Required secrets list when redactor omitted but secrets known. */
  readonly secrets?: readonly (string | undefined)[];
}
```

**Final factory contracts (Task 6):**

```ts
createMemoryWorkflowCheckpoints(options?: WorkflowCheckpointAdapterOptions): WorkflowCheckpointAdapter;
createWorkflowCheckpoints(options: WorkflowCheckpointAdapterOptions & {
  readonly store: import("@arnilo/prism").CheckpointStore;
}): WorkflowCheckpointAdapter;
```

First-party persistence packages own generic `prism_checkpoints` tables keyed by namespace/key. Workflow status and definition data remain inside the bounded/redacted checkpoint value; no workflow-specific SQL schema exists.

### Event merge adapter

```ts
import type { AgentEvent, AgentSession, SubscribeOptions } from "@arnilo/prism";

export type WorkflowEvent =
  | { readonly type: "workflow_started"; readonly workflowId: string; readonly runId: string; readonly timestamp: string }
  | { readonly type: "workflow_finished"; readonly workflowId: string; readonly runId: string; readonly status: WorkflowRunStatus; readonly timestamp: string }
  | { readonly type: "node_started"; readonly workflowId: string; readonly runId: string; readonly nodeId: string; readonly timestamp: string }
  | { readonly type: "node_finished"; readonly workflowId: string; readonly runId: string; readonly nodeId: string; readonly timestamp: string }
  | { readonly type: "node_failed"; readonly workflowId: string; readonly runId: string; readonly nodeId: string; readonly error: { readonly message: string; readonly code?: string | number }; readonly timestamp: string }
  | { readonly type: "node_skipped"; readonly workflowId: string; readonly runId: string; readonly nodeId: string; readonly reason?: string; readonly timestamp: string }
  | { readonly type: "checkpoint_saved"; readonly workflowId: string; readonly runId: string; readonly version: number; readonly timestamp: string }
  | {
      readonly type: "agent_event";
      readonly workflowId: string;
      readonly runId: string;
      readonly nodeId: string;
      readonly sequence: number;
      readonly event: AgentEvent; // already redacted by session.subscribe path
      readonly timestamp: string;
    }
  | {
      readonly type: "workflow_event_overflow";
      readonly workflowId: string;
      readonly runId: string;
      readonly droppedEvents: number;
      readonly maxQueuedEvents: number;
      readonly timestamp: string;
    };

export interface WorkflowEventMergeOptions {
  readonly workflowId: string;
  readonly runId: string;
  /** Default 2048. */
  readonly maxQueuedEvents?: number;
  readonly overflow?: "close" | "drop_oldest" | "drop_newest";
  readonly subscribeOptions?: SubscribeOptions; // forwarded per agent session
  readonly signal?: AbortSignal;
}

/**
 * Bounded fan-in of scheduler WorkflowEvents + optional per-node AgentSession
 * subscriptions. Deterministic order by (sequence, nodeId). Not a core type.
 */
export interface WorkflowEventBus {
  emit(event: WorkflowEvent): void;
  subscribe(): AsyncIterable<WorkflowEvent>;
  observeAgentNode(input: {
    readonly nodeId: string;
    readonly session: AgentSession;
  }): () => void; // unsubscribe / stop observing
  close(): void;
}

export function createWorkflowEventBus(options: WorkflowEventMergeOptions): WorkflowEventBus;
```

### Run control + optional RPC commands

```ts
export interface WorkflowRunHandle {
  readonly workflowId: string;
  readonly runId: string;
  readonly status: WorkflowRunStatus;
  readonly version: number;
}

export interface RunWorkflowOptions {
  readonly concurrency?: number;
  readonly checkpoints?: WorkflowCheckpointAdapter;
  readonly agentFactory?: (agentName: string) => AgentSession | Promise<AgentSession>;
  readonly runLedger?: import("@arnilo/prism").RunLedger;
  readonly ownership?: OwnershipScope;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: WorkflowEvent) => void;
  readonly eventBus?: WorkflowEventBus;
  readonly executionPolicy?: import("@arnilo/prism").ExecutionPolicy;
}

export function runWorkflow(
  workflow: WorkflowDefinition,
  input: unknown,
  options?: RunWorkflowOptions,
): Promise<WorkflowRunHandle & { readonly outputs: Readonly<Record<string, unknown>> }>;

export function resumeWorkflow(
  workflow: WorkflowDefinition,
  ref: { readonly runId: string; readonly workflowId?: string },
  options: RunWorkflowOptions & { readonly checkpoints: WorkflowCheckpointAdapter },
): Promise<WorkflowRunHandle & { readonly outputs: Readonly<Record<string, unknown>> }>;

export function getWorkflowRun(
  checkpoints: WorkflowCheckpointAdapter,
  input: WorkflowCheckpointLoadInput,
): Promise<WorkflowCheckpointRecord | null>;

export function listWorkflowRuns(
  checkpoints: WorkflowCheckpointAdapter,
  input?: WorkflowCheckpointListInput,
): Promise<WorkflowCheckpointListPage>;

/** Optional host binding — registers CommandDefinition entries for runRpcServer. */
export function createWorkflowCommands(input: {
  readonly workflows: Readonly<Record<string, WorkflowDefinition>> | ((id: string) => WorkflowDefinition | undefined);
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "signal">;
}): import("@arnilo/prism").CommandDefinition[];
```

Expected command names (Task 3): `workflow.start`, `workflow.status`, `workflow.list`, `workflow.cancel`, `workflow.resume`.

### Usage sketch

```ts
import {
  defineWorkflow,
  runWorkflow,
  resumeWorkflow,
  createWorkflowCheckpoints,
  createWorkflowEventBus,
  createWorkflowCommands,
  agentNode,
  functionNode,
} from "@arnilo/prism-workflows";
import { runRpcServer } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";

const persistence = createSqlitePersistence({ filename: "prism.db" });
const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });

const research = agentNode({ agent: "researcher", input: (ctx) => ctx.workflowInput });
const draft = agentNode({ agent: "writer", input: (ctx) => ({ outline: ctx.upstream.research }) });
const review = functionNode({ execute: async (ctx) => lint(ctx.upstream.draft) });

const workflow = defineWorkflow({
  id: "research-draft-review",
  revision: "2026-07-19.1",
  nodes: { research, draft, review },
  edges: [
    ["research", "draft"],
    ["draft", "review"],
  ],
  limits: { maxNodes: 256, maxFanOut: 32, maxConcurrency: 4 },
});

const bus = createWorkflowEventBus({ workflowId: workflow.id, runId: "pending" });
const result = await runWorkflow(workflow, { topic: "hooks" }, {
  agentFactory: (name) => agents.resolve(name).createSession(),
  checkpoints,
  runLedger: persistence,
  ownership: { tenantId: "t1" },
  signal: ac.signal,
  eventBus: bus,
  onEvent: (event) => sink.push(event),
});

await resumeWorkflow(workflow, { runId: result.runId }, {
  checkpoints,
  agentFactory,
  signal: ac.signal,
});

runRpcServer({
  createSession,
  commands: createWorkflowCommands({ workflows: { [workflow.id]: workflow }, checkpoints }),
});
```

**Scheduler:** Kahn topological sort, bounded worker pool, deterministic event ordering by `(sequence, nodeId)`.

**Nodes:** `agent` (runs `AgentSession`), `function` (async host fn), `tool` (dispatches registered tool with approval), `conditional` (skips downstream), `fanOut`/`join` (bounded list map).

**Checkpoints:** redacted node outputs + ready set + version + agent `sessionId`/`leafId` metadata; resume validates tenant and schema version.

**Run control:** `runWorkflow`, `resumeWorkflow`, status/list helpers, cancel via `AbortSignal`; optional `createWorkflowCommands()` for RPC hosts.

**Events:** package-local `WorkflowEvent` — not core `AgentEvent`.

## Performance limits (pinned)

| Surface | Limit | Default | Rationale |
| --- | --- | ---: | --- |
| Workflow `maxNodes` | Hard cap at validate | 1000 | 1k-node stress target in Task 5 |
| Workflow `maxFanOut` | Per fan-out node | 64 | Prevents unbounded dynamic lists |
| Workflow `maxConcurrency` | Global worker pool | 8 | Matches typical provider rate limits |
| Workflow `maxNodeOutputBytes` | Serialized checkpoint output | 4 MiB | Keeps DB rows bounded |
| Workflow `maxCheckpointBytes` | Full checkpoint blob | 1 MiB | Resume metadata only; not full transcripts |
| Workflow event buffer | Per run merge queue | 2048 | Coalesce node status; drop with `workflow_event_overflow` |
| Workflow list/status page size | Status helper default | 100 | Bounded run listing for hosts |
| Nested depth | Default / hard | 8 / 32 | Prevent recursive composition exhaustion |
| Shared state | Default / hard bytes | 64 KiB / 512 KiB | Keep node context/checkpoints bounded |
| State history | Default / hard snapshots | 32 / 128 | Preserve replay state without unbounded history |
| Replay lineage | Default / hard depth | 8 / 32 | Prevent replay-chain abuse |
| Schedule input | Default / hard bytes | 256 KiB / 1 MiB | Bound persisted trigger payload |
| Schedule due claims | Default / hard per poll | 16 / 256 | Bound one poll; idle waits 1s by default |

## Threat model and design matrix

| # | Scenario | Owner | Expected behavior |
| ---: | --- | --- | --- |
| 1 | Cyclic workflow definition | Workflow package | Validate at `defineWorkflow`; reject before run |
| 2 | Unbounded fan-out (dynamic list) | Workflow package | Cap `maxFanOut`; fail `node_failed` when exceeded |
| 3 | Resumed checkpoint tampered (wrong tenant/version) | Workflow adapter | Fail closed; no partial node execution |
| 4 | Checkpoint contains secrets | Workflow + redactor | Redact before persist; `redacted: true` metadata |
| 5 | Shell/tool approval during workflow | Host + workflow | Opt-in tool approval suspends before side effects; resume uses ownership + expected-version CAS, then rechecks current `ExecutionPolicy` with workflow/node metadata |
| 6 | Cancel during node execution | Workflow | `signal` abort → in-flight `session.abort()`; checkpoint marks `aborted` |
| 7 | Untrusted workflow definition file | Host | Load from trusted path only; schema-validate before `runWorkflow` |
| 8 | Node output passed to next node | Workflow | Size-bound; type validate; redact at boundary |
| 9 | Event subscriber overflow while observing agent nodes | Workflow | Throttle/coalesce; emit `workflow_event_overflow` once |
| 10 | Cross-tenant list/status query | Workflow adapter | Scope by ownership; never return other tenants' runs |
| 11 | RPC workflow cancel races session abort | Workflow commands | Cancel is idempotent; fails closed if run unknown/unauthorized |
| 12 | 1000-node workflow checkpoint growth | Workflow | Store ready set + bounded outputs only; no full transcript duplication |
| 13 | Two reviewers resume one suspension | Workflow adapter | Expected-version CAS claims checkpoint before execution; one succeeds, stale reviewer fails |
| 14 | Forged/cross-tenant resume | Workflow + host | Ownership and definition hash checked; declared schema requires host validator; payload redacted before persistence |
| 15 | Duplicate/crashed schedule fire | Workflow schedules | Per-fire lease, deterministic run ID, queued checkpoint idempotency, schedule CAS |
| 16 | Nested workflow broadens capability | Workflow runner | Child inherits parent tool/agent/policy/ownership/signal seams; bounded inherited depth |
| 17 | Replay mutates evidence or reuses approval | Workflow replay | New checkpoint + immutable lineage; source untouched; copied approval-bearing path rejected |
| 18 | State/history resource exhaustion | Workflow runner/checkpoint | Host validation plus state byte/history and aggregate checkpoint ceilings |

## Final primitive decisions (Task 1, superseded where noted by Task 6)

| Primitive | Needed in core? | Decision | Evidence |
| --- | --- | --- | --- |
| Generic `CheckpointStore` | **Yes (Task 6)** | Core contract/reference memory store; optional `ProductionPersistenceStore.checkpoints`; SQLite/PostgreSQL implementations | Removes raw DB handles and workflow-owned tables while preserving bounded/versioned/owned writes. |
| Core event multiplexer | **Yes (Task 6)** | `createEventMultiplexer<T>()`; `WorkflowEventBus` delegates fan-in/overflow/abort/close | Removes duplicate queue logic and remains domain-neutral. |
| Generic `LeaseStore` | **Yes (Task 7)** | Core contract/memory reference; optional `ProductionPersistenceStore.leases`; SQLite/PostgreSQL implementations | Reusable atomic ownership, expiry, opaque claims, and monotonic fencing for coordinators. |
| Core `ApprovalHandler` | **No** | Host `ExecutionPolicy` / `CodingApprovalFn` with `workflowId`/`nodeId` metadata | Coding-security already owns interactive/async approve callbacks; workflow must not invent a parallel UI type. |
| Core workflow types | **No** | Stay in `@arnilo/prism-workflows` | Prevents graph vocabulary leaking into non-workflow hosts. |
| Interactive TUI package | **No (Plan 057)** | Deferred (C-012); APIs + optional RPC commands | CLI/RPC `CommandDefinition` already is the host control seam. |

Task 1's original no-core choice was superseded by Task 6 after review. DAG, approval, and TUI decisions are unchanged.

### Generic persistence integration

`ProductionPersistenceStore` keeps its adapter-facing query methods and adds no generic SQL executor. Its optional `checkpoints?: CheckpointStore` property is the narrow write capability for versioned blobs. Session `kind: "custom"` entries could embed tiny checkpoint blobs for demos, but they:

- couple workflow resume to a single agent branch leaf,
- cannot list workflow runs across sessions with tenant filters without scanning entries,
- fight `maxCheckpointBytes` / pagination goals,
- would pollute session history with scheduler state.

Task 6 adds an optional generic capability instead of generic SQL execution:

```ts
const persistence = createSqlitePersistence({ filename: path });
const checkpoints = createWorkflowCheckpoints({ store: persistence.checkpoints });
```

### Event-multiplexing proof

| Requirement | Existing seam | Package responsibility |
| --- | --- | --- |
| Per-agent-node observation | `session.subscribe({ maxQueuedEvents, overflow })` | Call with finite bounds; map to `WorkflowEvent.agent_event` |
| Redaction on stream | `redactAgentEvent` before subscriber push | Do not re-emit raw events; never bypass session redaction |
| Multi-node fan-in | `createEventMultiplexer<T>()` | `WorkflowEventBus` maps sources and creates `workflow_event_overflow` |
| Deterministic order | Tool/index-slot ordering is per-session only | Order by `(sequence, nodeId)` in package |
| Abort | `signal` + `session.abort()` | Close bus; stop observing nodes |

The core multiplexer is domain-neutral and now supplies one bounded, abort-aware implementation for workflows and future async-source consumers.

### Adapter conformance matrix (Tasks 3 and 6 tests)

| Case | Expected |
| --- | --- |
| save → load round-trip (core memory/SQLite/Postgres) | Byte-identical redacted value; version preserved |
| stale `version` write | Fail closed; prior checkpoint retained |
| `schemaVersion` mismatch on resume | Fail closed; no node execution |
| ownership/`tenantId` mismatch on load/list | Fail closed / empty page |
| value exceeds `maxCheckpointBytes` | Reject before write |
| node output exceeds `maxNodeOutputBytes` | Reject/omit that output before checkpoint |
| secrets present + redactor/secrets option | Persisted JSON contains no raw secret; `redacted: true` |
| `signal` aborted during save/load | Abort without partial corrupt row |
| list pagination | Honors `limit` (default 100); opaque `nextCursor` |
| delete (optional) | Idempotent; subsequent load returns `null` |
| event bus overflow | Emits one `workflow_event_overflow`; respects policy |
| observe agent node after session redaction | `agent_event` payload already redacted |

### Core primitive boundary

Core owns only namespace/key/version/ownership checkpoint operations and generic async event fan-in. Workflow schema validation, redaction limits, statuses, node state, and `WorkflowEvent` payloads remain package-local.

## Implementation example

```ts
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";

// Workflow builds on these seams today — no new core imports required for prototyping.

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  store: createMemorySessionStore(),
});

const session = agent.createSession({ id: "s1" });
await session.run("Hi", { signal: AbortSignal.timeout(60_000) });

// RPC hosts embed the same runtime and can later register createWorkflowCommands():
// await runRpcServer({ stdin, stdout, createSession: () => agent.createSession(), commands });
```

## Extension and configuration notes

- `@arnilo/prism-workflows` is an optional workspace member; core `package.json` does not depend on it.
- Workflow agent nodes call public `AgentSession` APIs only; no imports from `src/agents.ts` internals.
- Workflow checkpoints adapt `ProductionPersistenceStore.checkpoints` (or any `CheckpointStore`); no raw database handles enter the workflow package.
- Multimodal and credential packages from Plan 056 compose unchanged in workflow examples (Task 4).
- `@arnilo/prism-workflows` is available directly and through `prism-sdk`/`prism-all`; installation does not start a worker or workflow.
- C-012 interactive TUI remains a future optional package if needed; it is not required for workflow feature completeness.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): single-session run surface workflow nodes call.
- [Agent loops](agent-loops.md): within-node validate/revise; custom `AgentLoopStrategy` for function-equivalent behavior.
- [Agent events](agent-events.md): per-session stream workflow may observe/merge.
- [CLI/RPC](cli-rpc.md): non-interactive host seam for optional workflow commands.
- [Runs and usage ledger](runs-and-usage.md): durable audit for workflow and agent runs.
- [Database persistence](database-persistence.md): optional generic `CheckpointStore` capability implemented by first-party persistence adapters.
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): Plan 056 inventory baseline.
- [Tool execution primitives](tool-execution-primitives.md): `ExecutionPolicy` and approval pattern.
- [Host security guide](host-security.md): fail-closed checklist for workflow hosts.
- [Performance limits](performance.md): subscriber queue defaults workflow tightens.
- [Review coverage (2026-07-14)](review-coverage-2026-07-14.md): C-009/C-012 traceability.
