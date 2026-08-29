import type {
  Agent,
  AgentEvent,
  AgentIdentity,
  AgentRunResult,
  CheckpointStore,
  OwnershipScope,
  PermissionPolicy,
  ResumeNestedRun,
  SecretRedactor,
  ToolEffectStore,
} from "@arnilo/prism";
import type { ResolvedSupervisorLimits, SupervisorLimits } from "./limits.js";

export interface DelegationRequest {
  readonly childId: string;
  readonly input: string;
  readonly threadId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly limits?: SupervisorLimits;
  readonly signal?: AbortSignal;
}

export interface DelegationChildContext {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly ownership: OwnershipScope;
  /** Parent-verified identity; child factories cannot widen it. */
  readonly identity?: AgentIdentity;
  /** One shared durable effect store for every child run. */
  readonly effectStore?: ToolEffectStore;
  readonly resourceId: string;
  readonly threadId: string;
  readonly permission: PermissionPolicy;
  readonly signal: AbortSignal;
  delegate(request: DelegationRequest): Promise<AgentRunResult>;
}

export interface SupervisorChild {
  readonly description?: string;
  readonly permission?: PermissionPolicy;
  readonly limits?: SupervisorLimits;
  createAgent(context: DelegationChildContext): Agent | Promise<Agent>;
}

export interface DelegationHookDecision {
  readonly allowed?: boolean;
  readonly reason?: string;
  readonly input?: string;
  readonly limits?: SupervisorLimits;
  readonly permission?: PermissionPolicy;
}

export interface DelegationHookInput {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly path: readonly string[];
  readonly input: string;
  readonly limits: ResolvedSupervisorLimits;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
}

export interface DelegationCompletion {
  readonly childId: string;
  readonly delegationId: string;
  readonly depth: number;
  readonly status: AgentRunResult["status"] | "rejected";
  readonly text: string;
  readonly usage?: AgentRunResult["usage"];
  readonly error?: string;
}

export interface SupervisorHooks {
  before?(input: DelegationHookInput): DelegationHookDecision | Promise<DelegationHookDecision>;
  after?(completion: DelegationCompletion): void | Promise<void>;
}

export type SupervisorEvent =
  | {
      readonly type: "delegation_started";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly resourceId: string;
      readonly threadId: string;
    }
  | {
      readonly type: "delegation_finished";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly status: AgentRunResult["status"];
      readonly totalTokens: number;
    }
  | {
      readonly type: "delegation_rejected";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly reason: string;
    }
  | {
      readonly type: "delegation_error";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly error: string;
    }
  | {
      readonly type: "delegation_child_event";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly childEvent: AgentEvent;
    }
  | {
      readonly type: "delegation_child_events_capped";
      readonly childId: string;
      readonly delegationId: string;
      readonly depth: number;
      readonly maxChildEvents: number;
    };

export interface CreateSupervisorOptions {
  readonly id?: string;
  readonly ownership: OwnershipScope;
  /** Optional parent-verified identity, propagated unchanged to every child. */
  readonly identity?: AgentIdentity;
  /** Optional parent effect store, propagated unchanged to every child. */
  readonly effectStore?: ToolEffectStore;
  readonly children: Readonly<Record<string, SupervisorChild>>;
  readonly permission?: PermissionPolicy;
  readonly limits?: SupervisorLimits;
  readonly hooks?: SupervisorHooks;
  readonly redactor?: SecretRedactor;
  /**
   * Opt-in: project a redacted, capped milestone subset of child `AgentEvent`s
   * (`agent_started`/`finished`/`suspended`/`denied` and tool-execution events)
   * onto the supervisor stream as `delegation_child_event`. Default off — the
   * stream is unchanged when unset/false. Full per-token streaming is out of scope.
   */
  readonly childEvents?: boolean;
  /**
   * Durable child runs: with `checkpoints` + `definitionRevision`, every child runs with
   * `interruptBeforeTool`; a child that suspends on pending decisions throws
   * `AgentDelegationSuspendedError` so the hosting root run can surface them.
   */
  readonly checkpoints?: CheckpointStore;
  /** Host-authored revision shared by child durable runs; bump on policy/definition change. */
  readonly definitionRevision?: string;
}

export interface Supervisor {
  delegate(request: DelegationRequest): Promise<AgentRunResult>;
  /**
   * Routes root-run decisions back to the suspended child. Pass as `resumeNestedRun` in the
   * root run's `runState` (sticky auto-apply) and every `resumeAgentRun` options object.
   * Throws when `checkpoints`/`definitionRevision` are not configured.
   */
  readonly resumeNestedRun: ResumeNestedRun;
  subscribe(): AsyncIterable<SupervisorEvent>;
  readonly activeChildren: number;
}
