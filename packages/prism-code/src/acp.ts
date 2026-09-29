import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import type { AgentApp, McpServer } from "@agentclientprotocol/sdk";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import {
  type Agent,
  type AgentIdentity,
  type AIProvider,
  type CheckpointStore,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createToolRegistry,
  type ExecutionPolicy,
  type OwnershipScope,
  type SessionStore,
  type ToolDefinition,
  type ToolRegistry,
} from "@arnilo/prism";
import { type AcpSessionBinding, createAcpClientFilesystem, createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import { createAcpFilesystemOperations, createTodoContinuationStopHook } from "@arnilo/prism-coding-tools/agent";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { createPrismCodeApprovalPolicy } from "./approval.js";
import { resolvePrismCodeCompaction, resolvePrismCodeContextBudget, resolvePrismCodeToolResultFold } from "./compaction.js";
import type { PrismCodeConfig, PrismCodeModeConfig } from "./config.js";
import { PrismCodeCredentialManager } from "./credentials.js";
import { resolveContinueOnOpenTodos, resolvePrismCodeLimits, resolvePrismCodeLoop } from "./limits.js";
import { createProviderCache, type ProviderCache } from "./providers.js";
import { prepareSessionDbPath } from "./sessions.js";
import { loadReplacementToolModules, loadToolModules } from "./tool-modules.js";
import { resolveCodingToolSet } from "./tools.js";
import { resolveWebTools } from "./web.js";
import { resolveWikiContributions } from "./wiki.js";

// ---------------------------------------------------------------------------
// Constants & MCP Validation Helpers
// ---------------------------------------------------------------------------

export const AMBIGUOUS_PATH_PATTERN = /%2[eEfF]|%5[cC]|\\|\.\./;
export const MAX_URL_LENGTH = 2048;
export const MAX_MCP_SERVERS = 128;

export interface ParsedAllowDestination {
  readonly kind: "stdio" | "url";
  readonly origin?: string;
  readonly path?: string;
}

export function parseAllowDestination(entry: string): ParsedAllowDestination | null {
  if (entry === "stdio") {
    return { kind: "stdio" };
  }
  if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_URL_LENGTH) {
    return null;
  }
  const urlWithoutQuery = entry.split(/[?#]/, 1)[0] ?? entry;
  if (AMBIGUOUS_PATH_PATTERN.test(urlWithoutQuery)) {
    return null;
  }
  try {
    const url = new URL(entry);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password || url.search || url.hash) {
      return null;
    }
    let path = url.pathname;
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1);
    }
    return { kind: "url", origin: url.origin, path };
  } catch {
    return null;
  }
}

