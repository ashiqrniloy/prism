import type { HostPort, JsonValue, LoopStrategy, RunController, SkillRegistry, ToolDefinition } from "../index.js";
import type { PackageAPI, PackageDefinition } from "../packages/api.js";
import { definePackage } from "../packages/define.js";
import type { JsonSchema } from "../packages/schema.js";
import { KERNEL_API_LEVEL, KERNEL_VERSION } from "../version.js";
import { assertDriverDescriptor, assertDriverRequires, type DriverDescriptor, type DriverRequires } from "./descriptor.js";
import { DriverError } from "./errors.js";
import { createPolicyGuard, type PolicyGuard, type RunLease } from "./guard.js";
import { createProfiles, type ParseStatus, type Profiles } from "./profiles.js";
import { EXTERNAL_AGENT_SPEC_KEYS, type ExternalAgentSpec, externalAgentSpecSchema } from "./spec.js";

/** The probed vendor binary. */
export interface DriverBinary {
  readonly path: string;
  readonly version: string;
}

/** What `start.run` receives for one run. */
export interface DriverRunContext<Extra extends object = Readonly<Record<string, never>>> {
  readonly run: RunController;
  readonly spec: ExternalAgentSpec;
  /** The validated package config: the spec plus `requires` plus the driver's own keys. */
  readonly config: DriverConfig<Extra>;
  readonly binary: DriverBinary;
  readonly descriptor: DriverDescriptor;
  /** The run's profile lease: home directory, record, auth mode. Released by the kit when `run` settles. */
  readonly lease?: RunLease;
  /** The agent's effective tool definitions (`PackageAPI.tools.list`), for `bridgeTools` and `serveTools`. */
  readonly tools: readonly ToolDefinition[];
  /** The agent's effective skills, in the shape `materializeSkills` takes. */
  readonly skills: Pick<SkillRegistry, "get" | "list">;
  /** The package's host port, so a driver can route questions and elicitation to `host.ui`. */
  readonly host: HostPort;
  /** Other packages' services, for example the `workspace` service's bound worktree. */
  readonly services: { consume<T>(name: string): T | undefined };
}

/** What `createDriverLoop` reads from the package at run time. Resolved per run, so packages loaded later are visible. */
export type DriverRuntime = Pick<DriverRunContext, "host" | "services"> & {
  readonly tools: () => readonly ToolDefinition[];
  readonly skills: () => Pick<SkillRegistry, "get" | "list">;
};

/** Deployment policy keys every driver package accepts beside the spec. */
export interface DriverPolicyConfig {
  /** Where profiles live; default `~/.prism/profiles`. */
  readonly profilesRoot?: string;
  /** Default `"local"`. */
  readonly deployment?: "local" | "hosted";
  readonly acknowledgements?: readonly string[];
  /** The principal id the host runs as; checked against the profile's bound principal. */
  readonly principal?: string;
}

/** The validated package config of a driver package. */
export type DriverConfig<Extra extends object = Readonly<Record<string, never>>> = ExternalAgentSpec &
  Extra &
  DriverPolicyConfig & { readonly requires?: DriverRequires };

export interface DriverDefinition<Extra extends object = Readonly<Record<string, never>>> {
  /** Package name (npm name), e.g. `@scope/prism-driver-example`. */
  readonly name: string;
  readonly vendor: string;
  /** The driver's own revision. The probed binary version joins it through the resume check. */
  readonly revision: string;
  readonly descriptor: DriverDescriptor;
  /**
   * Extra top-level config keys the driver accepts, as an object schema (for example a `binary` path).
   * Its `properties.vendor`, when present, validates `ExternalAgentSpec.vendor`; otherwise no vendor option is accepted.
   */
  readonly config?: JsonSchema;
  /** Reads the vendor's status command result. The kit keeps only `signedIn` and `method`, never stdout. */
  readonly parseStatus?: ParseStatus;
  readonly start: {
    /**
     * Finds the binary. Return `undefined` (or throw) when it is missing; the package then registers its loop
     * and notes why, and a run fails with `driver_unavailable`. Bounded by `probeTimeoutMs`.
     */
    probe(config: DriverConfig<Extra>): Promise<DriverBinary | undefined>;
    run(context: DriverRunContext<Extra>): Promise<void>;
  };
  /** Default 5000. */
  readonly probeTimeoutMs?: number;
}

