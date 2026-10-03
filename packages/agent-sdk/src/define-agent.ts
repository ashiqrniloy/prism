import {
  type Agent as RuntimeAgent,
  type AgentConfig,
  type Principal,
  type Session,
  type AgentSessionConfig,
  type AIProvider,
  type CommandDefinition,
  type CompactionOptions,
  type ContextBudget,
  type ContextSource,
  createAgent,
  createToolRegistry,
  type DuplicateRegistrationOptions,
  type Compactor,
  type LoopStrategy,
  type ModelConfig,
  type OwnershipScope,
  type PackageInput,
  type PermissionPolicy,
  type ProviderResolver,
  type RunLimits,
  type SessionStore,
  type ToolDefinition,
  type ToolResultFoldOptions,
  type TrustPolicy,
  registerContextSources,
} from "@arnilo/prism";
import { createJsonlSessionStore } from "@arnilo/prism/node/session-store-jsonl";
import { AgentSdkConfigError } from "./errors.js";
import { assembleHooksPlane, type HooksPlaneConfig } from "./planes/hooks.js";
import { assembleInstructionsPlane, type InstructionsPlaneConfig } from "./planes/instructions.js";
import { assembleMcpPlane, type McpPlaneConfig, type McpServerStatus } from "./planes/mcp.js";
import { assembleSkillsPlane, type SkillsPlaneConfig } from "./planes/skills.js";
import { type ResolveToolPlaneOptions, resolveToolPlane } from "./tool-plane.js";

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

export interface AgentSdkConfig extends ResolveToolPlaneOptions {
  /** Model configuration (provider, model name, limits, cost, capabilities). Required. */
  readonly model: ModelConfig;
  /** Host-supplied AI provider instance. Supply this or {@link providerSource}. SDK never resolves credentials directly. */
  readonly provider?: AIProvider;
  /**
   * Per-run provider resolver. When set (instead of `provider`), `AgentConfig` carries no fixed provider,
   * so `RunOptions.providerSource` and `RunOptions.model` can switch provider/model between runs.
   */
  readonly providerSource?: ProviderResolver;
  /** Optional nested tools configuration. Overrides or augments top-level tool plane fields. */
  readonly tools?: ResolveToolPlaneOptions;
  /**
   * Programmatic `context.build` sources, applied after the hooks-plane / instructions-plane
   * contributions. Replaces the retired `context` (ContextProvider) and `instructionInjectors`
   * fields; each source's text reaches the provider view once per turn.
   */
  readonly contextSources?: readonly ContextSource[];
  /**
   * Host hook registrations, applied after the hooks/instructions planes. Replaces the retired
   * `stopHooks` and `context` fields: the returned handler for `run.end` gates, `turn.before`
   * policies, and dynamic `context.build` projections all install here. The registrar is the
   * agent's own per-agent bus, so registrations share its lifetime and its ordering.
   */
  readonly registerHooks?: (hooks: import("@arnilo/prism").HookRegistrar) => void;
  /** Kernel packages loaded by `createAgent`. Host tool/skill/command lists must not repeat what these register. */
  readonly packages?: readonly PackageInput[];
  /**
   * Root directory of the project / workspace.
   * Used as the default root for skills discovery and AGENTS.md auto-load.
   */
  readonly workspaceRoot?: string;
  /**
   * Trust policy gating filesystem access.
   * When omitted, defaults to path containment under workspaceRoot.
   */
  readonly trust?: TrustPolicy;
  /** Skills plane configuration (auto-discovery under `.agents/skills`). */
  readonly skills?: SkillsPlaneConfig;
  /** Instructions plane configuration or base instructions text. */
  readonly instructions?: string | InstructionsPlaneConfig;
  /** Hooks plane configuration (`hooks.json` adapter). */
  readonly hooks?: HooksPlaneConfig;
  /** MCP plane configuration (servers to connect eagerly). */
  readonly mcp?: McpPlaneConfig;
  /**
   * Session store. Omitted or `"memory"` uses the runtime's in-memory default.
   * `{ type: "jsonl", path }` builds the JSONL file store; a raw `SessionStore`
   * passes through untouched. Any other shape fails closed (sqlite is a later phase).
   */
  readonly store?: SessionStore | "memory" | { readonly type: "jsonl"; readonly path: string };
  /** Agent loop strategy. Defaults to the kernel loop. */
  readonly loop?: LoopStrategy;
  /** Compactor for the `compaction` slot. Defaults to the kernel compactor. */
  readonly compactor?: Compactor;
  /** Permission / execution policy. */
  readonly policy?: PermissionPolicy;
  /** Ownership scope. */
  readonly ownership?: OwnershipScope;
  /** Opaque optional host principal; packages own verification. */
  readonly principal?: Principal;
  /** Run limits. */
  readonly limits?: RunLimits;
  /** Optional agent identifier. */
  readonly id?: string;
  /** Optional agent display name. */
  readonly name?: string;
  /** Host-supplied commands for host-only dispatch (not model-visible tools). */
  readonly commands?: readonly CommandDefinition[];
  /** Optional compaction sizing and threshold knobs. The implementation is the `compaction` slot. */
  readonly compaction?: false | CompactionOptions;
  /** Optional tool result folding options. */
  readonly toolResultFold?: ToolResultFoldOptions;
  /** Optional context budget configuration. */
  readonly contextBudget?: ContextBudget;
  /** Duplicate tool registration policy. */
  readonly duplicate?: DuplicateRegistrationOptions["duplicate"];
}

