import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { signalLadder } from "@arnilo/prism/driver-kit";
import type { AgentAdapter, EncodeContext } from "./adapter.js";
import type { Transport } from "./transports/types.js";

/** Exit-aware waits clear their timers as soon as the child is reaped. */
function wait(exited: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    void exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function processShutdown(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<void>,
  adapter: AgentAdapter,
  transport: Transport,
  encoding: EncodeContext,
  graceMs: number,
) {
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  let stopping: Promise<void> | undefined;
  let aborting: Promise<void> | undefined;
  const abort = () =>
    (aborting ??= (async () => {
      if (stopped || child.pid === undefined) {
        await exited;
        return;
      }
      const deadline = Date.now() + graceMs;
      const hardKill = setTimeout(() => child.kill("SIGKILL"), graceMs);
      try {
        const slice = graceMs / (adapter.abort.length + 2);
        for (const step of adapter.abort) {
          if (stopped || Date.now() >= deadline) break;
          const action = async () => {
            if ("rpc" in step) await transport.send({ method: step.rpc, params: step.params?.(encoding), notify: true });
            else if ("closeStdin" in step) child.stdin.end();
            else child.kill(step.signal);
          };
          const pause = wait(exited, Math.min(slice, Math.max(0, deadline - Date.now())));
          // A broken interrupt channel must not prevent later signals or the hard kill.
          await Promise.race([action().catch(() => undefined), pause]);
          await pause;
        }
        if (!stopped && Date.now() < deadline) await signalLadder(child, { graceMs: Math.max(1, Math.floor((deadline - Date.now()) / 2)) });
        await exited;
      } finally {
        clearTimeout(hardKill);
      }
    })());
  const shutdown = (graceful: boolean) =>
    (stopping ??= (async () => {
      if (stopped || child.pid === undefined) {
        await exited;
        return;
      }
      if (graceful) {
        child.stdin.end();
        await wait(exited, graceMs);
      }
      if (aborting) await aborting;
      else if (!stopped) await signalLadder(child, { graceMs: Math.max(1, Math.floor(graceMs / 2)) });
      await exited;
    })());
  return { abort, graceful: () => shutdown(true), failure: () => shutdown(false) };
}
