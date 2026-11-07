// Written for Prism 0.12.1. The project now has Prism 0.13 installed.
import { createAgent } from "@arnilo/prism";
import { codingTools } from "@arnilo/prism-coding-tools";

export interface HostOptions {
  /** Provider packages, for example a hosted model or a test provider. */
  readonly providers: unknown[];
  /** The directory the coding tools work in. */
  readonly root: string;
}

/**
 * Behavior to keep: the agent talks to the model `demo` of the provider `mock`, has the coding tools rooted at
 * `root`, runs as the local user, and reads files without asking.
 */
export function createHost(options: HostOptions) {
  return createAgent({
    provider: "mock",
    model: "demo",
    extensions: [...options.providers, codingTools({ root: options.root })],
    tools: { use: ["coding"] },
    identity: { profile: "local-operator" },
    store: "memory",
    stopHooks: [],
  } as never);
}