/** A typed constructor: validates the definition and returns it unchanged. */
export function defineDriver<Extra extends object = Readonly<Record<string, never>>>(
  definition: DriverDefinition<Extra>,
): DriverDefinition<Extra> {
  const bad = (message: string): never => {
    throw new DriverError("driver_definition_invalid", message);
  };
  if (typeof definition.name !== "string" || definition.name === "") bad("driver.name must be a non-empty string");
  if (typeof definition.revision !== "string" || definition.revision === "") bad("driver.revision must be a non-empty string");
  if (definition.vendor !== definition.descriptor?.vendor) bad("driver.vendor must equal descriptor.vendor");
  if (typeof definition.start?.probe !== "function" || typeof definition.start?.run !== "function") bad("driver.start needs probe and run");
  assertDriverDescriptor(definition.descriptor);
  for (const key of Object.keys(definition.config?.properties ?? {})) {
    if (key !== "vendor" && (EXTERNAL_AGENT_SPEC_KEYS as readonly string[]).includes(key)) bad(`driver config may not redefine "${key}"`);
    if (key === "requires" || POLICY_KEYS.includes(key)) bad(`driver config may not redefine "${key}"`);
  }
  return definition;
}

const POLICY_KEYS = ["profilesRoot", "deployment", "acknowledgements", "principal"];

const POLICY_SCHEMA: Record<string, JsonSchema> = {
  profilesRoot: { type: "string", minLength: 1 },
  deployment: { type: "string", enum: ["local", "hosted"] },
  acknowledgements: { type: "array", items: { type: "string", minLength: 1 } },
  principal: { type: "string", minLength: 1 },
};

const REQUIRES_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    systemPrompt: { type: "string", enum: ["replace", "append"] },
    builtinTools: { type: "string", enum: ["per-tool", "partial"] },
    gated: { type: "array", items: { type: "string", enum: ["read", "write", "execute", "network", "external"] } },
    steer: { type: "string", enum: ["mid-turn", "next-turn"] },
    resume: { type: "string", enum: ["store", "vendor"] },
    thinking: { type: "string", enum: ["deltas", "final", "summary", "tokens-only"] },
    skillActivation: { type: "boolean", const: true },
    subagents: { type: "boolean", const: true },
    accountSignIn: { type: "boolean", const: true },
  },
  additionalProperties: false,
};

