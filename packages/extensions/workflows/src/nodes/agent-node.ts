import type { AgentEvent, Decision, JsonObject, RunResult, Session } from "@arnilo/prism";
import { WorkflowRuntimeError } from "../errors.js";
import { type RuntimeNodeState, suspend } from "../run/main.js";
import { WORKFLOWS_SERVICE, type WorkflowRuntime } from "../services.js";
import type { AgentNodeDefinition, RunWorkflowOptions, WorkflowNodeContext, WorkflowTransitionChannel } from "../types.js";
import { toAgentInput } from "./agent-input.js";

/** The `workspace` service members an agent node uses; structural so this package imports no tool package. */
interface WorkspaceLike {
  readonly worktree: {
    create(request: { sessionId: string }): Promise<{
      readonly path: string;
      readonly branch: string;
      dispose(options?: { force?: boolean }): Promise<void>;
    }>;
    /** The active worktree bound to the session, when this process still holds the binding. */
    bound?(
      sessionId: string,
    ): { readonly path: string; readonly branch: string; dispose(options?: { force?: boolean }): Promise<void> } | undefined;
    /** Re-adopts a worktree a killed process left behind; fails closed when it is gone or not the service's. */
    rebind?(request: { path: string; sessionId: string; branch?: string }): Promise<{
      readonly path: string;
      readonly branch: string;
      dispose(options?: { force?: boolean }): Promise<void>;
    }>;
  };
  diff(path: string): Promise<{ changes: readonly object[]; truncated: boolean }>;
}

type WorktreeHandle = Awaited<ReturnType<WorkspaceLike["worktree"]["create"]>>;

/** What a durable node run gives an agent attempt: its recorded state and the "session is open" checkpoint. */
export interface AgentNodeDurability {
  readonly nodeState: RuntimeNodeState;
  readonly opened?: () => Promise<void>;
}

export const WORKSPACE_SERVICE = "workspace";

export interface AgentNodeResult {
  output: unknown;
  sessionId?: string;
  leafId?: string;
}

/**
 * Runs one `agentNode` attempt: opens a child session linked to the workflow run, optionally binds a
 * worktree, runs the agent, and reports the diff as `agent.file` package events (`source: "diff"`).
 */
