/**
 * `agent.inspect()` (roadmap §2.3): a snapshot of what loaded. Built from the loader's records at call
 * time, with no I/O. Hosts render it, and Phase 12's `doctor` serializes it.
 */
import type { Agent, AgentConfig, SessionStoreCapability } from "../contracts.js";
import { skillInfos, toolInfos } from "./views.js";
import { isSessionScopedHookId } from "../agent-session/runtime-registry.js";
import { sessionStoreCapabilities } from "../session-stores.js";
import type { HookBus } from "../hooks/index.js";
import type { PackageConfigSource } from "../packages/config.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SecretRedactor } from "../redaction.js";
import { SLOT_NAMES, type SlotName, type SlotRegistry } from "../slots/index.js";

export interface InspectedPackage {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly optional: boolean;
  readonly status: "loaded" | "skipped";
  /** `code` (the host listed it) or `manifest:user` / `manifest:project` (`loadManifest` built it). */
  readonly source: "code" | "manifest:user" | "manifest:project";
  /** Where each config key's value came from. */
  readonly configSources: Readonly<Record<string, PackageConfigSource>>;
  /** The merged config. A secret field holds its `env:` / `keyring:` ref, never a resolved value. */
  readonly config: Readonly<Record<string, unknown>>;
}

export interface InspectedContribution {
  readonly name: string;
  /** The registering package, or `host` for the host's own. */
  readonly package: string;
}

export interface InspectedHook {
  /** Registration id: `<owner>:<hook>[#id]`. */
  readonly id: string;
  readonly owner: string;
  readonly priority: number;
}

export interface AgentInspection {
  readonly packages: readonly InspectedPackage[];
  readonly tools: readonly InspectedContribution[];
  readonly skills: readonly InspectedContribution[];
  readonly commands: readonly InspectedContribution[];
  /** Per hook name, registrations in execution order. Per-session pack hooks are not listed. */
  readonly hooks: Readonly<Record<string, readonly InspectedHook[]>>;
  /** Per slot, its owner: `kernel` (the default), a package name, or `host`. */
  readonly slots: Readonly<Record<SlotName, string>>;
  /** The resolved `store` slot: its owner, and the optional `agent.sessions` capabilities it implements. */
  readonly store: {
    readonly owner: string;
    readonly capabilities: readonly SessionStoreCapability[];
  };
  /** Ids named in `AgentConfig.disable`. Every one took effect, or the load would have failed. */
  readonly disabled: {
    readonly tools: readonly string[];
    readonly skills: readonly string[];
    readonly commands: readonly string[];
    readonly hooks: readonly string[];
  };
  readonly statusNotes: readonly {
    readonly package: string;
    readonly level: "info" | "warn";
    readonly message: string;
    readonly at: string;
  }[];
}

export interface InspectSources {
  readonly config: AgentConfig;
  readonly packages: LoadedPackages;
  readonly hooks: HookBus;
  readonly slots: SlotRegistry;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function inspectAgent(agent: Agent, sources: InspectSources): AgentInspection {
  const { config, packages, hooks, slots } = sources;
  const disable = config.disable ?? {};

  const hookMap: Record<string, InspectedHook[]> = {};
  for (const registration of hooks.registrations()) {
    if (isSessionScopedHookId(registration.id)) continue;
    (hookMap[registration.name] ??= []).push({ id: registration.id, owner: registration.owner, priority: registration.priority });
  }
  const assigned = (config.slots ?? {}) as Partial<Record<SlotName, unknown>>;

  const listing: AgentInspection = {
    packages: [...packages.packages, ...packages.skippedPackages].map((entry) => ({
      name: entry.name,
      version: entry.version,
      capabilities: [...entry.capabilities],
      optional: entry.optional,
      status: entry.status,
      source: entry.source,
      configSources: { ...entry.configSources },
      config: entry.config,
    })),
    // The same merged view as `agent.tools` / `agent.skills`.
    tools: toolInfos(agent).map(({ name, package: owner }) => ({ name, package: owner })),
    skills: skillInfos(agent).map(({ name, package: owner }) => ({ name, package: owner })),
    commands: packages.commands().map((entry) => ({ name: entry.name, package: entry.package })),
    hooks: hookMap,
    slots: Object.fromEntries(SLOT_NAMES.map((slot) => [slot, slots.ownerOf(slot, assigned[slot] as never)])) as Record<SlotName, string>,
    store: {
      owner: slots.ownerOf("store", assigned.store as never),
      capabilities: [...sessionStoreCapabilities(slots.resolve("store", assigned.store as never))],
    },
    disabled: {
      tools: [...(disable.tools ?? [])],
      skills: [...(disable.skills ?? [])],
      commands: [...(disable.commands ?? [])],
      hooks: [...(disable.hooks ?? [])],
    },
    statusNotes: packages.statusNotes().map((note) => ({ package: note.package, level: note.level, message: note.message, at: note.at })),
  };

  // Plain JSON first (drops `undefined`), then the agent's redactor and every resolved secret: a configured
  // secret that sits in a non-secret config field or a note is masked here, outside any run.
  const plain = JSON.parse(JSON.stringify(listing)) as AgentInspection;
  const redactor: SecretRedactor | undefined = packages.redactor(config.redactor);
  return deepFreeze(redactor ? redactor.redact(plain) : plain);
}
