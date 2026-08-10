import { randomUUID } from "node:crypto";
import {
  type AgentApp,
  type AgentContext,
  agent,
  methods,
  PROTOCOL_VERSION,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationSchema,
  type McpServer,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionInfo,
  type SessionModeState,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import type { AgentEvent, AgentRunLifecycle, AgentSession, JsonObject, PendingDecision, RunDecision, SecretRedactor } from "@arnilo/prism";
import type { CodingLifecycleEmitter } from "@arnilo/prism-coding-agent";
import packageJson from "../../package.json" with { type: "json" };
import { type AgUiLimitOptions, resolveAgUiLimits } from "../limits.js";
import type { AgUiProjection } from "../projection.js";
import type { AgUiAuthorization } from "../types.js";
import {
  type AcpCapabilitiesOptions,
  type AcpCapabilitiesSource,
  type AcpMcpSeams,
  type AcpSessionSummary,
  resolveAcpAgentCapabilities,
  type ResolvedAcpClientCapabilities,
  resolveAcpClientCapabilities,
  type AcpSessionStoreSeams,
} from "./capabilities.js";
import { AcpError } from "./errors.js";
import { type AcpClientFilesystem } from "./fs-client.js";
import { createAcpEventMapper, createAcpLifecycleMapper } from "./mapper.js";
import { validateMcpServers } from "./mcp-config.js";
import {
  type AcpConfigOptionsSeam,
  type AcpModesSeam,
  initialConfigValues,
  initialModeId,
  toSessionConfigOptions,
  toSessionModeState,
  validateConfigOptionValue,
  validateConfigOptionsSeam,
  validateModeSeam,
} from "./modes.js";
import { type AcpPromptResult, projectAcpPrompt } from "./prompt.js";
import { type AcpClientTerminals } from "./terminal-client.js";

export interface AcpAuthorization extends AgUiAuthorization {}

export interface AcpSessionBinding {
  readonly session: AgentSession;
  /** Optional host assertion passed to the durable lifecycle. */
  readonly agentId?: string;
}

/** Client-method adapters the host can wire into its coding tools (built per advertised capability). */
export interface AcpCodingContext {
  readonly filesystem?: AcpClientFilesystem;
  readonly processes?: AcpClientTerminals;
}

/** Host-supplied factory seams; the agent calls them only when the client advertised the matching capability. */
export interface AcpCodingSeams {
  /** Editor-buffer filesystem. Called only when the client advertised fs.readTextFile or fs.writeTextFile; `sessionId` is the ACP session id. */
  readonly filesystem?: (client: AgentContext, sessionId: string) => AcpClientFilesystem | Promise<AcpClientFilesystem>;
  /** Client terminals. Called only when the client advertised terminal; `sessionId` is the ACP session id. */
  readonly processes?: (client: AgentContext, sessionId: string) => AcpClientTerminals | Promise<AcpClientTerminals>;
  /**
   * Host lifecycle emitter. While a session streams, mapped lifecycle events
   * (freeze `lifecycleEventMapping`) are forwarded to that session's client;
   * `configuration_changed` broadcasts `config_option_update` per session.
   */
  readonly lifecycle?: CodingLifecycleEmitter;
}

export interface CreatePrismAcpAgentOptions<Authorization extends AcpAuthorization = AcpAuthorization> {
  readonly name?: string;
  /** Host binds transport identity to Prism ownership. False rejects new sessions. */
  readonly authorize: (input: {
    readonly sessionId?: string;
    readonly signal: AbortSignal;
  }) => Authorization | false | Promise<Authorization | false>;
  /** Host owns session construction; only policy-checked cwd, additionalDirectories, and approved MCP configs are forwarded. */
  readonly sessionFactory: (input: {
    readonly authorization: Authorization;
    readonly signal: AbortSignal;
    /** Pre-generated ACP session id; present only when `coding.processes` is wired and the client advertised terminal. */
    readonly sessionId?: string;
    /** Editor-backed adapters, built from `coding` seams only for client-advertised capabilities. */
    readonly coding?: AcpCodingContext;
    /** Client-supplied working directory (schema-required absolute path); host policy-checks it. */
    readonly cwd: string;
    /** Policy-checked subset of the client's additionalDirectories (empty when none allowed). */
    readonly additionalDirectories: readonly string[];
    /** Cap-validated, host-approved MCP server configs (empty when client sent none). */
    readonly mcpServers: readonly McpServer[];
  }) => AcpSessionBinding | Promise<AcpSessionBinding>;
  readonly lifecycle: AgentRunLifecycle;
  readonly redactor?: SecretRedactor;
  readonly projection?: AgUiProjection;
  readonly limits?: AgUiLimitOptions;
  /** Host-owned session store; presence advertises the matching session capabilities. */
  readonly sessions?: AcpSessionStoreSeams;
  /** MCP seams; presence of `select` plus `transports` advertises mcpCapabilities per transport. */
  readonly mcp?: AcpMcpSeams;
  /** Capability policy seams (prompt media/embedded gates). */
  readonly capabilities?: AcpCapabilitiesOptions;
  /** Host mode table; presence returns `modes` on new/load/resume and enables `session/set_mode`. */
  readonly modes?: AcpModesSeam;
  /** Host config-option table; returned only when the client advertised session.configOptions.boolean. */
  readonly configOptions?: AcpConfigOptionsSeam;
  /** Client-method adapter seams (filesystem/terminals), gated on client advertisements. */
  readonly coding?: AcpCodingSeams;
}

interface ActiveSession extends AcpSessionBinding {
  controller?: AbortController;
  /** Current mode id when `modes` is wired; set at registration and on set_mode. */
  modeId?: string;
  /** Current config-option values (initialized from defaults when `configOptions` is wired). */
  readonly configValues: Map<string, boolean | string>;
  /** Client of the active prompt stream; set only while forward() runs. */
  client?: AgentContext;
  /** Shared per-run notification budget; lifecycle updates count against it. */
  budget?: AcpStreamBudget;
}

type ElicitationPendingDecision = PendingDecision & { readonly kind: "elicitation" };

interface AcpStreamBudget {
  events: number;
  bytes: number;
}

/** Builds a stable ACP v1 agent using Prism sessions and durable-resume streams. */
export function createPrismAcpAgent<Authorization extends AcpAuthorization = AcpAuthorization>(
  options: CreatePrismAcpAgentOptions<Authorization>,
): AgentApp {
  const limits = resolveAgUiLimits(options.limits);
  validateModeSeam(options.modes, limits);
  validateConfigOptionsSeam(options.configOptions, limits);
  // ponytail: bounded in-memory registry (acp.sessions); swap for a host-owned store if replicas share sessions.
  const sessions = new Map<string, ActiveSession>();
  // ponytail: single-connection assumption — initialize may be called once per connection;
  // key by client identity if multi-client hosting ever needs per-connection gating.
  let clientCapabilities: ResolvedAcpClientCapabilities = resolveAcpClientCapabilities(undefined);

  // Lifecycle -> session/update forwarding (freeze lifecycleEventMapping). Updates are
  // delivered only to sessions with an active prompt stream (no client handle otherwise)
  // and count against that session's shared per-run notification budget.
  const lifecycleMapper = createAcpLifecycleMapper({ redactor: options.redactor, projection: options.projection, limits: options.limits });
  if (options.coding?.lifecycle) {
    options.coding.lifecycle.on((event) => {
      if (event.type === "configuration_changed") {
        if (!options.configOptions) return;
        for (const [sessionId, active] of sessions) {
          const client = active.client;
          if (!client) continue;
          const budget = active.budget ?? { events: 0, bytes: 0 };
          const update: SessionUpdate = {
            sessionUpdate: "config_option_update",
            configOptions: toSessionConfigOptions(options.configOptions, active.configValues),
          };
          // ponytail: message-chunk fallback if a client rejects the update kind (freeze note).
          void notify(client, sessionId, update, budget, limits).catch(() =>
            notify(
              client,
              sessionId,
              { sessionUpdate: "agent_message_chunk", messageId: "prism:config", content: { type: "text", text: "Configuration changed" } },
              budget,
              limits,
            ).catch(() => {}),
          );
        }
        return;
      }
      void lifecycleMapper
        .map(event)
        .then((updates) => {
          for (const [sessionId, active] of sessions) {
            const client = active.client;
            if (!client || updates.length === 0) continue;
            const budget = active.budget ?? { events: 0, bytes: 0 };
            for (const update of updates) void notify(client, sessionId, update, budget, limits).catch(() => {});
          }
        })
        .catch(() => {});
    });
  }

  let app = agent({ name: options.name ?? "Prism" })
    .onRequest(methods.agent.initialize, (context) => {
      clientCapabilities = resolveAcpClientCapabilities(context.params.clientCapabilities);
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: resolveAcpAgentCapabilities(options satisfies AcpCapabilitiesSource),
        agentInfo: { name: options.name ?? "Prism", version: packageJson.version },
      };
    })
    .onRequest(methods.agent.session.new, async (context) => {
      const authorization = await options.authorize({ signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      // The ACP session id is generated agent-side only when a coding seam needs it
      // (client fs/terminal requests carry it); otherwise the host keeps generating its own ids.
      const wantsSessionId =
        (options.coding?.processes !== undefined && clientCapabilities.terminal) ||
        (options.coding?.filesystem !== undefined && (clientCapabilities.fsReadTextFile || clientCapabilities.fsWriteTextFile));
      const sessionId = wantsSessionId ? `acp-${randomUUID()}` : undefined;
      const coding = await buildAcpCoding(options.coding, clientCapabilities, context.client, sessionId);
      const inputs = await resolveSessionInputs(context.params, options, limits, context.signal);
      const binding = await options.sessionFactory({
        authorization,
        signal: context.signal,
        sessionId,
        coding,
        cwd: context.params.cwd,
        additionalDirectories: inputs.additionalDirectories,
        mcpServers: inputs.mcpServers,
      });
      if (wantsSessionId && binding.session.id !== sessionId) {
        throw new AcpError("ERR_PRISM_ACP_INPUT", "sessionFactory must return the provided sessionId when coding seams are wired");
      }
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      registerSession(sessions, limits, active);
      return {
        sessionId: binding.session.id,
        ...sessionState(active, options, clientCapabilities),
      };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = session(sessions, context.params.sessionId);
      if (current.controller) throw new Error("ACP session already has an active prompt");
      const projected = await projectAcpPrompt(context.params.prompt, {
        maxBlocks: limits.maxInputMessages,
        maxTextBytes: limits.maxInputTextBytes,
        maxMediaParts: limits.maxInputMediaParts,
        maxMediaBytes: limits.maxInputMediaBytes,
        capabilities: {
          image: options.capabilities?.prompt?.media !== undefined,
          audio: options.capabilities?.prompt?.media !== undefined,
          embeddedContext: options.capabilities?.prompt?.embedded !== undefined,
        },
        policy: {
          media: () => options.capabilities?.prompt?.media?.({ signal: context.signal }) ?? false,
          embedded: () => options.capabilities?.prompt?.embedded?.({ signal: context.signal }) ?? false,
        },
      });
      const controller = abortOn(context.signal);
      current.controller = controller;
      current.budget = { events: 0, bytes: 0 };
      current.client = context.client;
      try {
        await forward(
          current.session.stream(toPrismPrompt(projected), {
            ownership: authorization.ownership,
            redactor: options.redactor,
            signal: controller.signal,
            maxQueuedEvents: limits.maxQueuedEvents,
            overflow: "close",
          }),
          current,
          authorization,
          context.params.sessionId,
          context.client,
          controller.signal,
          limits,
          options,
          clientCapabilities,
        );
        return { stopReason: controller.signal.aborted ? "cancelled" : "end_turn" };
      } finally {
        current.controller = undefined;
        current.client = undefined;
        current.budget = undefined;
      }
    })
    .onNotification(methods.agent.session.cancel, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (authorization) sessions.get(context.params.sessionId)?.controller?.abort(new Error("ACP session cancelled"));
    })
    .onRequest(methods.agent.session.close, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = sessions.get(context.params.sessionId);
      current?.controller?.abort(new Error("ACP session closed"));
      sessions.delete(context.params.sessionId);
    });

  if (options.sessions?.load) {
    app = app.onRequest(methods.agent.session.load, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await resolveSessionInputs(context.params, options, limits, context.signal);
      const binding = await options.sessions!.load!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      registerSession(sessions, limits, active);
      return sessionState(active, options, clientCapabilities);
    });
  }
  if (options.sessions?.resume) {
    app = app.onRequest(methods.agent.session.resume, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await resolveSessionInputs(context.params, options, limits, context.signal);
      const binding = await options.sessions!.resume!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      registerSession(sessions, limits, active);
      return sessionState(active, options, clientCapabilities);
    });
  }
  if (options.sessions?.list) {
    app = app.onRequest(methods.agent.session.list, async (context) => {
      const authorization = await options.authorize({ signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const all = await options.sessions!.list!({ cwd: context.params.cwd ?? undefined, signal: context.signal });
      const offset = parseCursor(context.params.cursor);
      if (Number.isNaN(offset) || offset < 0) throw new AcpError("ERR_PRISM_ACP_INPUT", "invalid list cursor");
      const page = all.slice(offset, offset + limits.acpSessionListPage);
      const nextCursor = offset + page.length < all.length ? String(offset + page.length) : undefined;
      return { sessions: page.map(toSessionInfo), nextCursor };
    });
  }
  if (options.sessions?.delete) {
    app = app.onRequest(methods.agent.session.delete, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await options.sessions!.delete!({ sessionId: context.params.sessionId, signal: context.signal });
      sessions.delete(context.params.sessionId);
      return {};
    });
  }
  if (options.modes) {
    app = app.onRequest(methods.agent.session.setMode, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = session(sessions, context.params.sessionId);
      const mode = options.modes!.modes.find((candidate) => candidate.id === context.params.modeId);
      if (!mode) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown mode '${context.params.modeId}'`);
      await mode.apply?.({ sessionId: context.params.sessionId, fromModeId: current.modeId, modeId: mode.id, signal: context.signal });
      current.modeId = mode.id;
      await notify(
        context.client,
        context.params.sessionId,
        { sessionUpdate: "current_mode_update", currentModeId: mode.id },
        { events: 0, bytes: 0 },
        limits,
      );
      return {};
    });
  }
  if (options.configOptions) {
    app = app.onRequest(methods.agent.session.setConfigOption, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      const current = session(sessions, context.params.sessionId);
      if (!clientCapabilities.configOptionBoolean) {
        throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "client did not advertise session.configOptions.boolean");
      }
      const option = options.configOptions!.options.find((candidate) => candidate.id === context.params.configId);
      if (!option) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown config option '${context.params.configId}'`);
      const value = validateConfigOptionValue(option, context.params.value);
      await options.configOptions!.onChange?.({ sessionId: context.params.sessionId, configId: option.id, value, signal: context.signal });
      current.configValues.set(option.id, value);
      const configOptions = toSessionConfigOptions(options.configOptions!, current.configValues);
      await notify(
        context.client,
        context.params.sessionId,
        { sessionUpdate: "config_option_update", configOptions },
        { events: 0, bytes: 0 },
        limits,
      );
      return { configOptions };
    });
  }
  return app;
}

