/**
 * `agent.inspect()` (roadmap §2.3): a snapshot of what loaded. Built from the loader's records at call
 * time, with no I/O. Hosts render it, and Phase 12's `doctor` serializes it.
 */
import type { Agent, AgentConfig, SessionStoreCapability } from "../contracts.js";
import type { HookBus } from "../hooks/index.js";
import type { PackageConfigSource } from "../packages/config.js";
import type { LoadedPackages } from "../packages/loader.js";
import { type SlotName, type SlotRegistry } from "../slots/index.js";
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
export declare function inspectAgent(agent: Agent, sources: InspectSources): AgentInspection;