/** The service a driver package provides: its profile store and policy guard. `guard.inspect()` is the audit view. */
export interface DriverServices {
  readonly profiles: Profiles;
  readonly guard: PolicyGuard;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

function driverConfigSchema(definition: DriverDefinition<any>): JsonSchema {
  const { vendor, ...extra } = definition.config?.properties ?? {};
  const spec = externalAgentSpecSchema(vendor);
  return {
    ...spec,
    properties: { ...extra, ...spec.properties, ...POLICY_SCHEMA, requires: REQUIRES_SCHEMA },
    required: [...(spec.required ?? []), ...(definition.config?.required ?? [])],
  };
}

async function probeWithTimeout<Extra extends object>(
  definition: DriverDefinition<Extra>,
  config: DriverConfig<Extra>,
): Promise<DriverBinary | undefined> {
  const timeoutMs = definition.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      definition.start.probe(config).catch(() => undefined),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function majorOf(version: string): string {
  return /^v?(\d+)/.exec(version)?.[1] ?? version;
}

/** The loop a driver package provides. `binary` is `undefined` when the probe found nothing. */
export function createDriverLoop<Extra extends object>(
  definition: DriverDefinition<Extra>,
  config: DriverConfig<Extra>,
  binary: DriverBinary | undefined,
  guard: PolicyGuard | undefined,
  runtime: DriverRuntime,
): LoopStrategy {
  const spec: ExternalAgentSpec = Object.fromEntries(
    EXTERNAL_AGENT_SPEC_KEYS.filter((key) => (config as Record<string, unknown>)[key] !== undefined).map((key) => [
      key,
      (config as Record<string, unknown>)[key],
    ]),
  ) as unknown as ExternalAgentSpec;
  return {
    name: definition.name,
    revision: definition.revision,
    usesModel: false,
    runModel: definition.descriptor.models,
    async run(run) {
      if (binary === undefined) {
        throw new DriverError("driver_unavailable", `the ${definition.vendor} binary was not found; check the driver's binary setting`);
      }
      const lease = guard === undefined ? undefined : await guard.acquire({ profile: spec.profile, config });
      try {
        await definition.start.run({
          run,
          spec,
          config,
          binary,
          descriptor: definition.descriptor,
          ...(lease ? { lease } : {}),
          tools: runtime.tools(),
          skills: runtime.skills(),
          host: runtime.host,
          services: runtime.services,
        });
      } finally {
        lease?.release();
      }
    },
    // The loop revision stays the driver's own: a runtime-equal check would reject every minor upgrade and
    // preempt the typed error. The binary's major version travels in the snapshot instead.
    snapshot: () => ({ binaryMajor: binary === undefined ? null : majorOf(binary.version) }) satisfies JsonValue,
    restore(snapshot) {
      const stored = (snapshot as { binaryMajor?: string | null } | null)?.binaryMajor;
      if (stored === undefined || stored === null) return;
      const current = binary === undefined ? undefined : majorOf(binary.version);
      if (current !== stored) {
        throw new DriverError(
          "driver_revision_mismatch",
          `the run was stored under ${definition.vendor} major version ${stored}, found ${current ?? "no binary"}`,
        );
      }
    },
  };
}

function driverRuntime(prism: PackageAPI<any>): DriverRuntime {
  return {
    tools: () => prism.tools.list(),
    skills: () => ({ get: (name) => prism.skills.get(name), list: () => prism.skills.list() }),
    host: prism.host,
    services: { consume: (name) => prism.services.consume(name) },
  };
}

/**
 * A package that claims `slot:loop` with the driver. It validates the spec-extending config, checks `requires`
 * against the descriptor (a miss fails `createAgent`), and probes the binary at `setup`.
 */
export function driverPackage<Extra extends object = Readonly<Record<string, never>>>(
  definition: DriverDefinition<Extra>,
): PackageDefinition<DriverConfig<Extra>> {
  return definePackage<DriverConfig<Extra>>({
    name: definition.name,
    version: KERNEL_VERSION,
    description: `${definition.vendor} driver`,
    requires: { api: KERNEL_API_LEVEL },
    capabilities: ["slot:loop"],
    config: driverConfigSchema(definition),
    async setup(prism) {
      const config = prism.config;
      assertDriverRequires(definition.descriptor, config.requires);
      const binary = await probeWithTimeout(definition, config);
      if (binary === undefined) {
        prism.status.note("warn", `${definition.vendor} binary not found; runs fail with driver_unavailable`);
      }
      const profiles = createProfiles({
        ...(config.profilesRoot === undefined ? {} : { root: config.profilesRoot }),
        driver: definition,
        host: prism.host,
        ...(binary === undefined ? {} : { binary: binary.path }),
      });
      const guard = createPolicyGuard({
        vendor: definition.vendor,
        modes: definition.descriptor.auth.modes,
        profiles,
        ...(config.deployment === undefined ? {} : { deployment: config.deployment }),
        ...(config.acknowledgements === undefined ? {} : { acknowledgements: config.acknowledgements }),
        ...(config.principal === undefined ? {} : { principal: config.principal }),
        ...(binary === undefined ? {} : { binary }),
      });
      prism.services.provide(`driver-kit:${definition.name}`, { profiles, guard } satisfies DriverServices);
      prism.slots.loop.provide(createDriverLoop(definition, config, binary, guard, driverRuntime(prism)));
    },
  });
}
