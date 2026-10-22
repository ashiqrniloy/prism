import type { Agent } from "@arnilo/prism";

/** A `createAgent` rejection, or a config read failure, mapped to exit code 2. The message is the SDK's. */
export class HostStartError extends Error {
  readonly exitCode = 2;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HostStartError";
  }
}

export async function startAgent(create: () => Promise<Agent>): Promise<Agent> {
  try {
    return await create();
  } catch (error) {
    throw new HostStartError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}
