import type { BashOperations } from "@arnilo/prism-coding-agent";

export interface SandboxExecRequest {
  readonly command: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

export interface SandboxAdapter {
  exec(request: SandboxExecRequest): Promise<{ exitCode: number | null }>;
}

export class SandboxExecutionError extends Error {
  readonly code = "ERR_PRISM_SANDBOX_EXECUTION";
  constructor(message: string) {
    super(message);
    this.name = "SandboxExecutionError";
  }
}

/** Map a host-owned sandbox adapter to coding-agent `BashOperations`. */
export function createSandboxBashOperations(adapter: SandboxAdapter): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      try {
        return await adapter.exec({
          command,
          cwd,
          env: options.env,
          signal: options.signal,
          timeout: options.timeout,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SandboxExecutionError(message);
      }
    },
  };
}