/**
 * Builds editor-backed adapters from the host seams, gated on the client's
 * initialize advertisement. Returns undefined when no seams are wired.
 */
async function buildAcpCoding(
  seams: AcpCodingSeams | undefined,
  capabilities: ResolvedAcpClientCapabilities,
  client: AgentContext,
  sessionId: string | undefined,
): Promise<AcpCodingContext | undefined> {
  if (!seams) return undefined;
  const filesystem =
    capabilities.fsReadTextFile || capabilities.fsWriteTextFile ? await seams.filesystem?.(client, sessionId ?? "") : undefined;
  const processes = capabilities.terminal && sessionId ? await seams.processes?.(client, sessionId) : undefined;
  return {
    ...(filesystem ? { filesystem } : {}),
    ...(processes ? { processes } : {}),
  };
}

/** Cap-checked registry insert: duplicate id or a full registry fail closed. */
function registerSession(sessions: Map<string, ActiveSession>, limits: ReturnType<typeof resolveAgUiLimits>, binding: ActiveSession): void {
  if (sessions.has(binding.session.id)) throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP session already exists");
  if (sessions.size >= limits.acpSessions) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `ACP session registry is full (${limits.acpSessions})`);
  }
  sessions.set(binding.session.id, binding);
}

/** modes/configOptions response fields for new/load/resume; config options gated on the client advertisement. */
function sessionState<Authorization extends AcpAuthorization>(
  active: ActiveSession,
  options: CreatePrismAcpAgentOptions<Authorization>,
  clientCapabilities: ResolvedAcpClientCapabilities,
): { readonly modes?: SessionModeState; readonly configOptions?: SessionConfigOption[] } {
  return {
    ...(options.modes && active.modeId ? { modes: toSessionModeState(options.modes, active.modeId) } : {}),
    ...(options.configOptions && clientCapabilities.configOptionBoolean
      ? { configOptions: toSessionConfigOptions(options.configOptions, active.configValues) }
      : {}),
  };
}

