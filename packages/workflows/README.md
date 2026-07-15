# @arnilo/prism-workflows

Optional typed bounded DAG workflow orchestration for Prism. Defines acyclic workflows, schedules dependency-ready nodes with a Kahn worker pool, and emits package-local `WorkflowEvent`s. Agent nodes call public `AgentSession.run()` only.

Included through `@arnilo/prism-sdk` and `@arnilo/prism-all`, or install explicitly when only workflow orchestration is needed.

## Install

```bash
npm install @arnilo/prism-workflows @arnilo/prism
```

## Usage

```ts
import {
  defineWorkflow,
  runWorkflow,
  functionNode,
  agentNode,
  createMemoryWorkflowCheckpoints,
} from "@arnilo/prism-workflows";

const research = agentNode({
  agent: "researcher",
  input: (ctx) => ctx.workflowInput,
});
const draft = functionNode({
  execute: async (ctx) => `Draft from ${ctx.upstream.research}`,
});

const workflow = defineWorkflow({
  id: "research-draft",
  nodes: { research, draft },
  edges: [["research", "draft"]],
  limits: { maxNodes: 256, maxFanOut: 32, maxConcurrency: 4 },
});

const checkpoints = createMemoryWorkflowCheckpoints();
const result = await runWorkflow(workflow, { topic: "hooks" }, {
  agentFactory: (name) => agents.resolve(name).createSession(),
  checkpoints,
  ownership: { tenantId: "t1" },
  signal: AbortSignal.timeout(60_000),
  onEvent: (event) => console.log(event.type, event),
});
```

## Node kinds

| Kind | Factory | Behavior |
| --- | --- | --- |
| `agent` | `agentNode` | Runs `AgentSession` from `agentFactory` |
| `function` | `functionNode` | Host async function |
| `tool` | `toolNode` | Dispatches a `ToolDefinition` after `ExecutionPolicy` check |
| `conditional` | `conditionalNode` | Predicate; skips successors via `then`/`else` |
| `fan_out` | `fanOutNode` | Bounded map over a list |
| `join` | `joinNode` | Reduces an upstream array |

## Limits (defaults)

| Limit | Default |
| --- | ---: |
| `maxNodes` | 1000 |
| `maxFanOut` | 64 |
| `maxConcurrency` | 8 |
| `maxNodeOutputBytes` | 4 MiB |
| `maxCheckpointBytes` | 1 MiB |
| event buffer | 2048 |

## Checkpointing and host control

- `createMemoryWorkflowCheckpoints()` — in-process resume over core `createMemoryCheckpointStore()`
- `createWorkflowCheckpoints({ store: persistence.checkpoints })` — durable resume through generic core `CheckpointStore`
- SQLite/PostgreSQL checkpoint tables and queries are owned by their persistence packages, not this workflow package
- `cancelWorkflowRun()` — abort in-flight runs; mark orphaned durable checkpoints `aborted`
- `createWorkflowCommands()` — optional RPC `CommandDefinition[]` for `workflow.start` / `status` / `list` / `cancel` / `resume`
- `enqueueWorkflow()` + `createWorkflowCoordinator()` — bounded multi-process polling, atomic lease claims, heartbeat renewal, expiry takeover, and durable remote cancellation through `persistence.leases`

## Security

- Definitions are validated for cycles, unknown edges, and `maxNodes`.
- Tool nodes attach `workflowId` / `nodeId` to `ExecutionAction.metadata`.
- Checkpoints redact via `SecretRedactor` / `secrets` and enforce byte bounds.
- Resume fails closed on tenant, schema, and definition-hash mismatch.
- Cancellation uses `AbortSignal` / active-run registry and aborts in-flight agent sessions.
- Distributed workers use opaque lease tokens, ownership scopes, checkpoint CAS, and monotonic fencing tokens; stale workers cannot commit after takeover.

See [Workflows](../../docs/workflows.md) and [Workflow orchestration primitives](../../docs/workflow-orchestration-primitives.md).
