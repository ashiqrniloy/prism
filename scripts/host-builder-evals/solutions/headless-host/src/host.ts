import { type Agent, createAgent, type ModelSpec, type PackageInput } from "@arnilo/prism";
import { contextFiles } from "@arnilo/prism-extensions/context-files";
import { toolsCoding } from "@arnilo/prism-tools/coding";

export interface HostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
  readonly root: string;
}

export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    // No UI and no approval package: `guard: "off"` lets shell run instead of asking (plan 233 Task 2).
    packages: [...options.providers, toolsCoding({ root: options.root, guard: "off" }), contextFiles({ root: options.root })],
  });
}
