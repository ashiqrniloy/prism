import {
  type Agent,
  type AgentConfig,
  type AgentIdentity,
  type AgentLoopOptions,
  type AgentLoopStrategy,
  type AgentSession,
  type AgentSessionConfig,
  type AIProvider,
  type CommandDefinition,
  type CompactionOptions,
  type ContextBudget,
  type ContextProvider,
  createAgent,
  createContributionRegistry,
  createToolRegistry,
  type DuplicateRegistrationOptions,
  type Guardrails,
  type MiddlewareRegistry,
  type ModelConfig,
  type OwnershipScope,
  type PermissionPolicy,
  type ProviderResolver,
  type RunLimits,
  type SessionStore,
  type ToolDefinition,
  type ToolResultFoldOptions,
  type TrustPolicy,
} from "@arnilo/prism";
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
  /** Session store (defaults to in-memory store in Prism runtime). */
  readonly store?: SessionStore;
  /** Agent loop strategy or loop options (e.g. singleShotLoop). */
  readonly loop?: AgentLoopStrategy | AgentLoopOptions;
  /** Middleware registry. */
  readonly middleware?: MiddlewareRegistry;
  /** Permission / execution policy. */
  readonly policy?: PermissionPolicy;
  /** Context providers. */
  readonly context?: readonly ContextProvider[];
  /** Guardrails. */
  readonly guardrails?: Guardrails;
  /** Ownership scope. */
  readonly ownership?: OwnershipScope;
  /** Enterprise identity. */
  readonly identity?: AgentIdentity;
  /** Run limits. */
  readonly limits?: RunLimits;
  /** Optional agent identifier. */
  readonly id?: string;
  /** Optional agent display name. */
  readonly name?: string;
  /** Host-supplied commands for host-only dispatch (not model-visible tools). */
  readonly commands?: readonly CommandDefinition[];
  /** Optional compaction configuration / strategy. */
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

export interface AgentSdkDefinition {
  /** The assembled Prism Agent. */
  readonly agent: Agent;
  /** Server IDs of successfully connected MCP bridges (live view). */
  readonly connectedMcpServerIds: readonly string[];
  /** Live MCP plane status and reconnect/close controls. */
  readonly mcp: AgentSdkMcpPlane;
  /** Registered host-only commands. */
  readonly commands: readonly CommandDefinition[];
  /**
   * Creates an AgentSession bound to the assembled agent.
   * Throws `AgentSdkConfigError` if the agent definition has already been disposed.
   */
  createSession(options?: AgentSessionConfig): AgentSession;
  /**
   * Closes all active MCP bridges and releases resources.
   * Idempotent: safe to call multiple times.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeGuardrails(a?: Guardrails, b?: Guardrails): Guardrails | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    input: [...(a.input ?? []), ...(b.input ?? [])],
    output: [...(a.output ?? []), ...(b.output ?? [])],
    toolInput: [...(a.toolInput ?? []), ...(b.toolInput ?? [])],
    toolOutput: [...(a.toolOutput ?? []), ...(b.toolOutput ?? [])],
    maxConcurrency: b.maxConcurrency ?? a.maxConcurrency,
  };
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
 * @returns An `AgentSdkDefinition` with the assembled agent, session factory, and disposal.
 */
export async function defineAgent(config: AgentSdkConfig): Promise<AgentSdkDefinition> {
  if (!config || typeof config !== "object") {
    throw new AgentSdkConfigError("Configuration object is required");
  }

  if (!config.model) {
    throw new AgentSdkConfigError("Missing required config: model");
  }

  if (!config.provider && !config.providerSource) {
    throw new AgentSdkConfigError("Missing required config: provider or providerSource");
  }

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

  // 6. Host Commands (host-only dispatch, not model-visible tools)
  const commandRegistry = createContributionRegistry<CommandDefinition>({
    label: "command",
    duplicate: config.duplicate ?? "error",
  });
  if (config.commands) {
    for (const cmd of config.commands) {
      commandRegistry.register(cmd.name, cmd);
    }
  }

  // 7. Assembled Agent Configuration
  const agentConfig: AgentConfig = {
    id: config.id,
    name: config.name,
    model: config.model,
    provider: config.provider,
    providerSource: config.providerSource,
    tools: toolRegistry,
    instructions: instructionsPlane.instructionsText,
    systemPrompt: instructionsPlane.systemPromptLayers.length > 0 ? instructionsPlane.systemPromptLayers : undefined,
    skills: skillsPlane.skills,
    activateAllSkills: skillsPlane.activateAllSkills ? true : undefined,
    skillsDisclosure: config.skills?.disclosure,
    store: config.store,
    loop: config.loop,
    compaction: config.compaction,
    toolResultFold: config.toolResultFold,
    contextBudget: config.contextBudget,
    middleware: hooksPlane.middleware ?? config.middleware,
    guardrails: mergeGuardrails(hooksPlane.guardrails, config.guardrails),
    stopHooks: hooksPlane.stopHooks,
    instructionInjectors: hooksPlane.instructionInjectors,
    permission: config.policy,
    context: config.context,
    ownership: config.ownership,
    identity: config.identity,
    limits: config.limits,
    trust,
  };

  const agent = createAgent(agentConfig);

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
        return status;
      },
      close: () => mcpPlane.close(),
    },
    commands: commandRegistry.list(),
    createSession(sessionConfig: AgentSessionConfig = {}): AgentSession {
      if (disposed) {
        throw new AgentSdkConfigError("Cannot create session: agent has been disposed");
      }
      return agent.createSession(sessionConfig);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await mcpPlane.close();
    },
  };
}
