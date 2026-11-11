import type { DriverDescriptor } from "@arnilo/prism/driver-kit";
import { type AgentAdapter, assertAdapter } from "./adapter.js";
import { ProcessDriverError } from "./errors.js";

/** Bare functions wrap the base member; replacement is explicit to avoid executing a decoder as a factory. */
type FunctionOverride<F> = ((base: F) => F) | { readonly replace: F };
type FunctionMembers = "configure" | "decode" | "open" | "notices";
export type AdapterOverrides = Pick<AgentAdapter, "name" | "revision"> &
  Partial<Pick<AgentAdapter, "transport" | "vendor" | "permissionTool" | "abort" | "requests">> & {
    readonly [K in FunctionMembers]?: FunctionOverride<NonNullable<AgentAdapter[K]>>;
  } & {
    readonly descriptor?: Partial<Omit<DriverDescriptor, "controls" | "capture" | "auth">> & {
      readonly controls?: Partial<DriverDescriptor["controls"]>;
      readonly capture?: Partial<DriverDescriptor["capture"]>;
      readonly auth?: Partial<DriverDescriptor["auth"]>;
    };
    readonly binary?: Partial<AgentAdapter["binary"]>;
    readonly profile?: Partial<AgentAdapter["profile"]>;
    readonly encode?: Partial<AgentAdapter["encode"]>;
    readonly hooks?: Partial<NonNullable<AgentAdapter["hooks"]>>;
    readonly session?: Partial<AgentAdapter["session"]>;
  };

export function extendAdapter(base: AgentAdapter, overrides: AdapterOverrides): AgentAdapter {
  assertAdapter(base);
  if (!overrides || typeof overrides.name !== "string" || !overrides.name.trim())
    throw new ProcessDriverError("adapter_invalid", "adapter.name is required in overrides");
  if (typeof overrides.revision !== "string" || !overrides.revision.trim())
    throw new ProcessDriverError("adapter_invalid", "adapter.revision is required in overrides");
  const merged = { ...base, ...overrides } as AgentAdapter;
  const data = merged as unknown as Record<string, unknown>;
  for (const key of ["binary", "profile", "encode", "hooks", "session", "requests"] as const) {
    if (overrides[key] !== undefined) data[key] = { ...base[key], ...overrides[key] };
  }
  data.descriptor = {
    ...base.descriptor,
    ...overrides.descriptor,
    controls: { ...base.descriptor.controls, ...overrides.descriptor?.controls },
    capture: { ...base.descriptor.capture, ...overrides.descriptor?.capture },
    auth: { ...base.descriptor.auth, ...overrides.descriptor?.auth },
  };
  for (const key of ["configure", "decode", "open", "notices"] as const) {
    const override = overrides[key];
    if (override !== undefined) {
      if (typeof override === "function" && typeof base[key] !== "function")
        throw new ProcessDriverError("adapter_invalid", `adapter.${key} has no base function to wrap`);
      data[key] = typeof override === "function" ? (override as (member: unknown) => unknown)(base[key]) : override?.replace;
    }
  }
  data.extends = { name: base.name, revision: base.revision, ...(base.extends ? { extends: base.extends } : {}) };
  assertAdapter(merged);
  assertNarrowerPolicy(base.descriptor, merged.descriptor);
  return merged;
}

function assertNarrowerPolicy(base: DriverDescriptor, merged: DriverDescriptor): void {
  const widened = () => {
    throw new ProcessDriverError("adapter_invalid", "policy_widened");
  };
  for (const mode of merged.auth.modes) {
    const previous = base.auth.modes.find((candidate) => candidate.name === mode.name);
    if (!previous) throw new ProcessDriverError("adapter_invalid", "policy_widened");
    if (mode.kind !== previous.kind || mode.homeEnv !== previous.homeEnv) widened();
    if (
      mode.deployments.some((deployment) => !previous.deployments.includes(deployment)) ||
      (previous.hostedAcknowledgements ?? []).some((term) => !mode.hostedAcknowledgements?.includes(term)) ||
      previous.protected.paths.some((path) => !mode.protected.paths.includes(path)) ||
      previous.protected.env.some((name) => !mode.protected.env.includes(name))
    )
      widened();
  }
}
