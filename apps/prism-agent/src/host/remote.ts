import { fileURLToPath } from "node:url";
import type { Agent, HostUi, SessionStore } from "@arnilo/prism";
import { connectAgent } from "@arnilo/prism-remote";

/** `origin.remote` for the reference host's remote worker, shared with the worker bin. */
export const REMOTE_ENDPOINT = "prism-agent-remote";

/** The host-owned remote worker bin: a second Bun process serving one agent over `prism.remote/1`. */
export const REMOTE_WORKER_BIN = fileURLToPath(new URL("../../bin/remote-worker.ts", import.meta.url));

export interface RemoteWorkerOptions {
  /** The remote process's own `prism-agent.json`; its model and workspace, never a literal secret. */
  readonly configPath: string;
  /** The host's `HostUi`. It answers the remote's approval requests, so a gated remote run resumes. */
  readonly ui?: HostUi;
  /** The host's store. The remote session is archived into it, one entry per completed message. */
  readonly mirror?: SessionStore;
  /** `origin.remote`. Defaults to the server's endpoint id. */
  readonly endpointId?: string;
  /** Extra child environment (the scenario's mock script). */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Spawns the remote worker over stdio and connects to it (roadmap §2.13.4). Stdio only, so no listener
 * and no token: the host owns the child and answers its `HostUi` requests locally. The remote's own
 * hooks and gates run its tools, so no local `tool.call` fires for them.
 */
export function connectRemoteWorker(options: RemoteWorkerOptions): Promise<Agent> {
  return connectAgent(
    {
      kind: "stdio",
      command: [process.execPath, REMOTE_WORKER_BIN],
      env: { PRISM_AGENT_CONFIG: options.configPath, ...options.env },
    },
    {
      ...(options.ui === undefined ? {} : { host: { ui: options.ui } }),
      ...(options.mirror === undefined ? {} : { mirror: options.mirror }),
      ...(options.endpointId === undefined ? {} : { endpointId: options.endpointId }),
    },
  );
}
