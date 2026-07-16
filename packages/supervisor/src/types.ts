import type { Agent, AgentRunResult, OwnershipScope, PermissionPolicy, SecretRedactor } from "@arnilo/prism";
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
  | { readonly type: "delegation_started"; readonly childId: string; readonly delegationId: string; readonly depth: number; readonly resourceId: string; readonly threadId: string }
  | { readonly type: "delegation_finished"; readonly childId: string; readonly delegationId: string; readonly depth: number; readonly status: AgentRunResult["status"]; readonly totalTokens: number }
  | { readonly type: "delegation_rejected"; readonly childId: string; readonly delegationId: string; readonly depth: number; readonly reason: string }
  | { readonly type: "delegation_error"; readonly childId: string; readonly delegationId: string; readonly depth: number; readonly error: string };

export interface CreateSupervisorOptions {
  readonly id?: string;
  readonly ownership: OwnershipScope;
  readonly children: Readonly<Record<string, SupervisorChild>>;
  readonly permission?: PermissionPolicy;
  readonly limits?: SupervisorLimits;
  readonly hooks?: SupervisorHooks;
  readonly redactor?: SecretRedactor;
}

export interface Supervisor {
  delegate(request: DelegationRequest): Promise<AgentRunResult>;
  subscribe(): AsyncIterable<SupervisorEvent>;
  readonly activeChildren: number;
}
