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
   * Charges one finished model call to the active run: price, limits, run usage, one ledger row of `scope`
   * (`package_call` by default; `child_run` when a child session's run mirrors its usage here through
   * `RunOptions.chargeTo`). Defined only while a run is active. A limit breach aborts the run and throws.
   */
  readonly recordUsage?: (
    model: ModelConfig,
    usage: Usage | undefined,
    request: ProviderRequest | undefined,
    scope?: PackageUsageScope,
  ) => Promise<void>;
  /**
   * Kernel-internal: charges usage to this session's session-wide limits when no run is active on it
   * (for example an async child run outliving its parent's run via `RunOptions.chargeTo`).
   */
  readonly recordSessionUsage?: (model: ModelConfig, usage: Usage | undefined) => Promise<void>;
}

/** The ledger scopes a session's usage seam records under. */
export type PackageUsageScope = "package_call" | "child_run";

/** The kernel seam a view carries, or `undefined` for a hand-built `SessionContext`. */
export function packageCallSeamOf(view: object): PackageCallSeam | undefined {
  return (view as { [PACKAGE_CALL_SEAM]?: PackageCallSeam })[PACKAGE_CALL_SEAM];
}
