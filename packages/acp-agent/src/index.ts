/**
 * Spawnable ACP agent (0.2.8 Task 10 / adoption F3).
 *
 * Thin wiring only: config parsing (src/config.ts) plus this seam builder.
 * Every protocol detail lives in `createPrismAcpAgent` (@arnilo/prism-ag-ui);
 * this package never re-implements ACP. The default provider is the mock
 * provider so the lifecycle works out of the box; wire a real `AIProvider`
 * (e.g. @arnilo/prism-providers/openai) for actual generation.
 */
import { randomUUID } from "node:crypto";
import type { AgentApp, McpServer } from "@agentclientprotocol/sdk";
import {
  type Agent,
  type AgentIdentity,
  type AIProvider,
  type CheckpointStore,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createToolRegistry,
  type ModelConfig,
  type OwnershipScope,
  type SessionStore,
} from "@arnilo/prism";
import { createAcpClientFilesystem, createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import { createAcpFilesystemOperations, createCodingTools } from "@arnilo/prism-coding-tools/agent";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import {
  AMBIGUOUS_PATH_PATTERN,
  ConfigError,
  MAX_URL_LENGTH,
  parseAllowDestination,
  type ParsedAllowDestination,
  type PrismAcpAgentConfig,
} from "./config.js";

export type { PrismAcpAgentConfig } from "./config.js";
export { ConfigError, loadConfig, parseConfig } from "./config.js";

export type CredentialResolver = (ref: string) => string | undefined;

export interface CreateSpawnableAgentOptions {
  readonly config: PrismAcpAgentConfig;
  /** Model provider for the served Prism agent; default: lazy-loaded provider matching config.model. */
  readonly provider?: AIProvider;
  /** Optional model override; must match provider if supplied. */
  readonly model?: ModelConfig;
  /** Optional credential resolver for credentialRef; defaults to reading process.env[ref]. */
  readonly credentialResolver?: CredentialResolver;
}

export const SUPPORTED_PROVIDERS = [
  "mock",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
  "ollama",
  "xai",
  "zai",
  "alibaba",
  "kimi",
  "clinepass",
  "commandcode",
  "neuralwatt",
  "opencode-go",
  "hyper",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const MAX_MCP_SERVERS = 128;

/** MCP allow-list gate: matches normalized origin and exact path or path-segment subtree; stdio needs "stdio". */
export function selectMcpServers(allow: readonly string[], servers: readonly McpServer[]): boolean {
  if (!Array.isArray(allow) || !Array.isArray(servers)) return false;
  if (servers.length > MAX_MCP_SERVERS) return false;

  const destinations = allow
    .map((entry) => parseAllowDestination(entry))
    .filter((entry): entry is ParsedAllowDestination => entry !== null);

  return servers.every((server) => {
    if (typeof server !== "object" || server === null) return false;

    // Check stdio transport: either no "type" property or type is explicitly "stdio"
    const isStdio = !("type" in server) || (server as { type?: string }).type === "stdio";
    if (isStdio) {
      return destinations.some((d) => d.kind === "stdio");
    }

    // ACP transport is an unstable v2 surface — never bridged.
    if (server.type === "acp") return false;

    // HTTP / SSE transport
    if (server.type !== "http" && server.type !== "sse") return false;
    if (typeof server.url !== "string" || !server.url || server.url.length > MAX_URL_LENGTH) return false;

    const urlWithoutQuery = server.url.split(/[?#]/, 1)[0] ?? server.url;
    if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) return false;

    let candidateUrl: URL;
    try {
      candidateUrl = new URL(server.url);
    } catch {
      return false;
    }

    if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") return false;
    if (candidateUrl.username || candidateUrl.password) return false;

    const pathname = candidateUrl.pathname;
    if (pathname.includes("/../") || pathname.endsWith("/..") || pathname === "..") return false;

    return destinations.some((dest) => {
      if (dest.kind !== "url" || !dest.origin) return false;
      if (dest.origin !== candidateUrl.origin) return false;
      if (dest.path === "/" || dest.path === "") return true;
      return pathname === dest.path || pathname.startsWith(`${dest.path}/`);
    });
  });
}

/**
 * Resolve one advertised provider adapter to its provider factory. Construction is inert: no
 * credential is validated and no request is made until `generate` runs. Exported so a host (and the
 * package suite) can verify every id in `SUPPORTED_PROVIDERS` resolves to a real adapter instead
 * of trusting the list.
 */
export async function resolveProviderAdapter(providerId: string, apiKey: string): Promise<AIProvider> {
  switch (providerId) {
    case "openai": {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.createOpenAIResponsesProvider({ apiKey });
    }
    case "anthropic": {
      const mod = await import("@arnilo/prism-providers/anthropic");
      return mod.createAnthropicMessagesProvider({ apiKey });
    }
    case "google": {
      const mod = await import("@arnilo/prism-providers/google");
      return mod.createGoogleGenerateContentProvider({ apiKey });
    }
    case "deepseek": {
      const mod = await import("@arnilo/prism-providers/deepseek");
      return mod.createDeepSeekProvider({ apiKey });
    }
    case "openrouter": {
      const mod = await import("@arnilo/prism-providers/openrouter");
      return mod.createOpenRouterProvider({ apiKey });
    }
    case "ollama": {
      const mod = await import("@arnilo/prism-providers/ollama");
      return mod.createOllamaProvider({ apiKey });
    }
    case "xai": {
      const mod = await import("@arnilo/prism-providers/xai");
      return mod.createXaiProvider({ apiKey });
    }
    case "zai": {
      const mod = await import("@arnilo/prism-providers/zai");
      return mod.createZaiProvider({ apiKey });
    }
    case "alibaba": {
      const mod = await import("@arnilo/prism-providers/alibaba");
      return mod.createAlibabaProvider({ apiKey });
    }
    case "kimi": {
      const mod = await import("@arnilo/prism-providers/kimi");
      return mod.createKimiCodingProvider({ apiKey });
    }
    case "clinepass": {
      const mod = await import("@arnilo/prism-providers/clinepass");
      return mod.createClinePassProvider({ apiKey });
    }
    case "commandcode": {
      const mod = await import("@arnilo/prism-providers/commandcode");
      return mod.createCommandCodeProvider({ apiKey });
    }
    case "neuralwatt": {
      const mod = await import("@arnilo/prism-providers/neuralwatt");
      return mod.createNeuralWattProvider({ apiKey });
    }
    case "opencode-go": {
      const mod = await import("@arnilo/prism-providers/opencode-go");
      return mod.createOpenCodeGoProvider({ apiKey });
    }
    case "hyper": {
      const mod = await import("@arnilo/prism-providers/hyper");
      return mod.createHyperProvider({ apiKey });
    }
    default:
      throw new ConfigError(`unsupported provider adapter: ${providerId}`);
  }
}

function createLazyProvider(providerId: string, apiKey: string): AIProvider {
  let resolvedProvider: AIProvider | null = null;
  return {
    id: providerId,
    async *generate(request) {
      if (!resolvedProvider) {
        resolvedProvider = await resolveProviderAdapter(providerId, apiKey);
      }
      yield* resolvedProvider.generate(request);
    },
  };
}

function resolveCredential(ref: string, provider: string, resolver?: CredentialResolver): string {
  let resolved: string | undefined;
  if (resolver) {
    try {
      resolved = resolver(ref);
    } catch (err) {
      throw new ConfigError(
        `failed to resolve credentialRef "${ref}" for provider "${provider}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (!resolved && typeof process !== "undefined" && process.env) {
    resolved = process.env[ref];
  }
  if (!resolved || typeof resolved !== "string" || resolved.trim().length === 0) {
    throw new ConfigError(`credentialRef "${ref}" for provider "${provider}" could not be resolved from credentialResolver or process.env`);
  }
  return resolved.trim();
}

export function createSpawnableAgent(options: CreateSpawnableAgentOptions): AgentApp {
  const { config } = options;

  let effectiveModel: ModelConfig;
  let effectiveProvider: AIProvider;

  if (options.provider) {
    if (options.model && config.model && options.model.provider !== config.model.provider) {
      throw new ConfigError(
        `model override provider "${options.model.provider}" does not match config provider "${config.model.provider}"`,
      );
    }
    const modelToUse = options.model ?? config.model;
    if (modelToUse) {
      if (modelToUse.provider !== options.provider.id) {
        throw new ConfigError(
          `provider mismatch: model specifies provider "${modelToUse.provider}" but injected provider is "${options.provider.id}"`,
        );
      }
      effectiveModel = modelToUse;
    } else {
      effectiveModel = { provider: options.provider.id, model: options.provider.id };
    }
    effectiveProvider = options.provider;
  } else {
    const modelToUse = options.model ?? config.model;
    if (!modelToUse) {
      throw new ConfigError("model configuration is required (specify model: { provider, model } or opt into explicit mock mode)");
    }
    if (!SUPPORTED_PROVIDERS.includes(modelToUse.provider as SupportedProvider)) {
      throw new ConfigError(`unknown provider "${modelToUse.provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`);
    }
    effectiveModel = modelToUse;
    if (effectiveModel.provider === "mock") {
      effectiveProvider = createMockProvider();
    } else {
      if (!config.credentialRef) {
        throw new ConfigError(`provider "${effectiveModel.provider}" requires credentialRef in config`);
      }
      const apiKey = resolveCredential(config.credentialRef, effectiveModel.provider, options.credentialResolver);
      effectiveProvider = createLazyProvider(effectiveModel.provider, apiKey);
    }
  }

  const ownership: OwnershipScope = { userId: config.userId };
  const identity: AgentIdentity = {
    tenantId: "local",
    userId: config.userId,
    principal: { kind: "user", id: config.userId },
    scopes: ["coding"],
    issuedAt: new Date().toISOString(),
    verified: true,
    credentialRefs: config.credentialRef ? [config.credentialRef] : undefined,
  };
  let store: SessionStore;
  let checkpoints: CheckpointStore;
  if (config.sessionStore.type === "sqlite") {
    const persistence = createSqlitePersistence({ filename: config.sessionStore.path });
    store = persistence;
    checkpoints = persistence.checkpoints;
  } else {
    store = createMemorySessionStore();
    checkpoints = createMemoryCheckpointStore();
  }
  const defaultAgentId = "prism-acp-agent";
  const tools = createToolRegistry(createCodingTools(config.cwd));
  const prismAgent = createAgent({
    id: defaultAgentId,
    model: effectiveModel,
    provider: effectiveProvider,
    store,
    tools,
    ownership,
    identity,
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });
  // ACP fs adapters carry session ids, so editor-backed tool registries must be
  // built per session instead of shared through the default disk agent.
  const sessionAgents = new Map<string, Agent>();
  const resolveAgent = ({ agentId }: { agentId: string }) => {
    if (agentId === defaultAgentId) return { agent: prismAgent, definitionRevision: "1" };
    let sessionAgent = sessionAgents.get(agentId);
    if (!sessionAgent) {
      if (agentId.startsWith(`${defaultAgentId}:`)) {
        sessionAgent = createAgent({ ...prismAgent.config, id: agentId, tools });
        sessionAgents.set(agentId, sessionAgent);
      } else {
        throw new Error(`Unknown ACP session agent: ${agentId}`);
      }
    }
    return { agent: sessionAgent, definitionRevision: "1" };
  };
  const lifecycle = Object.assign(createAgentRunLifecycle({ checkpoints, resolveAgent }), { resolveAgent });
  const app = createPrismAcpAgent({
    name: "Prism ACP Agent",
    authorize: () => ({ ownership }),
    sessionFactory: async (input) => {
      const sessionId = input.sessionId ?? randomUUID();
      let sessionAgent = prismAgent;
      let sessionTools = tools;
      let agentId = defaultAgentId;
      if (input.coding?.filesystem) {
        const operations = createAcpFilesystemOperations(input.coding.filesystem);
        sessionTools = createToolRegistry(
          createCodingTools(input.cwd, {
            read: { operations: operations.read },
            write: { operations: operations.write },
            edit: { operations: operations.edit },
          }),
        );
        agentId = `${defaultAgentId}:${sessionId}`;
        sessionAgent = createAgent({ ...prismAgent.config, id: agentId, tools: sessionTools });
        sessionAgents.set(agentId, sessionAgent);
      }
      return {
        session: sessionAgent.createSession({ id: sessionId }),
        agentId,
        tools: sessionTools,
      };
    },
    lifecycle,
    coding: {
      filesystem: (client, sessionId) => createAcpClientFilesystem(client, sessionId),
    },
    mcp: config.mcp ? { transports: ["http", "sse"], select: ({ servers }) => selectMcpServers(config.mcp!.allow, servers) } : undefined,
    modes: config.modes
      ? { modes: config.modes.modes, ...(config.modes.defaultModeId !== undefined ? { defaultModeId: config.modes.defaultModeId } : {}) }
      : undefined,
    configOptions: config.configOptions ? { options: config.configOptions.options } : undefined,
    limits: config.limits,
  });
  return Object.assign(app, { lifecycle });
}