export async function executeAgentNode(
  node: AgentNodeDefinition,
  ctx: WorkflowNodeContext,
  options: RunWorkflowOptions,
  bus: WorkflowTransitionChannel,
  activeSessions: Map<string, Session>,
  durable?: AgentNodeDurability,
): Promise<AgentNodeResult> {
  const prism = options.parent?.prism ?? options.prism;
  let workspace: WorkspaceLike | undefined;
  if (node.worktree) {
    workspace = prism?.services.consume<WorkspaceLike>(WORKSPACE_SERVICE);
    if (!workspace) {
      throw new WorkflowRuntimeError(
        `Agent node "${ctx.nodeId}" needs the "workspace" service for worktree: true; none is provided`,
        "missing_service",
      );
    }
  }
  // Set only by `resumeWorkflow` for a node the process died inside; a retry in one run opens a new session.
  const priorSessionId = durable?.nodeState.resumeSession ? durable.nodeState.sessionId : undefined;
  const priorWorktree = durable?.nodeState.resumeSession ? durable.nodeState.worktree : undefined;
  if (durable) durable.nodeState.resumeSession = false;
  const session = node.session
    ? await node.session(ctx)
    : priorSessionId
      ? await node.agent.session({ id: priorSessionId, ownership: options.ownership })
      : await node.agent.session({
          ownership: options.ownership,
          parent: {
            ...(options.parent ? { sessionId: options.parent.session.id } : {}),
            agentId: node.agent.id,
            workflowRunId: ctx.runId,
          },
        });
  activeSessions.set(ctx.nodeId, session);
  const stopObserve = bus.observeAgentNode({ nodeId: ctx.nodeId, session });
  let worktree: WorktreeHandle | undefined;
  try {
    if (workspace) {
      if (priorWorktree) {
        // Never fall back to the main tree: a worktree this process cannot bind again is lost.
        let bound = workspace.worktree.bound?.(session.id);
        if (!bound) {
          // A killed process held the binding in memory; re-adopt the recorded worktree if it is still the service's.
          bound = await workspace.worktree
            .rebind?.({ path: priorWorktree.path, sessionId: session.id, branch: priorWorktree.branch })
            .catch(() => undefined);
        }
        if (!bound || bound.path !== priorWorktree.path) {
          throw new WorkflowRuntimeError(
            `Agent node "${ctx.nodeId}" cannot resume: its worktree ${priorWorktree.path} is gone or no longer bound to session ${session.id}`,
            "worktree_lost",
          );
        }
        worktree = bound;
      } else {
        worktree = await workspace.worktree.create({ sessionId: session.id });
      }
    }
    if (durable) {
      durable.nodeState.sessionId = session.id;
      durable.nodeState.leafId = session.leafId;
      if (worktree) durable.nodeState.worktree = { path: worktree.path, branch: worktree.branch };
      await durable.opened?.();
    }
    const runOptions = {
      ...node.runOptions,
      signal: ctx.signal,
      limits: node.runOptions?.limits ?? options.limits,
      ownership: options.ownership,
      principal: options.principal,
      redactor: options.redactor,
      runLedger: options.runLedger,
      metadata: { workflowId: ctx.workflowId, nodeId: ctx.nodeId, runId: ctx.runId },
    };
    const runResult =
      priorSessionId && ctx.resume
        ? await resumeChild(session, ctx, runOptions)
        : await session.run(toAgentInput(node.input ? await node.input(ctx) : ctx.workflowInput), runOptions);
    if (runResult.status === "suspended") {
      return {
        output: suspend({
          reason: "child_session_suspended",
          data: { nodeId: ctx.nodeId, childSessionId: session.id },
        }),
        sessionId: session.id,
        leafId: session.leafId,
      };
    }
    if (runResult.status === "failed") {
      // A failed child fails the node, carrying the child's error code (a driver's `profile_busy` is how `fanOut`
      // paces items). A run refused at admission did no work, so its worktree is released, not kept.
      const code = typeof runResult.error?.code === "string" ? runResult.error.code : "child_run_failed";
      if (code === "profile_busy" && worktree) await worktree.dispose({ force: true }).catch(() => undefined);
      throw new WorkflowRuntimeError(`Agent node "${ctx.nodeId}" child run failed: ${runResult.error?.message ?? "unknown error"}`, code);
    }
    let output = node.output
      ? await node.output(runResult, ctx)
      : runResult.text || (runResult.content.length > 0 ? runResult.content : null);
    if (worktree && workspace) {
      const { changes, truncated } = await workspace.diff(worktree.path);
      const runtime = prism?.services.consume<WorkflowRuntime>(WORKFLOWS_SERVICE);
      for (const change of changes) {
        runtime?.events.emit("agent.file", {
          ...(change as JsonObject),
          sessionId: session.id,
          workflowRunId: ctx.runId,
          nodeId: ctx.nodeId,
        });
      }
      output = { output, worktree: { path: worktree.path, branch: worktree.branch, truncated } };
    }
    return { output, sessionId: session.id, leafId: session.leafId };
  } finally {
    stopObserve();
    activeSessions.delete(ctx.nodeId);
    const dispose = typeof node.worktree === "object" ? node.worktree.dispose : "keep";
    if (worktree && dispose === "dispose") await worktree.dispose({ force: true }).catch(() => undefined);
  }
}

/**
 * Continues the child's suspended run with the reviewer's complete decision batch (`resume.input`).
 * `session.resume` rejects a partial, unknown, or duplicated batch, so the workflow never guesses.
 */
async function resumeChild(session: Session, ctx: WorkflowNodeContext, runOptions: object): Promise<RunResult> {
  const decisions = ctx.resume?.input;
  if (!Array.isArray(decisions)) {
    throw new WorkflowRuntimeError(
      `Agent node "${ctx.nodeId}" resumes a suspended child session; resume.input must be the complete Decision[] batch`,
      "invalid_resume",
    );
  }
  let status: RunResult["status"] = "completed";
  let runId = "";
  for await (const event of session.resume(decisions as Decision[], runOptions) as AsyncIterable<AgentEvent>) {
    if ("runId" in event && typeof event.runId === "string") runId = event.runId;
    if (event.type === "run.suspended") status = "suspended";
    else if (event.type === "run.failed") status = "failed";
    else if (event.type === "run.completed") status = event.status;
  }
  const messages = await session.messages();
  const message = [...messages].reverse().find((entry) => entry.role === "assistant");
  const content = message?.content ?? [];
  return {
    sessionId: session.id,
    runId,
    status,
    leafId: session.leafId,
    text: content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
    content,
    ...(message ? { message } : {}),
    messages: [],
  } as RunResult;
}
