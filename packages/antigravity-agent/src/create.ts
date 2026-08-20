import { randomBytes } from "node:crypto";
import type { AgentEvent, AgentIdentity, Guardrails, OwnershipScope, SecretRedactor, ToolDefinition, ToolRegistry } from "@arnilo/prism";
import type { ProcessSessions } from "@arnilo/prism-coding-agent";
import type { PrismMcpAuthorizer } from "@arnilo/prism-mcp";
import { DEFAULT_PRISM_AGENT_NAME, writeEphemeralAgentFile } from "./agent-file.js";
import { createAntigravityConversationStore } from "./conversation.js";
import { createAntigravityEventProjector } from "./mapper.js";
import { createAntigravityMcpExposure, createAntigravityMcpHttpServer } from "./mcp.js";
import type { AgentContextBlockInput, AgentSkillInput } from "./prompt.js";
import { runAntigravityCli } from "./runner.js";
import { resolveToolPolicy } from "./tool-policy.js";
import {
  type AntigravityConversationStore,
  type AntigravityRunContext,
  AntigravityRunnerError,
  type AntigravityRunnerLimits,
  type AntigravityRunResult,
  type AntigravityStreamRecord,
  type AntigravityToolPolicy,
  DEFAULT_AGY_COMMAND,
  DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME,
} from "./types.js";
import { assertValidWorkspacePath, writeEphemeralWorkspaceConfig } from "./workspace-config.js";

export interface AntigravityCliAgentOptions {
  readonly command?: string;
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | string;
  readonly agentName?: string;
  readonly toolPolicy?: AntigravityToolPolicy;
  readonly limits?: AntigravityRunnerLimits;
  readonly conversationStore?: AntigravityConversationStore;
  readonly redactor?: SecretRedactor;
  readonly authorizer?: PrismMcpAuthorizer;
  readonly guardrails?: Guardrails;
  readonly tools?: readonly ToolDefinition[] | ToolRegistry;
  readonly toolSelection?: readonly string[] | ((toolName: string) => boolean);
  readonly serverName?: string;
  readonly port?: number;
  readonly hostname?: string;
  readonly processSessions?: ProcessSessions;
}

export interface AntigravityAgentRunOptions {
  readonly prompt: string;
  readonly cwd: string;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly branchId?: string;
  readonly continueConversation?: boolean;
  readonly systemPrompt?: string;
  readonly taskInstructions?: string;
  readonly skills?: readonly AgentSkillInput[];
  readonly context?: readonly (string | AgentContextBlockInput)[];
  readonly model?: string;
  readonly effort?: "low" | "medium" | "high" | string;
  readonly signal?: AbortSignal;
  readonly identity?: AgentIdentity;
  readonly ownership?: OwnershipScope;
  readonly onRecord?: (record: AntigravityStreamRecord) => void | Promise<void>;
  readonly onEvent?: (event: AgentEvent) => void | Promise<void>;
}

export interface AntigravityCliAgent {
  run(options: AntigravityAgentRunOptions): Promise<AntigravityRunResult>;
  readonly conversationStore: AntigravityConversationStore;
  readonly options: AntigravityCliAgentOptions;
}

export function createAntigravityCliAgent(options: AntigravityCliAgentOptions = {}): AntigravityCliAgent {
  const conversationStore = options.conversationStore ?? createAntigravityConversationStore();
  const serverName = options.serverName ?? DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME;
  const agentName = options.agentName ?? DEFAULT_PRISM_AGENT_NAME;
  const command = options.command ?? DEFAULT_AGY_COMMAND;
  const toolPolicy = options.toolPolicy ?? "prism-mutators";

  return {
    get conversationStore() {
      return conversationStore;
    },
    get options() {
      return options;
    },
    async run(runOptions: AntigravityAgentRunOptions): Promise<AntigravityRunResult> {
      if (!runOptions.prompt?.trim()) {
        throw new AntigravityRunnerError("Prompt must be a non-empty string");
      }

      const realCwd = assertValidWorkspacePath(runOptions.cwd);
      const sessionId = runOptions.sessionId ?? `session-${randomBytes(6).toString("hex")}`;
      const runId = runOptions.runId ?? `run-${randomBytes(6).toString("hex")}`;

      const runContext: AntigravityRunContext = {
        sessionId,
        runId,
        identity: runOptions.identity,
        ownership: runOptions.ownership,
        signal: runOptions.signal,
      };

      // Resolve conversation continuation
      let conversationId: string | undefined;
      if (runOptions.continueConversation !== false) {
        conversationId = conversationStore.get(sessionId, runOptions.branchId);
      }

      // Create MCP Exposure
      const exposure = createAntigravityMcpExposure({
        tools: options.tools,
        toolSelection: options.toolSelection,
        runContext,
        authorize: options.authorizer,
        guardrails: options.guardrails,
        redactor: options.redactor,
        serverName,
      });

      // Start loopback HTTP server
      const httpServer = await createAntigravityMcpHttpServer(exposure, {
        port: options.port ?? 0,
        hostname: options.hostname ?? "127.0.0.1",
      });

      const exposedToolNames = exposure.exposedTools.map((t) => t.name);

      const resolvedPolicy = resolveToolPolicy({
        policy: toolPolicy,
        serverName,
        allowedMcpTools: exposedToolNames,
      });

      // Write ephemeral custom agent Markdown file
      const agentHandle = writeEphemeralAgentFile({
        workspace: realCwd,
        agentName,
        systemPrompt: runOptions.systemPrompt,
        taskInstructions: runOptions.taskInstructions,
        skills: runOptions.skills,
        context: runOptions.context,
        toolPolicy: resolvedPolicy,
        serverName,
        exposedMcpTools: exposedToolNames,
      });

      // Write ephemeral workspace configuration
      const configHandle = writeEphemeralWorkspaceConfig({
        workspace: realCwd,
        serverName,
        mcpConfig: {
          serverUrl: httpServer.serverUrl,
          headers: httpServer.headers,
        },
        allowedMcpTools: exposedToolNames,
        toolPolicy,
      });

      // Setup event projector
      const projector = createAntigravityEventProjector({
        sessionId,
        runId,
        redactor: options.redactor,
      });

      try {
        const result = await runAntigravityCli({
          command,
          prompt: runOptions.prompt,
          cwd: realCwd,
          model: runOptions.model ?? options.model,
          effort: runOptions.effort ?? options.effort,
          agent: agentName,
          conversationId,
          signal: runOptions.signal,
          limits: options.limits,
          processSessions: options.processSessions,
          redactor: options.redactor,
          onRecord: async (rec) => {
            if (runOptions.onRecord) {
              await runOptions.onRecord(rec);
            }
            if (runOptions.onEvent) {
              const events = projector.projectRecord(rec);
              for (const ev of events) {
                await runOptions.onEvent(ev);
              }
            }
          },
        });

        // Store conversation ID for continuation
        if (result.conversationId) {
          conversationStore.set(sessionId, result.conversationId, runOptions.branchId);
        }

        return result;
      } finally {
        await agentHandle.restore().catch(() => {});
        await configHandle.restore().catch(() => {});
        await httpServer.close().catch(() => {});
      }
    },
  };
}
