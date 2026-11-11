import { type AgentEvent, type JsonObject, type JsonValue, type PackageAPI, type SessionContext } from "@arnilo/prism";
import { WorkflowRuntimeError } from "./errors.js";
import { createWorkflowTransitionChannel } from "./events.js";
import type { SchedulerState } from "./run/main.js";
import { runWorkflow } from "./run.js";
import { WORKFLOWS_SERVICE, type WorkflowRuntime } from "./services.js";
import type {
  GateNodeOutput,
  RunWorkflowOptions,
  WorkflowDefinition,
  WorkflowEventInput,
  WorkflowRunResult,
  WorkflowTransitionChannel,
} from "./types.js";
import { assertWithinBytes, combineSignals, createRunId, redactValue } from "./util.js";

export const WORKFLOW_EVENTS = {
  nodeStarted: "workflow.node.started",
  nodeCompleted: "workflow.node.completed",
  nodeFailed: "workflow.node.failed",
  gate: "workflow.gate",
  suspended: "workflow.suspended",
  /** Stream-only (never persisted): the live stream closed because the consumer fell behind. */
  notice: "workflow.notice",
} as const;

export interface WorkflowParentSession {
  readonly prism: PackageAPI;
  /** The bound context from a command, hook, or tool on the host's parent session. */
  readonly session: SessionContext;
}

export interface WorkflowPackageEvent {
  readonly type: "package.event";
  readonly package: "@arnilo/prism-extensions/workflows";
  readonly name: (typeof WORKFLOW_EVENTS)[keyof typeof WORKFLOW_EVENTS];
  readonly sessionId: string;
  readonly runId: string;
  readonly data: JsonObject;
}

export interface StartWorkflowOptions extends Omit<RunWorkflowOptions, "parent" | "prism" | "transitions">, WorkflowParentSession {
  /** Bound on queued, unread stream events; overflow closes the stream after a `workflow.notice`. */
  readonly maxQueuedEvents?: number;
}

/** One item of the merged stream: a workflow transition or a child session event (which keeps its `origin`). */
export type WorkflowStreamEvent = WorkflowPackageEvent | AgentEvent;

export interface WorkflowRun {
  readonly id: string;
  readonly parentSessionId: string;
  result(): Promise<WorkflowRunResult>;
  /**
   * Single-consumer, bounded stream merging the redacted `workflow.*` transitions with every child
   * session's events in arrival order. Overflow closes the stream after a `workflow.notice`.
   */
  stream(): AsyncIterable<WorkflowStreamEvent>;
  /** Steers the node's active child session(s); rejects with `node_not_running` when none is active. */
  steer(nodeId: string, input: string): Promise<void>;
  /** Aborts every active child and the run; `result()` then reports `aborted`. */
  abort(reason?: unknown): void;
}

/** Start on the caller's host session. The workflows package's command supplies its bound context. */
export function startWorkflow(workflow: WorkflowDefinition, input: unknown, options: StartWorkflowOptions): WorkflowRun {
  const runId = options.runId ?? createRunId();
  const transitions = createWorkflowTransitionChannel({
    workflowId: workflow.id,
    runId,
    parentSessionId: options.session.id,
    maxQueuedEvents: options.maxQueuedEvents,
  });
  const parent = { prism: options.prism, session: options.session };
  const controller = new AbortController();
  const signal = combineSignals([options.signal, controller.signal]);
  const result = runWorkflow(workflow, input, { ...options, signal, runId, transitions, parent }).finally(() => transitions.close());
  // A stream-only consumer may attach to result after completion; preserve rejection for that caller.
  void result.catch(() => undefined);
  return {
    id: runId,
    parentSessionId: options.session.id,
    result: () => result,
    stream: transitions.stream,
    async steer(nodeId, text) {
      if (!transitions.steer(nodeId, text)) {
        throw new WorkflowRuntimeError(`Node "${nodeId}" has no active child session to steer`, "node_not_running");
      }
    },
    abort(reason) {
      controller.abort(reason);
      transitions.abort(reason);
    },
  };
}