export function selectMcpServers(allow: readonly string[], servers: readonly McpServer[]): boolean {
  if (!Array.isArray(allow) || !Array.isArray(servers)) return false;
  if (servers.length > MAX_MCP_SERVERS) return false;

  const destinations = allow
    .map((entry) => parseAllowDestination(entry))
    .filter((entry): entry is ParsedAllowDestination => entry !== null);

  return servers.every((server) => {
    if (typeof server !== "object" || server === null) return false;

    const isStdio = !("type" in server) || (server as { type?: string }).type === "stdio";
    if (isStdio) {
      return destinations.some((d) => d.kind === "stdio");
    }

    if (server.type === "acp") return false;
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

// ---------------------------------------------------------------------------
// Tool Resolution Helper
// ---------------------------------------------------------------------------

interface BuildSessionToolsOptions {
  readonly cwd: string;
  readonly config: PrismCodeConfig;
  readonly fsOperations?: ReturnType<typeof createAcpFilesystemOperations>;
  readonly modeId?: string;
  readonly addTools?: readonly ToolDefinition[];
  readonly replaceTools?: Readonly<Record<string, ToolDefinition>>;
  readonly permissions?: ExecutionPolicy;
}

function buildSessionTools(opts: BuildSessionToolsOptions): ToolRegistry {
  const { cwd, config, fsOperations, modeId, addTools = [], replaceTools = {}, permissions } = opts;
  const isReadOnly = modeId === "architect" || modeId === "ask" || modeId === "read_only";

  const finalTools = resolveCodingToolSet({
    cwd,
    config,
    permissions,
    isReadOnly,
    addTools,
    replaceTools,
    toolOptions: fsOperations
      ? {
          read: { operations: fsOperations.read },
          write: { operations: fsOperations.write },
          edit: { operations: fsOperations.edit },
        }
      : undefined,
  });

  return createToolRegistry(finalTools);
}

// ---------------------------------------------------------------------------
// ACP Agent Assembly
// ---------------------------------------------------------------------------

const DEFAULT_MODES: readonly PrismCodeModeConfig[] = [
  { id: "code", name: "Code", description: "Full coding and editing tools" },
  { id: "architect", name: "Architect", description: "Read-only exploration and architecture" },
];

export interface CreatePrismCodeAcpAgentOptions {
  readonly config: PrismCodeConfig;
  readonly provider?: AIProvider;
  readonly credentialManager?: PrismCodeCredentialManager;
  /** Shared provider cache; ACP sessions resolve providers through it instead of a fixed instance. */
  readonly providerCache?: ProviderCache;
  /** Prism home for the default session store; defaults to `PRISM_HOME`/`~/.prism`. */
  readonly home?: string;
}

export async function createPrismCodeAcpAgent(options: CreatePrismCodeAcpAgentOptions): Promise<AgentApp> {
  const { config } = options;
  const credentials = options.credentialManager ?? new PrismCodeCredentialManager();
  const sessionModel = config.model ?? { provider: "mock", model: "default" };

  const cache =
    options.providerCache ??
    createProviderCache({
      credentialRef: config.credentialRef,
      resolver: credentials.createResolver(),
      credentialManager: credentials,
    });
  if (options.provider) {
    cache.seed(sessionModel.provider, options.provider);
    cache.seed(options.provider.id, options.provider);
  } else {
    await cache.prime(sessionModel);
  }

  let store: SessionStore;
  let checkpoints: CheckpointStore;
  if (config.store?.type === "memory") {
    store = createMemorySessionStore();
    checkpoints = createMemoryCheckpointStore();
  } else {
    const persistence = createSqlitePersistence({ filename: prepareSessionDbPath(config, options.home) });
    store = persistence;
    checkpoints = persistence.checkpoints;
  }

  const ownership: OwnershipScope = { userId: config.userId ?? "local" };
  const identity: AgentIdentity = {
    tenantId: "local",
    userId: config.userId ?? "local",
    principal: { kind: "user", id: config.userId ?? "local" },
    scopes: ["coding"],
    issuedAt: new Date().toISOString(),
    verified: true,
  };

  const addTools = await loadToolModules(config.tools?.add ?? [], config.cwd, {
    allowList: config.tools?.allowedModules,
    workspaceRoot: config.cwd,
  });

  const replaceTools = await loadReplacementToolModules(config.tools?.replace ?? {}, config.cwd, {
    allowList: config.tools?.allowedModules,
    workspaceRoot: config.cwd,
  });

  // Same web plane and wiki extension contributions as the SDK surfaces.
  const web = await resolveWebTools(config, credentials);
  const wiki = await resolveWikiContributions(config, { webTools: web.tools });
  addTools.push(...web.tools, ...wiki.tools);

  const defaultAgentId = "prism-code-agent";
  // Human approval in ACP is the client's permission request (interruptBeforeTool); the shared policy
  // still applies execution security hard denies and path containment before any tool runs.
  const acpApproval = createPrismCodeApprovalPolicy({ roots: [config.cwd], cwd: config.cwd, mode: "auto" });
  const defaultTools = buildSessionTools({
    cwd: config.cwd,
    config,
    addTools,
    replaceTools,
    permissions: acpApproval.policy,
  });

  const resolvedLimits = resolvePrismCodeLimits(config.limits);
  const resolvedLoop = resolvePrismCodeLoop(config.loop);
  const continueOnOpenTodos = resolveContinueOnOpenTodos(config.loop);
  const todoStopHook = continueOnOpenTodos ? createTodoContinuationStopHook() : undefined;
  const resolvedCompaction = resolvePrismCodeCompaction(config.compaction, sessionModel, cache);
  const resolvedToolResultFold = resolvePrismCodeToolResultFold();
  const resolvedContextBudget = resolvePrismCodeContextBudget(sessionModel);

  const baseAgent = createAgent({
    id: defaultAgentId,
    model: sessionModel,
    providerSource: (model) => cache.get(model),
    store,
    tools: defaultTools,
    ownership,
    identity,
    limits: resolvedLimits,
    ...(resolvedLoop ? { loop: resolvedLoop } : {}),
    ...(todoStopHook ? { stopHooks: [todoStopHook] } : {}),
    compaction: resolvedCompaction,
    toolResultFold: resolvedToolResultFold,
    contextBudget: resolvedContextBudget,
    ...(wiki.instructionInjectors.length > 0 ? { instructionInjectors: wiki.instructionInjectors } : {}),
    ...(wiki.skills.length > 0 ? { skills: wiki.skills } : {}),
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });

  const sessionAgents = new Map<string, Agent>();
  const activeSessions = new Map<
    string,
    {
      sessionId: string;
      cwd: string;
      title?: string;
      updatedAt: string;
      binding: AcpSessionBinding;
      modeId?: string;
      fsOperations?: ReturnType<typeof createAcpFilesystemOperations>;
    }
  >();

  const resolveAgent = ({ agentId }: { agentId: string }) => {
    if (agentId === defaultAgentId) return { agent: baseAgent, definitionRevision: "1" };
    let sessionAgent = sessionAgents.get(agentId);
    if (!sessionAgent) {
      if (agentId.startsWith(`${defaultAgentId}:`)) {
        sessionAgent = createAgent({ ...baseAgent.config, id: agentId, tools: defaultTools });
        sessionAgents.set(agentId, sessionAgent);
      } else {
        throw new Error(`Unknown ACP session agent: ${agentId}`);
      }
    }
    return { agent: sessionAgent, definitionRevision: "1" };
  };

  const lifecycle = Object.assign(createAgentRunLifecycle({ checkpoints, resolveAgent }), { resolveAgent });

  const configModes = config.modes?.modes ?? DEFAULT_MODES;
  const defaultModeId = config.modes?.defaultModeId ?? configModes[0]?.id;

  const app = createPrismAcpAgent({
    name: "Prism Code ACP Agent",
    authorize: () => ({ ownership }),
    sessionFactory: async (input) => {
      const sessionId = input.sessionId ?? randomUUID();
      let fsOperations: ReturnType<typeof createAcpFilesystemOperations> | undefined;
      if (input.coding?.filesystem) {
        fsOperations = createAcpFilesystemOperations(input.coding.filesystem);
      }

      const modeId = defaultModeId;
      const sessionTools = buildSessionTools({
        cwd: config.cwd,
        config,
        fsOperations,
        modeId,
        addTools,
        replaceTools,
        permissions: acpApproval.policy,
      });

      const agentId = `${defaultAgentId}:${sessionId}`;
      const sessionAgent = createAgent({
        ...baseAgent.config,
        id: agentId,
        tools: sessionTools,
      });
      sessionAgents.set(agentId, sessionAgent);

      const binding: AcpSessionBinding = {
        session: sessionAgent.createSession({ id: sessionId }),
        agentId,
        tools: sessionTools,
      };

      activeSessions.set(sessionId, {
        sessionId,
        cwd: config.cwd,
        updatedAt: new Date().toISOString(),
        binding,
        modeId,
        fsOperations,
      });

      return binding;
    },
    lifecycle,
    sessions: {
      async load({ sessionId }) {
        if (!sessionId) throw new Error("sessionId required");
        const entry = activeSessions.get(sessionId);
        if (!entry) throw new Error(`unknown session: ${sessionId}`);
        return entry.binding;
      },
      async list() {
        return [...activeSessions.values()].map((s) => ({
          sessionId: s.sessionId,
          cwd: s.cwd,
          title: s.title,
          updatedAt: s.updatedAt,
        }));
      },
      async delete({ sessionId }) {
        activeSessions.delete(sessionId);
        sessionAgents.delete(`${defaultAgentId}:${sessionId}`);
      },
    },
    coding: {
      filesystem: (client, sessionId) => createAcpClientFilesystem(client, sessionId),
    },
    modes:
      configModes.length > 0
        ? {
            modes: configModes.map((m) => ({
              id: m.id,
              name: m.name,
              ...(m.description ? { description: m.description } : {}),
              apply: async ({ sessionId, modeId }) => {
                if (sessionId && activeSessions.has(sessionId)) {
                  const entry = activeSessions.get(sessionId);
                  if (entry) {
                    entry.modeId = modeId;
                    const updatedTools = buildSessionTools({
                      cwd: config.cwd,
                      config,
                      fsOperations: entry.fsOperations,
                      modeId,
                      addTools,
                      replaceTools,
                      permissions: acpApproval.policy,
                    });
                    const updatedAgent = createAgent({
                      ...baseAgent.config,
                      id: `${defaultAgentId}:${sessionId}`,
                      tools: updatedTools,
                    });
                    sessionAgents.set(`${defaultAgentId}:${sessionId}`, updatedAgent);
                    entry.binding = {
                      session: updatedAgent.createSession({ id: sessionId }),
                      agentId: `${defaultAgentId}:${sessionId}`,
                      tools: updatedTools,
                    };
                  }
                }
              },
            })),
            defaultModeId,
          }
        : undefined,
    configOptions: config.configOptions
      ? {
          options: config.configOptions.options,
        }
      : undefined,
    mcp: config.mcp?.allow
      ? {
          transports: ["http", "sse"],
          select: ({ servers }) => selectMcpServers(config.mcp?.allow ?? [], servers),
        }
      : undefined,
    limits: config.limits as any,
  });

  return Object.assign(app, { lifecycle });
}

// ---------------------------------------------------------------------------
// Stdio Server
// ---------------------------------------------------------------------------

export interface ServeAcpOptions {
  readonly config: PrismCodeConfig;
  readonly stdin?: NodeJS.ReadableStream;
  readonly stdout?: NodeJS.WritableStream;
  readonly provider?: AIProvider;
  readonly credentialManager?: PrismCodeCredentialManager;
  readonly providerCache?: ProviderCache;
  /** Prism home for the default session store; defaults to `PRISM_HOME`/`~/.prism`. */
  readonly home?: string;
}

export async function serveAcp(options: ServeAcpOptions): Promise<void> {
  const agent = await createPrismCodeAcpAgent({
    config: options.config,
    provider: options.provider,
    credentialManager: options.credentialManager,
    providerCache: options.providerCache,
    home: options.home,
  });

  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  const stream = ndJsonStream(
    Writable.toWeb(stdout as Writable) as WritableStream<Uint8Array>,
    Readable.toWeb(stdin as Readable) as ReadableStream<Uint8Array>,
  );

  try {
    const connection = await agent.connect(stream);
    await connection?.closed;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code !== "EPIPE") {
      console.error(`prism-code: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