/** Policy-checks and bounds the client-supplied session inputs shared by new/load/resume. */
async function resolveSessionInputs<Authorization extends AcpAuthorization>(
  params: {
    readonly additionalDirectories?: readonly string[] | null;
    readonly mcpServers?: readonly McpServer[];
  },
  options: CreatePrismAcpAgentOptions<Authorization>,
  limits: ReturnType<typeof resolveAgUiLimits>,
  signal: AbortSignal,
): Promise<{ readonly additionalDirectories: readonly string[]; readonly mcpServers: readonly McpServer[] }> {
  const directories = params.additionalDirectories ?? [];
  let additionalDirectories: readonly string[] = [];
  if (directories.length > 0) {
    const seam = options.sessions?.additionalDirectories;
    if (!seam) throw new AcpError("ERR_PRISM_ACP_POLICY", "additionalDirectories rejected: capability not advertised");
    if (directories.length > limits.acpAdditionalDirectories) {
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `additionalDirectories exceeds ${limits.acpAdditionalDirectories}`);
    }
    for (const path of directories) {
      if (!path || Buffer.byteLength(path, "utf8") > limits.acpAdditionalDirectoryPathBytes) {
        throw new AcpError(
          "ERR_PRISM_ACP_LIMIT",
          `additionalDirectories path invalid or exceeds ${limits.acpAdditionalDirectoryPathBytes} bytes`,
        );
      }
    }
    additionalDirectories = await seam({ directories, signal });
  }
  return { additionalDirectories, mcpServers: await validateMcpServers(params.mcpServers ?? [], options.mcp, limits, signal) };
}

