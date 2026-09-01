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
  type OwnershipScope,
  type SessionStore,
} from "@arnilo/prism";
import { createAcpClientFilesystem, createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import { createAcpFilesystemOperations, createCodingTools } from "@arnilo/prism-coding-tools/agent";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import type { PrismAcpAgentConfig } from "./config.js";

export type { PrismAcpAgentConfig } from "./config.js";
export { ConfigError, loadConfig, parseConfig } from "./config.js";

export interface CreateSpawnableAgentOptions {
  readonly config: PrismAcpAgentConfig;
  /** Model provider for the served Prism agent; default: mock (no tokens). */
  readonly provider?: AIProvider;
}

/** MCP allow-list gate: http/sse servers must match an allow prefix; stdio needs the "stdio" marker. */
export function selectMcpServers(allow: readonly string[], servers: readonly McpServer[]): boolean {
  return servers.every((server) => {
    if ("type" in server) {
      // acp transport is UNSTABLE v2 surface — never bridged.
      return server.type !== "acp" && allow.some((entry) => server.url.startsWith(entry));
    }
    return allow.includes("stdio");
  });
}

export function createSpawnableAgent(options: CreateSpawnableAgentOptions): AgentApp {
  const { config } = options;
  const ownership: OwnershipScope = { userId: config.userId };
  const identity: AgentIdentity = {
    tenantId: "local",
    userId: config.userId,
    principal: { kind: "user", id: config.userId },
    scopes: ["coding"],
    issuedAt: new Date().toISOString(),
    verified: true,
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
    model: { provider: "mock", model: "mock" },
    provider: options.provider ?? createMockProvider(),
    store,
    tools,
    ownership,
    identity,
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });
  // ACP fs adapters carry session ids, so editor-backed tool registries must be
  // built per session instead of shared through the default disk agent.
  const sessionAgents = new Map<string, Agent>();
  return createPrismAcpAgent({
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
    lifecycle: createAgentRunLifecycle({
      checkpoints,
      resolveAgent: ({ agentId }) => {
        if (agentId === defaultAgentId) return { agent: prismAgent, definitionRevision: "1" };
        const sessionAgent = sessionAgents.get(agentId);
        if (!sessionAgent) throw new Error(`Unknown ACP session agent: ${agentId}`);
        return { agent: sessionAgent, definitionRevision: "1" };
      },
    }),
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
}
