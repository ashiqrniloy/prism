import type { ModelRouterDiagnostics } from "./types.js";

export const MODEL_ROUTER_ERROR_CODES = {
  ALLOW_LIST: "ERR_PRISM_MODEL_ROUTER_ALLOW_LIST",
  RESIDENCY: "ERR_PRISM_MODEL_ROUTER_RESIDENCY",
  BUDGET: "ERR_PRISM_MODEL_ROUTER_BUDGET",
  RATE_LIMIT: "ERR_PRISM_MODEL_ROUTER_RATE_LIMIT",
  CIRCUIT: "ERR_PRISM_MODEL_ROUTER_CIRCUIT",
  IDENTITY: "ERR_PRISM_MODEL_ROUTER_IDENTITY",
  STATE: "ERR_PRISM_MODEL_ROUTER_STATE",
  ASYNC_STATE: "ERR_PRISM_MODEL_ROUTER_ASYNC_STATE",
  ASYNC_REQUIRED: "ERR_PRISM_MODEL_ROUTER_ASYNC_REQUIRED",
  POLICY: "ERR_PRISM_MODEL_ROUTER_POLICY",
  VALIDATION: "ERR_PRISM_MODEL_ROUTER_VALIDATION",
  LIMITS: "ERR_PRISM_MODEL_ROUTER_LIMITS",
  ATTEMPTS: "ERR_PRISM_MODEL_ROUTER_ATTEMPTS",
  UNKNOWN_PROVIDER: "ERR_PRISM_MODEL_ROUTER_UNKNOWN_PROVIDER",
} as const;

export type ModelRouterErrorCode = (typeof MODEL_ROUTER_ERROR_CODES)[keyof typeof MODEL_ROUTER_ERROR_CODES];

export class ModelRouterError extends Error {
  readonly code: string;
  readonly diagnostics?: ModelRouterDiagnostics;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(
    message: string,
    code = "ERR_PRISM_MODEL_ROUTER",
    diagnostics?: ModelRouterDiagnostics,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ModelRouterError";
    this.code = code;
    this.diagnostics = diagnostics;
    this.details = details;
  }
}
