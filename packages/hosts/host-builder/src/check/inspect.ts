import { type CheckOutcome, type RunCheckOptions, runCheck } from "./runner.js";
import type { CheckTarget } from "./targets.js";

/** `agent.inspect()` of the agent an inspection factory builds. Typed loosely: the host's installed kernel owns the shape. */
export interface InspectedHost {
  readonly packages: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly skills: readonly unknown[];
  readonly hooks: Readonly<Record<string, readonly unknown[]>>;
  readonly slots: Readonly<Record<string, string>>;
  readonly notes?: readonly unknown[];
  readonly [key: string]: unknown;
}

export type CheckSettings = Pick<RunCheckOptions, "root" | "timeoutMs" | "passEnv" | "env">;

/** Builds the host's agent in a child process, reads `agent.inspect()`, disposes the agent. */
export function inspectHost(settings: CheckSettings, target: CheckTarget): Promise<CheckOutcome<InspectedHost>> {
  return runCheck<InspectedHost>({ ...settings, kind: "inspect", file: target.file, exportName: target.exportName });
}
