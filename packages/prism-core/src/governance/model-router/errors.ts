import type { ModelRouterDiagnostics } from "./types.js";

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
