import type { DriverBinary, DriverConfig, DriverDescriptor } from "@arnilo/prism/driver-kit";
import type { AdapterIdentity, AgentAdapter, ProcessDriverConfig } from "./adapter.js";

export interface ProcessDriverInspection {
  readonly adapter: AdapterIdentity;
  readonly binary?: DriverBinary;
  readonly transport: AgentAdapter["transport"];
  readonly capture: "mapped" | "all";
  readonly deployment: "local" | "hosted";
  readonly isolation: "strict" | "inherit";
  readonly policy: DriverDescriptor["auth"];
  readonly acknowledgements: readonly string[];
}
export function inspectDriver(
  adapter: AgentAdapter,
  config: DriverConfig<ProcessDriverConfig>,
  binary?: DriverBinary,
): ProcessDriverInspection {
  return Object.freeze({
    adapter: Object.freeze({
      name: adapter.name,
      revision: adapter.revision,
      ...(adapter.extends ? { extends: structuredClone(adapter.extends) } : {}),
    }),
    ...(binary ? { binary: Object.freeze({ ...binary }) } : {}),
    transport: adapter.transport,
    capture: config.capture ?? "mapped",
    deployment: config.deployment ?? "local",
    isolation: config.isolation ?? "strict",
    policy: structuredClone(adapter.descriptor.auth),
    acknowledgements: [...(config.acknowledgements ?? [])],
  });
}
