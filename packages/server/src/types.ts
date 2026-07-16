import type {
  Agent,
  AgentSession,
  OwnershipScope,
  RunOptions,
  SecretRedactor,
} from "@arnilo/prism";
import type {
  RunWorkflowOptions,
  WorkflowCheckpointAdapter,
  WorkflowDefinition,
  WorkflowSchedules,
} from "@arnilo/prism-workflows";
import type { PrismServerLimits } from "./limits.js";

export type PrismServerOperation =
  | "agent.run"
  | "agent.stream"
  | "workflow.run"
  | "workflow.stream"
  | "workflow.status"
  | "workflow.cancel"
  | "workflow.resume"
  | "workflow.enqueue"
  | "workflow.replay"
  | "schedule.create"
  | "schedule.list"
  | "schedule.pause"
  | "schedule.resume"
  | "schedule.trigger"
  | "schedule.delete";

export interface PrismServerAuthorization {
  readonly ownership: OwnershipScope;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PrismServerAuthorizationInput {
  readonly request: Request;
  readonly operation: PrismServerOperation;
  readonly capabilityId: string;
  readonly signal: AbortSignal;
}

export type PrismServerAuthorizer = (
  input: PrismServerAuthorizationInput,
) => false | PrismServerAuthorization | Promise<false | PrismServerAuthorization>;

export interface PrismAgentExposure {
  readonly sessionFactory: (authorization: PrismServerAuthorization) => AgentSession | Promise<AgentSession>;
  readonly runOptions?: Omit<RunOptions, "ownership" | "signal" | "redactor">;
}

export interface PrismWorkflowExposure {
  readonly definition: WorkflowDefinition;
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly runOptions?: Omit<RunWorkflowOptions, "checkpoints" | "ownership" | "signal" | "redactor" | "eventBus" | "runId">;
}

export type PrismScheduleExposure = WorkflowSchedules | ((authorization: PrismServerAuthorization, signal: AbortSignal) => WorkflowSchedules | Promise<WorkflowSchedules>);

export interface CreatePrismHandlerOptions {
  readonly agents?: Readonly<Record<string, Agent | PrismAgentExposure>>;
  readonly workflows?: Readonly<Record<string, PrismWorkflowExposure>>;
  readonly schedules?: PrismScheduleExposure;
  readonly authorize: PrismServerAuthorizer;
  readonly basePath?: string;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly redactor?: SecretRedactor;
  readonly limits?: PrismServerLimits;
  readonly disconnectAborts?: boolean;
}

export type PrismRequestHandler = (request: Request) => Promise<Response>;

export class PrismServerError extends Error {
  constructor(
    message: string,
    readonly status = 500,
    readonly code = "ERR_PRISM_SERVER",
  ) {
    super(message);
    this.name = "PrismServerError";
  }
}
