# Execution Timeline

## What it does

`ExecutionTimeline` is a frozen, JSON-serializable view-model that reconstructs what an agent or workflow run did: initial input, each step with optional input/output, and the terminal result. One type powers both host cockpit waterfalls and trajectory evaluation scorers.

APIs in `@arnilo/prism-core/governance/observability`:

- `projectAgentTimeline(events, options)` — fold live `AgentEvent[]` into a timeline
- `projectTraceTimeline(trace, options)` — fold an `EvaluationTrace` (from persistence) into a timeline
- `projectWorkflowTimeline(events, options)` — fold `WorkflowEvent[]` + optional checkpoint into a timeline
- `createTimelineFolder(options)` — incremental folder for SSE/cockpit live updates
- `createWorkflowTimelineFolder(options)` — incremental folder for workflow events
- `summarizeTimeline(timeline)` — fast cockpit summary (duration, tool counts capped at 64, tokens, cost)
- `summarizeSession(timelines)` — multi-run conversation/session rollups without double counting

## When to use it

Use `projectAgentTimeline` when you have a completed run's events in memory and need to render a waterfall, score a trajectory, or serialize for audit.

Use `createTimelineFolder` when you are streaming events from `session.subscribe()` and need live updates — push events one at a time and call `snapshot()` to get the current timeline.

Use `projectTraceTimeline` when you have an `EvaluationTrace` from `createPersistenceTraceResolver` and want the same timeline shape as a live fold.

Use `projectWorkflowTimeline` when you have workflow events and optionally a checkpoint — node outputs from the checkpoint are joined into workflow node steps when the content policy allows I/O.

Do not use the dev inspector folding logic (`packages/prism-coding-tools/src/dev/ui/inspector.ts`) for production — it is a composition-only browser asset, not an exported projector.

## Inputs / request

### Content-capture policy

| Mode | Timeline contains | Default |
| --- | --- | --- |
| `"metadata"` | kinds, names, status, timings, usage, error codes | ✅ |
| `"redacted_io"` | input/output after `SecretRedactor`, byte-capped per step | |
| `"full_io"` | redactor still runs (secrets never pass); host accepts residual content | |

### Projection options

```ts
interface TimelineProjectionOptions {
  readonly content?: TimelineContentPolicy;    // default "metadata"
  readonly redactor?: SecretRedactor;          // required when content ≠ "metadata"
  readonly maxSteps?: number;                  // default 1,000; hard 10,000
  readonly maxStepIoBytes?: number;            // default 16,384; hard 262,144
  readonly traceId?: string;                   // explicit OTel trace ID to attach
  readonly instrumentation?: { traceId(runId: string): string | undefined }; // auto-resolve traceId from OTel handle
}
```

### Workflow projection options

```ts
interface WorkflowTimelineProjectionOptions extends TimelineProjectionOptions {
  readonly checkpoint?: WorkflowCheckpointValue;
}
```

## Outputs / result

### `ExecutionTimeline`

```ts
interface ExecutionTimeline {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly sessionId?: string;
  readonly workflowId?: string;
  readonly workflowRevision?: string;
  readonly traceId?: string;
  readonly status: string;
  readonly stopReason?: AgentFinishReason;
  readonly stopDetail?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input?: unknown;
  readonly result?: unknown;
  readonly usage?: Usage;
  readonly steps: readonly ExecutionStep[];
  readonly redacted: boolean;
  readonly content: TimelineContentPolicy;
}
```

### `ExecutionStep`

```ts
interface ExecutionStep {
  readonly id: string;
  readonly parentId?: string;
  readonly kind: ExecutionStepKind;
  readonly name: string;
  readonly order: number;
  readonly status: ExecutionStepStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly error?: ErrorInfo;
  readonly usage?: Usage;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
```

Step kinds: `"run"`, `"turn"`, `"provider"`, `"tool"`, `"guardrail"`, `"delegation"`, `"compaction"`, `"attention"`, `"retry"`, `"hitl"`, `"artifact"`, `"workflow_node"`, `"loop_iteration"`, `"nested_workflow"`.

