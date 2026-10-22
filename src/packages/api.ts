import type {
  Agent,
  EmbeddingsProvider,
  JsonObject,
  JsonValue,
  ModelConfig,
  ModelProvider,
  ModelRef,
  ProviderEvent,
  ProviderRequest,
  Secret,
  Skill,
  ToolDefinition,
} from "../contracts.js";
import type { HookRegistrar } from "../hooks/index.js";
import type { HostPort, Logger } from "../host/types.js";
import type { AgentState, SessionLog, SessionState } from "../session/state.js";
import type { SessionContext } from "../session-context.js";
import type { SlotContracts, SlotName } from "../slots/index.js";
import type { Capability } from "./capabilities.js";
import type { PackageConfigSource } from "./config.js";
import type { JsonSchema } from "./schema.js";

/** A slot a package can claim: `prism.slots.loop.provide(impl)`. Needs `"slot:<name>"`. */
export interface SlotRegistrarEntry<N extends SlotName> {
  /** Claims the slot under this package's name. Two claimants fail closed until the host assigns an owner. */
  provide(implementation: SlotContracts[N]): void;
  /** The kernel default, for delegation. */
  readonly default: SlotContracts[N];
}

export type SlotRegistrar = { readonly [N in SlotName]: SlotRegistrarEntry<N> };

/** Options for `tools.register`. */
export interface PackageToolOptions {
  /**
   * Per-turn visibility. Evaluated once per turn for this tool, so it must be synchronous and cheap. A
   * hidden tool is neither advertised nor callable, and a throwing predicate hides it (fail closed).
   */
  readonly when?: (session: SessionContext) => boolean;
}

/** What a command's `run` receives. `session` is bound to the command's owning package. */
export interface PackageCommandContext {
  readonly session?: SessionContext;
  /** Same `host-ui` capability check as `PackageAPI.host`; requests carry the owning package's name. */
  readonly host: HostPort;
  readonly agent: Agent;
}

/** A command a package contributes (roadmap §2.6). Replaces the retired 0.12 command shape. */
export interface PackageCommand {
  readonly name: string;
  readonly description: string;
  /** Validated with the kernel's JSON Schema subset before `run`. Defaults to no arguments. */
  readonly args?: JsonSchema;
  run(args: JsonObject, context: PackageCommandContext): unknown | Promise<unknown>;
}

/** What `agent.commands.list()` returns. */
export interface PackageCommandInfo {
  readonly name: string;
  readonly description: string;
  readonly package: string;
}

/** A model call a package makes outside a run (a compactor's summary, a classifier). */
export interface ModelClient {
  readonly model: ModelConfig;
  /** Streams one provider turn. Resolves the provider on first use, so providers loaded later are visible. */
  generate(request: Omit<ProviderRequest, "model">): AsyncIterable<ProviderEvent>;
}

