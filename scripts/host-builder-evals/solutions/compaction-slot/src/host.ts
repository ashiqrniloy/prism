import { type Agent, createAgent, type ModelSpec, type PackageInput } from "@arnilo/prism";
import memoryCompaction from "@arnilo/prism-memory-compaction";
import localCompaction from "./local-compaction.ts";

export interface HostOptions {
  readonly model: ModelSpec;
  readonly providers: readonly PackageInput[];
}

export async function createHost(options: HostOptions): Promise<Agent> {
  return createAgent({
    model: options.model,
    ownership: { tenantId: "local" },
    principal: { kind: "user", id: "local" },
    slots: { compaction: "@arnilo/prism-memory-compaction" },
    packages: [...options.providers, localCompaction(), memoryCompaction()],
  });
}
