import type { ChildProcess } from "node:child_process";

export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * Stops a child: SIGINT, then SIGTERM after `graceMs`, then SIGKILL after another `graceMs`. Resolves with the
 * exit; a child is never left running past `2 * graceMs` plus the kill.
 */
export function signalLadder(child: ChildProcess, options: { readonly graceMs: number }): Promise<ExitInfo> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    child.once("exit", (code, signal) => {
      for (const timer of timers) clearTimeout(timer);
      resolve({ code, signal });
    });
    child.kill("SIGINT");
    timers.push(setTimeout(() => child.kill("SIGTERM"), options.graceMs));
    timers.push(setTimeout(() => child.kill("SIGKILL"), options.graceMs * 2));
  });
}