`attention_compiled` folds into a one-step `"attention"` entry (status `succeeded`) whose metadata carries the measured counts (`used`, `usedAfter`, `inputCap`, `triggerRatio`, `droppedThinkingTurns`, `stubbedToolResults`, `stubbedBytes`, `truncated`); under-ratio turns emit no event, so they add no step.

Step statuses: `"running"`, `"succeeded"`, `"failed"`, `"blocked"`, `"skipped"`, `"suspended"`, `"denied"`, `"aborted"`.

Tree structure: steps are a flat ordered array. Tree via `parentId` (run → turn → provider/tool). Scorers iterate the flat array; UIs that need nesting walk `parentId`.

## Examples

### Live cockpit fold

```ts
import { createTimelineFolder, summarizeTimeline } from "@arnilo/prism-core/governance/observability";

const folder = createTimelineFolder({ content: "metadata" });
for await (const event of session.subscribe()) {
  folder.push(event);
  const timeline = folder.snapshot();
  renderWaterfall(timeline.steps); // host UI
}
```

### Offline trace fold

```ts
import { projectTraceTimeline } from "@arnilo/prism-core/governance/observability";

const trace = await traceResolver({ ownership, sessionId, runId });
const timeline = projectTraceTimeline(trace, {
  content: "redacted_io",
  redactor: createSecretRedactor(secrets),
});
// timeline.steps.map(s => [s.order, s.kind, s.name, s.status])
```

### Workflow fold with checkpoint outputs

```ts
import { projectWorkflowTimeline } from "@arnilo/prism-core/governance/observability";

const timeline = projectWorkflowTimeline(workflowEvents, {
  content: "redacted_io",
  checkpoint: await checkpoints.load({ workflowId, runId, ownership }),
});
// Node outputs appear on workflow_node steps when checkpoint is provided.
```

See runnable host demo in `examples/execution-timeline.ts` for offline workflow timeline projection, cockpit summary, and Mermaid diagram export.

### Stop reasons

Run-level `stopReason` mirrors `agent_finished.finishReason` when the loop stopped on a ceiling or a host turn policy (`"host_policy"`); `status` reads `finished:<stopReason>` for those runs and `succeeded` for a natural end. `stopDetail` carries the host's `turnPolicy.stop` reason, bounded to 256 bytes and redacted at the runtime boundary. See [Runs and usage ledger § Clean stops and stop reasons](runs-and-usage.md#clean-stops-and-stop-reasons).

## Bounds

| Dimension | Default | Hard cap |
| --- | --- | --- |
| Max steps | 1,000 | 10,000 |
| Per-step I/O bytes | 16 KiB | 256 KiB |
| Total timeline bytes | 4 MiB | 32 MiB (eval trace envelope) |

Exceeding `maxSteps` throws `TimelineError` with code `ERR_PRISM_TIMELINE_BOUNDS`. Oversize I/O per step is truncated with a marker string, not thrown.

## Security and performance notes

- Default `"metadata"` content policy emits zero prompts, tool arguments, tool results, or node payloads.
- `"redacted_io"` and `"full_io"` always run `SecretRedactor` — secrets never survive into the timeline.
- Oversize I/O is truncated; unredactable steps omit I/O and set `redacted: true`.
- Ownership is not checked in the projector — callers must supply already-authorized events. `projectTraceTimeline` consumes traces from `createPersistenceTraceResolver`, which already enforces ownership.
- Low-cardinality metadata only; `metadata` on steps must not contain free-text, session IDs, or credentials.
- Incremental `push` is O(1) per event aside from I/O redaction. No O(n²) rebuilds.

## Related APIs

- [Observability](observability.md): OTel span hierarchy and provider capture policy.
- [Agent events](agent-events.md): full `AgentEvent` union and subscriber semantics.
- [Evaluations](evaluations.md): trajectory scorers consume `ScorerInput.timeline`.
- [Workflows](workflows.md): `WorkflowEvent` stream, `WorkflowCheckpointValue` for node outputs, and `WorkflowGraphRunView` for DAG topology/status overlay (graph overlays carry status/timing only; full I/O payloads remain on `ExecutionTimeline`).
- [Runs and usage ledger](runs-and-usage.md): `EvaluationTrace` persistence path.