/** Opaque cursor = decimal page offset into the host's ordered list. */
function parseCursor(cursor: string | null | undefined): number {
  if (cursor == null || cursor === "") return 0;
  return /^[0-9]+$/.test(cursor) ? Number(cursor) : Number.NaN;
}

function toSessionInfo(summary: AcpSessionSummary): SessionInfo {
  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd,
    ...(summary.additionalDirectories ? { additionalDirectories: [...summary.additionalDirectories] } : {}),
    ...(summary.title ? { title: summary.title } : {}),
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
  };
}

async function forward<Authorization extends AcpAuthorization>(
  source: AsyncIterable<AgentEvent>,
  current: ActiveSession,
  authorization: Authorization,
  sessionId: string,
  client: AgentContext,
  signal: AbortSignal,
  limits: ReturnType<typeof resolveAgUiLimits>,
  options: CreatePrismAcpAgentOptions<Authorization>,
  clientCapabilities: ResolvedAcpClientCapabilities,
): Promise<void> {
  const budget = current.budget ?? { events: 0, bytes: 0 };
  const mapper = createAcpEventMapper({ redactor: options.redactor, projection: options.projection, limits: options.limits });
  for await (const event of source) {
    for (const update of await mapper.map(event)) await notify(client, sessionId, update, budget, limits);
    if (event.type !== "agent_suspended") continue;
    const pending = event.interruption.pendingDecisions ?? [];
    const elicitations = pending.filter((decision): decision is ElicitationPendingDecision => decision.kind === "elicitation");
    const approvals = pending.filter((decision) => decision.kind === "tool_approval");
    if (elicitations.length > 0 && clientCapabilities.elicitation && approvals.length === 0) {
      // Elicitation batch: one form elicitation per pending decision; accept carries the
      // typed payload, decline/cancel deny (parity). Mixed batches stay on the shared path.
      const responses = await Promise.all(elicitations.map((decision) => elicit(client, sessionId, event, decision, budget, limits)));
      const decision = decisionForElicitation(responses, elicitations);
      await forward(
        options.lifecycle.resumeStream(
          { sessionId: event.sessionId, runId: event.runId },
          { ...decision, expectedVersion: event.version },
          { ownership: authorization.ownership, agentId: current.agentId, signal, overflow: "close" },
        ),
        current,
        authorization,
        sessionId,
        client,
        signal,
        limits,
        options,
        clientCapabilities,
      );
      return;
    }
    const response = await permission(client, sessionId, event, budget, limits);
    const decision = decisionFor(response, event.interruption);
    await forward(
      options.lifecycle.resumeStream(
        { sessionId: event.sessionId, runId: event.runId },
        { ...decision, expectedVersion: event.version },
        { ownership: authorization.ownership, agentId: current.agentId, signal, overflow: "close" },
      ),
      current,
      authorization,
      sessionId,
      client,
      signal,
      limits,
      options,
      clientCapabilities,
    );
    return;
  }
}

