import { type Agent, createAgent, type ModelSpec, type PackageInput } from "@arnilo/prism";
import { toolsCoding } from "@arnilo/prism-tools/coding";

export interface HostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
  readonly root: string;
}

/** A local coding agent with no front end yet. */
export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    packages: [...options.providers, toolsCoding({ root: options.root })],
  });
}
