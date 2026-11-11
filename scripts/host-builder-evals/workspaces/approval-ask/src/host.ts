import { type Agent, createAgent, type HostUi, type ModelSpec, type PackageInput } from "@arnilo/prism";
import { toolsCoding } from "@arnilo/prism-tools/coding";

export interface HostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
  readonly root: string;
  /** The person's channel. Absent when nobody can answer. */
  readonly ui?: HostUi;
}

export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    ...(options.ui ? { host: { ui: options.ui } } : {}),
    packages: [...options.providers, toolsCoding({ root: options.root })],
  });
}
