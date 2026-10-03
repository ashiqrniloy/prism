/**
 * Test-only reader for kernel events that the frozen catalog carries as `package.event`.
 *
 * Kernel modules (guardrails, attention compiler, delegation, steer guard, tool narrowing) emit
 * through `package.event` until their owning phase gives them a dedicated name. The envelope's
 * `data` holds the module's payload, so assertions merge the envelope's ids back in and read the
 * fields directly, exactly as they did before the re-homing.
 */
import type { AgentEvent } from "../index.js";

type PackageEvent = Extract<AgentEvent, { readonly type: "package.event" }>;

/** Every `package.event` of one kernel module name, with `sessionId`/`runId` merged into `data`. */
export function kernelEvents<T = Record<string, unknown>>(
  events: readonly AgentEvent[],
  name: string,
): Array<T & { readonly sessionId: string; readonly runId: string }> {
  return events
    .filter((event): event is PackageEvent => event.type === "package.event" && event.name === name)
    .map((event) => ({ sessionId: event.sessionId, runId: event.runId, ...(event.data as T) }));
}

/** The first `package.event` of one kernel module name, or `undefined`. */
export function firstKernelEvent<T = Record<string, unknown>>(
  events: readonly AgentEvent[],
  name: string,
): (T & { readonly sessionId: string; readonly runId: string }) | undefined {
  return kernelEvents<T>(events, name)[0];
}
