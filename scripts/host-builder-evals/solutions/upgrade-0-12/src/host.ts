import { type Agent, createAgent, type PackageInput } from "@arnilo/prism";
import { toolsCoding } from "@arnilo/prism-tools-coding";

export interface HostOptions {
  /** Provider packages, for example a hosted model or a test provider. */
  readonly providers: PackageInput[];
  /** The directory the coding tools work in. */
  readonly root: string;
}

export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    packages: [...options.providers, toolsCoding({ root: options.root })],
  });
}