function session(sessions: ReadonlyMap<string, ActiveSession>, id: string): ActiveSession {
  const value = sessions.get(id);
  if (!value) throw new Error("Unknown ACP session");
  return value;
}

/** Prism user message for the host session: text blocks plus forwarded media parts. */
function toPrismPrompt(projected: AcpPromptResult): import("@arnilo/prism").Message {
  const content: import("@arnilo/prism").ContentBlock[] = [{ type: "text", text: projected.text }];
  for (const part of projected.media ?? []) {
    if (part.type === "image")
      content.push({ type: "image", mimeType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
    else if (part.type === "audio")
      content.push({ type: "audio", mediaType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
    else content.push({ type: "file", mediaType: part.mediaType, data: part.data, ...(part.name ? { name: part.name } : {}) });
  }
  return { role: "user", content };
}

async function notify(
  client: AgentContext,
  sessionId: string,
  update: SessionUpdate,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<void> {
  const bytes = Buffer.byteLength(JSON.stringify({ sessionId, update }), "utf8");
  if (bytes > limits.maxEventBytes || ++budget.events > limits.maxStreamEvents || (budget.bytes += bytes) > limits.maxStreamBytes)
    throw new Error("ACP update limit exceeded");
  await client.notify(methods.client.session.update, { sessionId, update });
}

async function permission(
  client: AgentContext,
  sessionId: string,
  event: Extract<AgentEvent, { readonly type: "agent_suspended" }>,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<RequestPermissionResponse> {
  const toolCallId = truncate(event.interruption.toolCallId ?? `prism:${event.runId}:${event.version}`, limits.maxTextBytes);
  await notify(
    client,
    sessionId,
    { sessionUpdate: "tool_call", toolCallId, title: "Approval required", kind: "other", status: "pending" },
    budget,
    limits,
  );
  try {
    return await client.request(methods.client.session.requestPermission, {
      sessionId,
      toolCall: { toolCallId, title: "Approval required", kind: "other", status: "pending" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-for-run", name: "Allow for run", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject once", kind: "reject_once" },
        { optionId: "reject-for-run", name: "Reject for run", kind: "reject_always" },
      ],
    });
  } catch {
    return { outcome: { outcome: "cancelled" } };
  }
}

/**
 * Elicitation flow (client advertised elicitation, all-elicitation batch): a pending
 * form elicitation surfaces as `elicitation/create` with the decision's bounded
 * schema; accept carries the typed payload, any decline/cancel denies. Errors and
 * unrecognized responses deny (fail closed). Never forwards raw tool arguments.
 */
async function elicit(
  client: AgentContext,
  sessionId: string,
  event: Extract<AgentEvent, { readonly type: "agent_suspended" }>,
  decision: ElicitationPendingDecision,
  budget: AcpStreamBudget,
  limits: ReturnType<typeof resolveAgUiLimits>,
): Promise<CreateElicitationResponse> {
  const toolCallId = truncate(
    decision.toolCallId ?? event.interruption.toolCallId ?? `prism:${event.runId}:${event.version}`,
    limits.maxTextBytes,
  );
  await notify(
    client,
    sessionId,
    { sessionUpdate: "tool_call", toolCallId, title: "Input required", kind: "other", status: "pending" },
    budget,
    limits,
  );
  const request: CreateElicitationRequest = {
    mode: "form",
    message: truncate(event.interruption.reason, limits.maxTextBytes),
    requestedSchema: (decision.elicitationSchema ?? { type: "object" }) as ElicitationSchema,
    sessionId,
    ...(toolCallId ? { toolCallId } : {}),
  };
  try {
    return await client.request(methods.client.elicitation.create, request);
  } catch {
    return { action: "cancel" };
  }
}

/** Maps elicitation responses onto the shared decision batch; accept carries the payload, everything else denies. */
function decisionForElicitation(
  responses: readonly CreateElicitationResponse[],
  decisions: readonly ElicitationPendingDecision[],
): { readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] } {
  const mapped = decisions.map((decision, index) => {
    const response = responses[index];
    if (response?.action === "accept") {
      return {
        approvalId: decision.approvalId,
        outcome: "allow_once" as const,
        ...(response.content ? { elicitation: response.content as JsonObject } : {}),
      };
    }
    return { approvalId: decision.approvalId, outcome: "reject_once" as const };
  });
  return { decisions: mapped };
}

const ACP_OUTCOMES = {
  "allow-once": "allow_once",
  "allow-for-run": "allow_for_run",
  "reject-once": "reject_once",
  "reject-for-run": "reject_for_run",
} as const;

/**
 * Map the ACP permission selection onto the shared decision batch. Cancelled (or any
 * unrecognized selection) stays deny-closed via the legacy terminal deny. Without a
 * pending-decision set (legacy state) only the legacy binary resume is possible.
 */
function decisionFor(
  response: RequestPermissionResponse,
  interruption: Extract<AgentEvent, { readonly type: "agent_suspended" }>["interruption"],
): { readonly decision: "approve" | "deny" } | { readonly decisions: readonly RunDecision[] } {
  if (response.outcome.outcome !== "selected") return { decision: "deny" };
  const outcome = ACP_OUTCOMES[response.outcome.optionId as keyof typeof ACP_OUTCOMES];
  const pending = interruption.pendingDecisions;
  if (!outcome || !pending?.length) {
    return { decision: response.outcome.optionId === "allow-once" ? "approve" : "deny" };
  }
  return { decisions: pending.map((decision) => ({ approvalId: decision.approvalId, outcome })) };
}

function abortOn(source: AbortSignal): AbortController {
  const controller = new AbortController();
  if (source.aborted) controller.abort(source.reason);
  else source.addEventListener("abort", () => controller.abort(source.reason), { once: true });
  return controller;
}

function truncate(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let bytes = 0;
  let out = "";
  for (const char of value) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes - 3) break;
    bytes += size;
    out += char;
  }
  return `${out}…`;
}
