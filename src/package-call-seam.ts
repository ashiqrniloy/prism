import type { AgentEvent, ModelConfig, ProviderRequest, Usage } from "./contracts.js";
import type { HookBus } from "./hooks/types.js";

/**
 * Kernel-internal seam on a {@link SessionContext} view: what a package's model call needs from the session it was
 * given. Carried under a symbol that no barrel exports, so only the kernel's own package loader reads it and a
 * hand-built `SessionContext` simply has none (the call then runs on the agent's bus and charges no run).
 */
export const PACKAGE_CALL_SEAM = Symbol("prism.session.packageCall");

export interface PackageCallSeam {
  /** The session's bound hook bus: `model.request` / `model.call` handlers get `context.session`. */
  readonly hooks: HookBus;
  /** The session's own event path: stream, observe hooks and ledger. */
  emit(event: AgentEvent): void;
  /** The active run's redactor applied to a request (identity between runs); the agent's own redactor runs regardless. */
  redactRequest(request: ProviderRequest): ProviderRequest;
  /** The active run's id, or `""` between runs. */
  readonly runId: string;
  /**
   * Charges one finished package call to the active run: price, limits, run usage, ledger. Defined only while a run
   * is active. A limit breach aborts the run and throws.
   */
  readonly recordUsage?: (model: ModelConfig, usage: Usage | undefined, request: ProviderRequest) => Promise<void>;
}