// ---------------------------------------------------------------------------
// Definition Result
// ---------------------------------------------------------------------------

export interface AgentSdkMcpPlane {
  /** Per-server state in configuration order, live across reconnects. */
  readonly status: readonly McpServerStatus[];
  /** Bridged tool definitions for one server (empty when unknown or not connected). */
  getServerTools(serverId: string): readonly ToolDefinition[];
  /** Reconnects one server and re-registers its bridged tools for the next run. */
  reconnect(serverId: string): Promise<McpServerStatus>;
  /** Idempotently closes every bridge. */
  close(): Promise<void>;
}

export interface Agent {
  /** The assembled Prism Agent (runtime escape hatch). */
  readonly agent: RuntimeAgent;
  /** Server IDs of successfully connected MCP bridges (live view). */
  readonly connectedMcpServerIds: readonly string[];
  /** Live MCP plane status and reconnect/close controls. */
  readonly mcp: AgentSdkMcpPlane;
  /** Registered host-only commands. */
  readonly commands: readonly CommandDefinition[];
  /**
   * Creates an Session bound to the assembled agent.
   * Throws `AgentSdkConfigError` if the agent definition has already been disposed.
   */
  session(options?: AgentSessionConfig): Promise<Session>;
  /**
   * Closes all active MCP bridges and releases resources.
   * Idempotent: safe to call multiple times.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the store shorthand. `"memory"`/omitted map to the runtime default (undefined);
 * only `{ type: "jsonl", path }` is built here. Unknown shapes fail closed.
 */
function resolveStore(store: AgentSdkConfig["store"]): SessionStore | undefined {
  if (store === undefined || store === "memory") return undefined;
  if (typeof store === "string") {
    throw new AgentSdkConfigError(`Unknown store: "${store}" (expected "memory", { type: "jsonl", path }, or a SessionStore)`);
  }
  if ("type" in store) {
    if (store.type === "jsonl" && typeof store.path === "string" && store.path.length > 0) {
      return createJsonlSessionStore(store.path);
    }
    throw new AgentSdkConfigError(`Unknown store type: ${JSON.stringify((store as { type?: unknown }).type)} (only "jsonl" is supported)`);
  }
  return store;
}

// ---------------------------------------------------------------------------
// defineAgent Assembly
// ---------------------------------------------------------------------------

/**
 * Systematically assembles a configurable agentic runtime from Prism seams.
 *
 * One call configures tool planes, skills, instructions, MCP client bridges,
 * hooks, and session stores. Every capability plane is optional and replaceable.
 *
 * @param config Agent configuration specifying model, provider, planes, and policies.
 * @returns An `Agent` with the assembled runtime, session factory, and disposal.
 */
export async function defineAgent(config: AgentSdkConfig): Promise<Agent> {
  if (!config || typeof config !== "object") {
    throw new AgentSdkConfigError("Configuration object is required");
  }

  if (!config.model) {
    throw new AgentSdkConfigError("Missing required config: model");
  }

  if (!config.provider && !config.providerSource) {
    throw new AgentSdkConfigError("Missing required config: provider or providerSource");
  }

  if ("identity" in config) throw new AgentSdkConfigError("Unknown config field: identity (use principal)");
  const store = resolveStore(config.store);

  const workspaceRoot = config.workspaceRoot ?? config.skills?.workspaceRoot;
  const trust = config.trust ?? config.skills?.trust;

  // 1. Skills Plane (discovery under .agents/skills)
  const skillsPlane = await assembleSkillsPlane(
    config.skills
      ? {
          workspaceRoot,
          trust,
          ...config.skills,
        }
      : undefined,
  );

  // 2. Instructions Plane (text + AGENTS.md / SYSTEM.md layers)
  const instructionsPlane = await assembleInstructionsPlane({
    instructions: config.instructions,
    workspaceRoot,
    trust,
  });

  // 3. Hooks Plane (hooks.json compiled extension)
  const hooksPlane = await assembleHooksPlane({
    hooks: config.hooks,
    workspaceRoot,
    trust,
  });

  // 4. MCP Plane (eagerly connected servers)
  const mcpPlane = await assembleMcpPlane(config.mcp);

  // 5. Tool Plane Resolution
  const toolsOptions: ResolveToolPlaneOptions = {
    planes: config.tools?.planes ?? config.planes,
    exclude: config.tools?.exclude ?? config.exclude,
    replace: config.tools?.replace ?? config.replace,
    add: config.tools?.add ?? config.add,
  };

  const localTools = resolveToolPlane(toolsOptions);
  // MCP bridged tools are appended after the local plane, per server so reconnects can swap them.
  const mcpToolsByServer = new Map<string, readonly ToolDefinition[]>();
  for (const server of mcpPlane.status) {
    if (server.state === "connected") mcpToolsByServer.set(server.serverId, mcpPlane.getServerTools(server.serverId));
  }
  const allTools = [...localTools, ...mcpPlane.tools];

  const duplicatePolicy = config.tools ? config.duplicate : config.duplicate;
  const toolRegistry = createToolRegistry(allTools, {
    duplicate: duplicatePolicy,
  });
  // Live view the kernel reads each run: `reconnect` swaps entries in place so the agent sees them.
  const toolList: ToolDefinition[] = [...toolRegistry.list()];

  // 6. Host Commands (host-only dispatch, not model-visible tools)
  const commands = dedupeCommands(config.commands ?? [], config.duplicate ?? "error");

  // 7. Assembled Agent Configuration
  const agentConfig: AgentConfig = {
    id: config.id,
    name: config.name,
    model: config.model,
    provider: config.provider,
    providerSource: config.providerSource,
    tools: { add: toolList },
    instructions: instructionsPlane.instructionsText,
    systemPrompt: instructionsPlane.systemPromptLayers.length > 0 ? instructionsPlane.systemPromptLayers : undefined,
    // The kernel registers the `load_skill` bridge itself when disclosure is progressive.
    skills: {
      add: skillsPlane.activateAllSkills === false ? [] : (skillsPlane.skills?.list() ?? []),
      disclosure: config.skills?.disclosure,
    },
    slots: {
      ...(store ? { store } : {}),
      ...(config.loop ? { loop: config.loop } : {}),
      ...(config.compactor ? { compaction: config.compactor } : {}),
    },
    compaction: config.compaction,
    toolResultFold: config.toolResultFold,
    contextBudget: config.contextBudget,
    // Roadmap §2.4: hooks.json contributes `tool.call`/`tool.result` hooks, and
    // `AgentSdkConfig.policy` is a `tool.call` gate (no `AgentConfig.permission`).
    hooks: (hooks: import("@arnilo/prism").HookRegistrar) => {
      registerContextSources(hooks, config.contextSources ?? []);
      config.registerHooks?.(hooks);
      if (config.policy) {
        hooks.on("tool.call", async (payload) => {
          const decision = await config.policy!.check({ kind: "tool", action: "execute", target: payload.name, metadata: {} });
          return decision.allowed ? undefined : { deny: decision.reason ?? `Denied by policy: ${payload.name}` };
        });
      }
    },
    ownership: config.ownership,
    principal: config.principal,
    limits: config.limits,
    trust,
    ...(config.packages || hooksPlane.package
      ? { packages: [...(config.packages ?? []), ...(hooksPlane.package ? [hooksPlane.package] : [])] }
      : {}),
  };

  const agent = await createAgent(agentConfig);

  let disposed = false;

  return {
    agent,
    get connectedMcpServerIds() {
      return mcpPlane.connectedServerIds;
    },
    mcp: {
      get status() {
        return mcpPlane.status;
      },
      getServerTools: (serverId: string) => mcpPlane.getServerTools(serverId),
      async reconnect(serverId: string): Promise<McpServerStatus> {
        const status = await mcpPlane.reconnect(serverId);
        const previous = mcpToolsByServer.get(serverId) ?? [];
        for (const tool of previous) toolRegistry.unregister?.(tool.name);
        const tools = mcpPlane.getServerTools(serverId);
        for (const tool of tools) toolRegistry.register(tool);
        mcpToolsByServer.set(serverId, tools);
        toolList.splice(0, toolList.length, ...toolRegistry.list());
        return status;
      },
      close: () => mcpPlane.close(),
    },
    commands,
    async session(sessionConfig: AgentSessionConfig = {}): Promise<Session> {
      if (disposed) {
        throw new AgentSdkConfigError("Cannot create session: agent has been disposed");
      }
      return await agent.session(sessionConfig);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await mcpPlane.close();
    },
  };
}

function dedupeCommands(
  commands: readonly CommandDefinition[],
  duplicate: DuplicateRegistrationOptions["duplicate"],
): readonly CommandDefinition[] {
  const seen = new Map<string, CommandDefinition>();
  for (const command of commands) {
    if (seen.has(command.name) && duplicate === "error") {
      throw new AgentSdkConfigError(`Duplicate command: ${command.name}`);
    }
    seen.set(command.name, command);
  }
  return [...seen.values()];
}
