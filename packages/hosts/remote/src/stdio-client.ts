import { spawn } from "node:child_process";
import { RemoteError } from "./errors.js";
import type { RemoteLimitOptions } from "./limits.js";
import { type RemoteTransport, stdioTransport } from "./transport.js";

export interface StdioEndpoint {
  readonly kind: "stdio";
  /** argv of the child that runs `serveAgent(..., { transport: { kind: "stdio" } })`. */
  readonly command: readonly string[];
  /** Merged over the parent's environment. */
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface SpawnedTransport {
  readonly transport: RemoteTransport;
  /** Stops the child. Idempotent. */
  kill(): void;
}

/** Spawns the served process and frames its stdin/stdout as `prism.remote/1`. Its stderr is inherited. */
export function spawnStdioTransport(endpoint: StdioEndpoint, limits?: RemoteLimitOptions): SpawnedTransport {
  if (endpoint.command.length === 0 || endpoint.command.some((part) => typeof part !== "string" || part === "")) {
    throw new RemoteError("invalid_params", "stdio endpoint command must be a non-empty argv of strings");
  }
  const child = spawn(endpoint.command[0] as string, endpoint.command.slice(1), {
    stdio: ["pipe", "pipe", "inherit"],
    ...(endpoint.cwd ? { cwd: endpoint.cwd } : {}),
    ...(endpoint.env ? { env: { ...process.env, ...endpoint.env } } : {}),
  });
  // A child that fails to start or whose pipe breaks ends the transport; the dispatcher reports `disconnected`.
  child.on("error", () => child.stdin.destroy());
  child.stdin.on("error", () => {});
  const transport = stdioTransport({
    input: child.stdout,
    output: child.stdin,
    ...(limits ? { limits } : {}),
  });
  void transport.closed.then(() => child.kill());
  return { transport, kill: () => child.kill() };
}