const parentWrites = new WeakMap<SessionContext, Promise<void>>();

/** One path for durable writes and live delivery. A failed append prevents emission and node progress. */
export function createWorkflowEmitter(state: SchedulerState, options: RunWorkflowOptions, channel: WorkflowTransitionChannel) {
  return async (event: WorkflowEventInput): Promise<void> => {
    channel.emit(event);
    const parent = options.parent;
    if (!parent) return;
    const nodeId = "nodeId" in event ? event.nodeId : event.type === "workflow_suspended" ? event.suspension.nodeId : undefined;
    if (!nodeId) return;
    const node = state.nodes.get(nodeId)!;
    let name: WorkflowPackageEvent["name"];
    let status: string;
    switch (event.type) {
      case "node_started":
        name = WORKFLOW_EVENTS.nodeStarted;
        status = "running";
        break;
      case "node_finished":
        name = WORKFLOW_EVENTS.nodeCompleted;
        status = "succeeded";
        break;
      case "node_failed":
        name = WORKFLOW_EVENTS.nodeFailed;
        status = node.status;
        break;
      case "node_skipped":
        name = WORKFLOW_EVENTS.nodeCompleted;
        status = "skipped";
        break;
      case "workflow_suspended":
        name = WORKFLOW_EVENTS.suspended;
        status = "suspended";
        break;
      default:
        return;
    }
    const data: Record<string, JsonValue> = {
      workflowRunId: state.runId,
      nodeId,
      attempt: node.attempt ?? 0,
      superstep: "iteration" in event && event.iteration !== undefined ? event.iteration : (state.superstep ?? 0),
      status,
      ...(node.sessionId ? { childSessionId: node.sessionId } : {}),
      ...(event.type === "node_failed" ? { reason: "node_failed" } : {}),
      ...(event.type === "workflow_suspended" ? { reason: "review_required" } : {}),
    };
    const records: { name: WorkflowPackageEvent["name"]; data: JsonObject }[] = [{ name, data }];
    const definition = state.workflow.nodes[nodeId]!;
    if (event.type === "node_finished" && (definition.kind === "route" || definition.kind === "conditional")) {
      const route =
        definition.kind === "route"
          ? (node.output as string[])
          : ((node.output ? (definition.then ?? state.successors.get(nodeId)) : definition.else) ?? []);
      records.push({ name: WORKFLOW_EVENTS.gate, data: { ...data, route: [...route] } });
    }
    if (event.type === "node_finished" && (definition.kind === "gate" || definition.kind === "human_gate")) {
      const result = node.output as GateNodeOutput;
      records.push({
        name: WORKFLOW_EVENTS.gate,
        data: result.pass ? { ...data, pass: true } : { ...data, pass: false, reason: result.reason, route: [...result.route] },
      });
    }
    const runtime = parent.prism.services.require<WorkflowRuntime>(WORKFLOWS_SERVICE);
    const log = runtime.log;
    const writes = (parentWrites.get(parent.session) ?? Promise.resolve()).then(async () => {
      for (const record of records) {
        const redacted = redactValue(record, options.redactor);
        assertWithinBytes(redacted, 16 * 1024, "Workflow transition");
        await log.append(parent.session, redacted);
        // The session log applies the agent's redactor and resolved credentials as well.
        const stored = log.entries(parent.session).at(-1)!;
        const persistedData = stored.data as JsonObject;
        runtime.events.emit(record.name, persistedData);
        channel.publish({
          type: "package.event",
          package: "@arnilo/prism-extensions/workflows",
          name: record.name,
          data: persistedData,
          sessionId: parent.session.id,
          runId: state.runId,
        });
      }
    });
    parentWrites.set(
      parent.session,
      writes.catch(() => undefined),
    );
    await writes;
  };
}