/** What a package gets in `setup` (roadmap §2.6). */
export interface PackageAPI<C = Readonly<Record<string, never>>> {
  readonly name: string;
  /** Defaults ← manifest layer ← `AgentConfig.packageConfig`, validated, deeply frozen, and private to this package. */
  readonly config: C;
  /** Where each top-level config key came from. Frozen, key names only. */
  readonly configSources: Readonly<Record<string, PackageConfigSource>>;
  /** Loaded package inspection and dependency instances. */
  readonly packages: {
    /** Returns named loaded packages as PackageInstances in load order. Throws state_not_ready during setup. */
    instances(names: readonly string[]): readonly PackageInstance[];
  };
  /** Registers hooks under this package's name. The owner is bound by the loader, never chosen here. */
  readonly hooks: HookRegistrar;
  readonly slots: SlotRegistrar;
  readonly tools: {
    /** A name taken by another package, the host, or the kernel gives `tool_conflict`. */
    register(tool: ToolDefinition, options?: PackageToolOptions): void;
    /**
     * The agent's effective tools: the host's, the kernel's, and every package's, minus `AgentConfig.disable`.
     * Read-only frozen copies, in registration order. It lists every registered tool, not the session-conditional
     * subset (`PackageToolOptions.when`). Throws `state_not_ready` during `setup`.
     */
    list(): readonly ToolDefinition[];
  };
  readonly skills: {
    /** A name taken by another package or the host gives `skill_conflict`. */
    register(skill: Skill): void;
    /** The agent's effective skills (host and packages, minus `disable`) as frozen copies. Throws `state_not_ready` during `setup`. */
    list(): readonly Skill[];
    /** One effective skill by name, or `undefined` when absent or disabled. Throws `state_not_ready` during `setup`. */
    get(name: string): Skill | undefined;
    /** Reads `<dir>/<name>/SKILL.md` after `setup` returns, so a read failure fails this package's setup. */
    addDir(path: string): void;
  };
  readonly providers: {
    /** Selected by `AgentConfig.model.provider`, A duplicate id gives `provider_conflict`. */
    register(provider: ModelProvider): void;
  };
  readonly commands: {
    /** A name taken by another package gives `command_conflict`. */
    register(command: PackageCommand): void;
  };
  /** Needs `"models"`. */
  readonly models: {
    /** A client over the agent's provider resolution. `ref` defaults to `AgentConfig.model`. */
    client(ref?: ModelRef): ModelClient;
    /**
     * The configured model's embeddings adapter, over the same provider resolution as `client`.
     * Needs `"models"`; `ref` defaults to `AgentConfig.model`. Throws `EmbeddingsError` when the
     * model declares no `capabilities.embeddings` or the provider registers no adapter.
     */
    embeddings(ref?: ModelRef): EmbeddingsProvider;
  };
  /** Needs `"credentials"`. */
  readonly credentials: {
    /**
     * Resolves a `env:`/`keyring:` ref through the `credentials` slot. The value joins the agent's secret
     * set, so it is redacted from events, notes, logs, and errors from then on.
     */
    resolve(ref: string): Promise<Secret | undefined>;
  };
  readonly state: {
    /**
     * A value per session, kept in `package_state` entries on the session's branch: restored when the
     * session reads its branch, and carried by `fork()` and `clone()`. Needs `"session-state"`. Each `set`
     * is one store entry (and counts toward compaction thresholds), so write on change, not per event.
     */
    session<T extends JsonValue>(key: string, initial: T): SessionState<T>;
    /**
     * An append-only record log per session, kept in `package_state` entries on the session's branch:
     * restored when the session reads its branch, and carried by `fork()` and `clone()`. Needs
     * `"session-state"`. Each `append` is one store entry (and counts toward compaction thresholds), so
     * write on change, not per event. `entries(session)` is synchronous and returns the branch's order.
     */
    log<T extends JsonValue>(key: string): SessionLog<T>;
    /** Process memory for the agent's lifetime, reset to `initial` when this package is disposed. */
    agent<T>(key: string, initial: T): AgentState<T>;
  };
  readonly services: {
    /** A duplicate name gives `service_conflict`. */
    provide<T>(name: string, implementation: T): void;
    /** `undefined` when absent. Resolved at call time, so a package loaded later is visible. */
    consume<T>(name: string): T | undefined;
    /** Throws `missing_service` when absent. */
    require<T>(name: string): T;
  };
  /** `host.ui` needs `"host-ui"` and answers `unavailable` without a UI. Requests carry this package's name. */
  readonly host: HostPort;
  /** Emits a `package.event` namespaced by this package. Data must be JSON and is redacted. */
  readonly events: { emit(name: string, data: JsonValue): void };
  /** Shown in `inspect()`. A package that cannot operate registers nothing and notes why instead of throwing. */
  readonly status: { note(level: "info" | "warn", message: string): void };
  /** The host's logger, redacted, or a no-op. */
  readonly log: Logger;
  /** Runs when the agent is disposed or this package is unwound, in reverse order of registration. */
  onDispose(fn: () => void | Promise<void>): void;
}

export interface PackageRequires {
  /** Kernel API level this package targets. Required; must be in the kernel's `SUPPORTED_API_LEVELS`. */
  readonly api: number;
  /** Optional minimum kernel version, for a package that needs a fix from a specific release. */
  readonly prism?: string;
  /** Packages that must be loaded, with a version range. They load first. */
  readonly packages?: Readonly<Record<string, string>>;
  /** Services some loaded package must provide. Checked after every `setup` has run. */
  readonly services?: readonly string[];
}

export interface PackageDefinitionInput<C = Readonly<Record<string, never>>> {
  /** npm name; the package id everywhere. `host` and `kernel` are reserved. */
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly requires?: PackageRequires;
  readonly capabilities?: readonly Capability[];
  readonly config?: JsonSchema;
  setup(prism: PackageAPI<C>): void | Promise<void>;
}

export interface PackageInstanceOptions {
  /** A `setup` failure skips this instance and records a status note instead of failing the load. */
  readonly optional?: boolean;
}

/** Where an instance came from when `@arnilo/prism/manifest` built it. Code instances carry none. */
export interface PackageSource {
  readonly kind: "manifest";
  readonly scope: "user" | "project";
  /** Slots the manifest assigns to this package. `AgentConfig.slots` overrides them per slot. */
  readonly assigns?: readonly SlotName[];
  /** Per-key scope provenance for manifest keys. */
  readonly scopes?: Readonly<Record<string, "user" | "project">>;
}

/** A definition bound to its config. Pass it in `AgentConfig.packages`. */
export interface PackageInstance {
  readonly definition: PackageDefinition<any>;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly optional: boolean;
  /** Set by `loadManifest`. Its config is the `manifest` layer; a code instance's config is the `code` layer. */
  readonly source?: PackageSource;
}

/** Callable: `coding({ root })` returns a {@link PackageInstance}. Passing the bare definition means defaults. */
export interface PackageDefinition<C = Readonly<Record<string, never>>> extends Readonly<Omit<PackageDefinitionInput<C>, "setup">> {
  (config?: Partial<C>, options?: PackageInstanceOptions): PackageInstance;
  setup(prism: PackageAPI<C>): void | Promise<void>;
}

/** An entry in `AgentConfig.packages`. */
export type PackageInput = PackageDefinition<any> | PackageInstance;
