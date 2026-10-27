import type { AgentConfig, AgentEvent, JsonObject, ModelConfig, ModelProvider, Skill, ToolDefinition } from "../contracts.js";
import type { HookBus, HookRegistrar } from "../hooks/index.js";
import type { HostPort } from "../host/types.js";
import { type SecretRedactor } from "../redaction.js";
import type { SessionContext } from "../session-context.js";
import { type SlotAssignments, type SlotRegistry } from "../slots/index.js";
import type { PackageCommand, PackageCommandInfo } from "./api.js";
import { type Capability } from "./capabilities.js";
import { type PackageConfigSource } from "./config.js";
export interface LoadPackagesOptions {
    readonly inputs: readonly import("./api.js").PackageInput[];
    readonly packageConfig?: Readonly<Record<string, unknown>>;
    /** `AgentConfig.hooks`: an inline, unnamed package with owner `host` that loads last. */
    readonly hostHooks?: (hooks: HookRegistrar) => void;
    readonly slotAssignments?: SlotAssignments;
    readonly bus: HookBus;
    readonly slots: SlotRegistry;
    readonly host?: HostPort;
    readonly redactor?: SecretRedactor;
    /** The kernel version `requires.prism` is checked against. Tests inject one. */
    readonly kernelVersion: string;
    /**
     * The host's own contributions and overrides: collision checks for tools and skills, `disable`, and the
     * provider resolution `models.client` shares with sessions. Never mutated.
     */
    readonly hostConfig?: Partial<Pick<AgentConfig, "model" | "tools" | "skills" | "retry" | "disable">>;
    /** Values resolved through `credentials.resolve`. Shared with the hook bus so its errors are redacted too. */
    readonly secrets?: string[];
    /** The built-in provider's `fetch`; defaults to the global. */
    readonly fetch?: typeof fetch;
    /** Reads a `skills.addDir` directory. Only called when a package asked for one. */
    readonly readSkillDir?: (path: string) => Promise<readonly Skill[]>;
    /** Agent-scoped fan-out (`agent.subscribe()`): receives each `package.status` after it is recorded and redacted. */
    readonly emitAgentEvent?: (event: AgentEvent) => void;
    /**
     * The agent's effective tool and skill views behind `PackageAPI.tools.list` and `skills.list`/`get`. The agent does
     * not exist while packages load, so `create-agent.ts` passes closures that read it later. Never called during `setup`.
     */
    readonly registry?: {
        readonly tools: () => readonly ToolDefinition[];
        readonly skills: () => readonly Skill[];
    };
}
/** Names the kernel generates tools under, so a package cannot shadow them. `search_tools` left
 *  this set in plan 158 Task 7 — `@arnilo/prism-context-engineering` owns the activation tool, and
 *  Task 8 deleted the kernel's own run-assembly path — so `load_skill` is the only name left. */
export declare const RESERVED_TOOL_NAMES: ReadonlySet<string>;
export interface PackageToolEntry {
    readonly owner: string;
    readonly tool: ToolDefinition;
    readonly when?: (session: SessionContext) => boolean;
}
export interface PackageCommandEntry extends PackageCommandInfo {
    readonly command: PackageCommand;
}
export interface PackageStatusNote {
    readonly package: string;
    readonly level: "info" | "warn";
    readonly message: string;
    readonly at: string;
}
/** One loaded package, as `inspect()` lists it. Config holds refs for secret fields, never values. */
export interface LoadedPackage {
    readonly name: string;
    readonly version: string;
    /** Whether the instance was marked `optional`. */
    readonly optional: boolean;
    /** `skipped`: an `optional` instance whose `setup` threw. Its contributions were unwound. */
    readonly status: "loaded" | "skipped";
    readonly description?: string;
    readonly capabilities: readonly Capability[];
    readonly config: JsonObject;
    readonly configSources: Readonly<Record<string, PackageConfigSource>>;
    /** `code` for a package the host listed, `manifest:<scope>` for one `loadManifest` built. */
    readonly source: "code" | "manifest:user" | "manifest:project";
}
export interface LoadedPackages {
    /** Packages in load order. The inline host package is not listed. */
    readonly packages: readonly LoadedPackage[];
    /** `optional` instances that were skipped, in load order. They hold no contribution. */
    readonly skippedPackages: readonly LoadedPackage[];
    /** Declared capabilities per package name. Owners absent from the map (`host`, `kernel`) are unrestricted. */
    readonly capabilities: ReadonlyMap<string, ReadonlySet<Capability>>;
    statusNotes(): readonly PackageStatusNote[];
    /** Tools packages registered, after `disable`. Read live, so a disposed package's tools are gone. */
    tools(): readonly PackageToolEntry[];
    /** Skills packages registered (and `addDir` read), after `disable`. */
    skills(): readonly Skill[];
    /** The same skills with the package that registered each. */
    skillEntries(): readonly {
        readonly owner: string;
        readonly skill: Skill;
    }[];
    /** A provider a package registered for this `provider` id. */
    provider(id: string): ModelProvider | undefined;
    /** Every provider the agent can resolve: the built-in first, then packages' in load order. */
    providers(): readonly {
        readonly owner: string;
        readonly provider: ModelProvider;
    }[];
    /** The agent's provider resolution: the model's provider id picks from the registry. Throws `Unknown provider: <id>`. */
    resolveProvider(model: ModelConfig): ModelProvider;
    /** Commands packages registered, after `disable`. */
    commands(): readonly PackageCommandEntry[];
    /** Host tool and skill names `disable` removed. They stay in the host's registry and are filtered from every view. */
    readonly disabled: {
        readonly tools: ReadonlySet<string>;
        readonly skills: ReadonlySet<string>;
        readonly packages: ReadonlySet<string>;
    };
    /** The host port as `owner` sees it: `host-ui` is checked against its capabilities and requests are stamped. */
    hostFor(owner: string, sessionId?: string): HostPort;
    /** Applies the values `credentials.resolve` returned on top of `redactor`. Identity when none was resolved. */
    redactor(base: SecretRedactor | undefined): SecretRedactor | undefined;
    /** Whether any loaded package may resolve credentials, so the secret set can grow during a run. */
    readonly resolvesCredentials: boolean;
    /** Whether a loaded package declared session state, so a session must read its branch before it is used. */
    readonly usesSessionState: boolean;
    /** Runs a command's `run`: arguments are validated against its schema first. */
    runCommand(name: string, args: unknown, context: {
        readonly session?: SessionContext;
        readonly agent: import("../contracts.js").Agent;
    }): Promise<unknown>;
    /** Disposes packages in reverse load order and removes every contribution. Idempotent. */
    dispose(): Promise<void>;
}
/**
 * Runs the §2.6 lifecycle: resolve inputs, merge and validate config, order, check `requires`, run
 * `setup`, check services, and resolve slots. Any failure unwinds every package already set up, in
 * reverse order, and rejects with a `PackageLoadError` (or `SlotConflictError`).
 */
export declare function loadPackages(options: LoadPackagesOptions): Promise<LoadedPackages>;
