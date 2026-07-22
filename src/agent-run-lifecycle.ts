import type {
  Agent,
  AgentEvent,
  AgentRunRef,
  AgentRunResult,
  AgentRunResume,
  AgentRunStatusResult,
  OwnershipScope,
  SubscribeOptions,
} from "./contracts.js";
import { AgentRunStateError } from "./contracts.js";
import { loadAgentRunState, publicState } from "./agent-run-state.js";
import { resumeAgentRun, resumeAgentRunStream } from "./agents.js";
import type { CheckpointStore } from "./contracts.js";

export interface AgentRunLifecycleAgent {
  readonly agent: Agent;
  /** Current host-authored revision; it must match the stored revision. */
  readonly definitionRevision: string;
}

export interface AgentRunLifecycleOptions {
  readonly checkpoints: CheckpointStore;
  readonly resolveAgent: (input: {
    readonly agentId: string;
    readonly ownership?: OwnershipScope;
    readonly signal?: AbortSignal;
  }) => AgentRunLifecycleAgent | Promise<AgentRunLifecycleAgent>;
  readonly fencingToken?: number;
}

export interface AgentRunLifecycleRequest {
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  /** Adapter-selected capability; stored runs for another agent are non-enumerable. */
  readonly agentId?: string;
}

/** Bounded live-event options for a durable lifecycle resume. */
export interface AgentRunLifecycleStreamRequest extends AgentRunLifecycleRequest, SubscribeOptions {}

export interface AgentRunLifecycle {
  status(ref: AgentRunRef, options?: AgentRunLifecycleRequest): Promise<AgentRunStatusResult>;
  resume(ref: AgentRunRef, resume: AgentRunResume, options?: AgentRunLifecycleRequest): Promise<AgentRunResult>;
  resumeStream(ref: AgentRunRef, resume: AgentRunResume, options?: AgentRunLifecycleStreamRequest): AsyncIterable<AgentEvent>;
}

function assertAgentId(actual: string, expected: string | undefined): void {
  if (expected !== undefined && actual !== expected) throw new AgentRunStateError("Agent run capability mismatch");
}

/** Host capability for durable agent status/resume. Adapters supply authorized ownership only. */
export function createAgentRunLifecycle(options: AgentRunLifecycleOptions): AgentRunLifecycle {
  return {
    async status(ref, request = {}) {
      request.signal?.throwIfAborted();
      const { state, record } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      request.signal?.throwIfAborted();
      return { state: publicState({ ...state, version: record.version }), version: record.version };
    },
    async resume(ref, resume, request = {}) {
      request.signal?.throwIfAborted();
      const { state } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      const resolved = await options.resolveAgent({ agentId: state.agentId, ownership: request.ownership, signal: request.signal });
      request.signal?.throwIfAborted();
      return resumeAgentRun(resolved.agent, ref, resume, {
        checkpoints: options.checkpoints,
        ownership: request.ownership,
        fencingToken: options.fencingToken,
        definitionRevision: resolved.definitionRevision,
      });
    },
    async *resumeStream(ref, resume, request = {}) {
      request.signal?.throwIfAborted();
      const { state } = await loadAgentRunState(options.checkpoints, ref, request.ownership);
      assertAgentId(state.agentId, request.agentId);
      const resolved = await options.resolveAgent({ agentId: state.agentId, ownership: request.ownership, signal: request.signal });
      request.signal?.throwIfAborted();
      yield* resumeAgentRunStream(resolved.agent, ref, resume, {
        checkpoints: options.checkpoints,
        ownership: request.ownership,
        fencingToken: options.fencingToken,
        definitionRevision: resolved.definitionRevision,
        signal: request.signal,
        maxQueuedEvents: request.maxQueuedEvents,
        overflow: request.overflow,
      });
    },
  };
}
