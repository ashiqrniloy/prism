/** core (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */

import { randomUUID } from "node:crypto";
import type { AgentApp, AgentContext, ContentBlock, SessionUpdate, StopReason } from "@agentclientprotocol/sdk";
import { agent, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentFinishReason } from "@arnilo/prism";
import packageJson from "../../../package.json" with { type: "json" };
import { resolveAgUiLimits } from "../../limits.js";
import type { AcpCapabilitiesSource, ResolvedAcpClientCapabilities } from "../capabilities.js";
import { resolveAcpAgentCapabilities, resolveAcpClientCapabilities } from "../capabilities.js";
import { AcpError } from "../errors.js";
import { createAcpLifecycleMapper } from "../mapper.js";
import {
  initialConfigValues,
  initialModeId,
  toSessionConfigOptions,
  validateConfigOptionsSeam,
  validateConfigOptionValue,
  validateModeSeam,
} from "../modes.js";
import { projectAcpPrompt } from "../prompt.js";
import type { PersistedAcpRunRef, PersistedAcpSession } from "../session-store.js";
import { ownershipKey, validatePersistedSession } from "../session-store.js";
import { abortOn, truncate } from "./abort-truncate.js";
import { buildAcpCoding } from "./coding.js";
import { forward, notify, toPrismPrompt } from "./forward-notify.js";
import { createAcpRunRecovery } from "./recovery.js";
import { parseCursor, registerSession, resolveSessionInputs, session, sessionState, toSessionInfo } from "./registry.js";
import type { AcpAuthorization, ActiveSession, CreatePrismAcpAgentOptions } from "./types.js";

// F4: core finish reasons (generic vocabulary) map onto the SDK StopReason set.
// Cancellation wins over any finish reason; absent reason = natural end.
const STOP_REASON: Readonly<Record<AgentFinishReason, StopReason>> = {
  turn_limit: "max_turn_requests",
  token_limit: "max_tokens",
  refusal: "refusal",
};

function stopReasonFor(finishReason: AgentFinishReason | undefined, aborted: boolean): StopReason {
  if (aborted) return "cancelled";
  return finishReason ? STOP_REASON[finishReason] : "end_turn";
}

export function createPrismAcpAgent<Authorization extends AcpAuthorization = AcpAuthorization>(
  options: CreatePrismAcpAgentOptions<Authorization>,
): AgentApp {
  const limits = resolveAgUiLimits(options.limits);
  validateModeSeam(options.modes, limits);
  validateConfigOptionsSeam(options.configOptions, limits);

  // F2: bounded, redacted transcript replay for session/load and session/resume.
  // Text blocks of message entries with user/assistant roles map to the matching
  // chunk kinds; replay stops at maxReplayEvents chunks and each chunk is
  // truncated at maxTextBytes after the shared redactor. Counts against the
  // stream caps via notify() — an oversized transcript fails the load/resume
  // request closed rather than dumping unbounded history.
  const replayText = (value: string) => truncate(options.redactor?.redact(value) ?? value, limits.maxTextBytes);
  async function replayTranscript(client: AgentContext, sessionId: string, signal: AbortSignal): Promise<void> {
    const seam = options.sessions?.transcript;
    if (!seam) return;
    const entries = await seam({ sessionId, signal });
    const budget = { events: 0, bytes: 0 };
    let emitted = 0;
    for (const entry of entries) {
      if (signal.aborted) return;
      if (emitted >= limits.maxReplayEvents) return;
      const message = entry.kind === "message" ? entry.message : undefined;
      if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
      const messageId = replayText(message.id ?? entry.id);
      for (const block of message.content) {
        if (block.type !== "text" || emitted >= limits.maxReplayEvents) break;
        const update: SessionUpdate = {
          sessionUpdate: message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          messageId,
          content: { type: "text", text: replayText(block.text) },
        };
        await notify(client, sessionId, update, budget, limits);
        emitted += 1;
      }
    }
  }

  // ponytail: bounded in-memory registry (acp.sessions); swap for a host-owned store if replicas share sessions.
  const sessions = new Map<string, ActiveSession>();
  // ponytail: single-connection assumption — initialize may be called once per connection;
  // key by client identity if multi-client hosting ever needs per-connection gating.
  let clientCapabilities: ResolvedAcpClientCapabilities = resolveAcpClientCapabilities(undefined);

  // Phase 18 Task 2: lazy restore of persisted registry entries. loadAll runs at most once;
  // the merge is per-authorization so multi-tenant hosts restore each ownership's entries
  // on that ownership's first touch (cross-tenant entries are never merged).
  let loadPromise: Promise<PersistedAcpSession[]> | undefined;
  // session ids restored by the durability seam (plan 018 Task 2); protocol load/resume of these is idempotent,
  // while a duplicate load of an in-process-registered session keeps its frozen rejection.
  const restoredIds = new Set<string>();
  async function restore(authorization: Authorization, signal: AbortSignal): Promise<void> {
    const store = options.sessionStore;
    if (!store) return;
    try {
      loadPromise ??= store.loadAll(signal).then((entries) => [...entries]);
      const entries = await loadPromise;
      for (const entry of entries) {
        if (sessions.has(entry.sessionId)) continue;
        if (ownershipKey(entry.ownership) !== ownershipKey(authorization.ownership ?? {})) continue; // T1: never merge cross-tenant
        try {
          await restoreEntry(entry, authorization, signal);
        } catch {
          entries.splice(entries.indexOf(entry), 1); // T3/T5: corrupt, oversized, or cap-full entries fail closed (dropped, never merged)
        }
      }
    } catch (error) {
      loadPromise = undefined; // fail the request; a later request retries the store
      throw error;
    }
  }
  async function restoreEntry(entry: PersistedAcpSession, authorization: Authorization, signal: AbortSignal): Promise<void> {
    validatePersistedSession(entry); // T3: shape/byte caps
    if (options.modes && entry.modeId !== undefined && !options.modes.modes.some((m) => m.id === entry.modeId)) {
      throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown mode '${entry.modeId}'`); // T3/T8: unknown mode fails closed
    }
    if (!options.modes && entry.modeId !== undefined) throw new AcpError("ERR_PRISM_ACP_INPUT", "stored mode without modes seam");
    const values = new Map<string, boolean | string>();
    for (const [key, value] of Object.entries(entry.configValues)) {
      const option = options.configOptions?.options.find((candidate) => candidate.id === key);
      if (!option) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown config option '${key}'`); // T3/T8
      values.set(key, validateConfigOptionValue(option, value)); // T3: invalid value fails closed
    }
    if (options.configOptions && values.size !== Object.keys(entry.configValues).length) {
      throw new AcpError("ERR_PRISM_ACP_INPUT", "config values without matching options");
    }
    const binding = await options.sessionFactory({
      authorization,
      signal,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      additionalDirectories: entry.additionalDirectories,
      mcpServers: [], // MCP configs are never persisted; restore requires re-approval (fail closed)
    });
    const active: ActiveSession = { ...binding, configValues: values };
    if (entry.modeId) active.modeId = entry.modeId;
    active.ownership = entry.ownership;
    active.cwd = entry.cwd;
    active.additionalDirectories = entry.additionalDirectories;
    if (entry.activeRun) active.activeRun = entry.activeRun; // plan 026 Task 5: restored run ref
    registerSession(sessions, limits, active); // T5: registry cap enforced on restore too
    restoredIds.add(entry.sessionId);
  }
  async function save(entry: PersistedAcpSession, _signal: AbortSignal): Promise<void> {
    const safe = options.redactor?.redact(entry) ?? entry; // T2: redaction at the store boundary
    validatePersistedSession(safe);
    await options.sessionStore!.save(safe); // store failure fails the request (host sees it)
  }
  // Phase 26 Task 5: durable run recovery. Partial recovery configuration fails
  // closed at construction (no implicit activation, no half-durable state).
  const runRecovery = options.recovery
    ? createAcpRunRecovery({
        lifecycle: options.lifecycle,
        checkpoints: options.recovery.checkpoints,
        leases: options.recovery.leases,
        ownerId: options.recovery.ownerId,
        leaseTtlMs: options.recovery.leaseTtlMs,
      })
    : undefined;
  if (options.recovery && (!options.recovery.checkpoints || !options.recovery.leases || !options.recovery.ownerId)) {
    throw new Error("ACP run recovery requires checkpoints, leases, and ownerId together");
  }

  const persist = (sessionId: string, active: ActiveSession, signal: AbortSignal): Promise<void> => {
    if (!active.cwd) throw new AcpError("ERR_PRISM_ACP_INPUT", "session has no working directory");
    return save(
      {
        sessionId,
        ownership: active.ownership ?? {},
        ...(active.modeId ? { modeId: active.modeId } : {}),
        configValues: Object.fromEntries(active.configValues),
        cwd: active.cwd,
        additionalDirectories: active.additionalDirectories ?? [],
        ...(active.activeRun ? { activeRun: active.activeRun } : {}),
        updatedAt: new Date().toISOString(),
      },
      signal,
    );
  };
  // Bounded active-run reference persistence (plan 026 Task 5): advisory, so
  // store failures never fail the prompt; the ref is re-validated on restore.
  const persistRunRef =
    (active: ActiveSession) =>
    (ref: PersistedAcpRunRef): void => {
      active.activeRun = ref;
      if (options.sessionStore && active.cwd) {
        void persist(active.session.id, active, new AbortController().signal).catch(() => {});
      }
    };

  // F9: host slash commands. Best-effort — a throw or absent seam yields no update;
  // session/new/load/resume never fail on commands. Count-capped + redacted.
  const emitAvailableCommands = async (client: AgentContext, sessionId: string, signal: AbortSignal): Promise<void> => {
    const list = options.commands?.list;
    if (!list) return;
    try {
      const listed = await list({ sessionId, signal });
      if (!Array.isArray(listed)) return;
      const redact = (value: string) =>
        truncate(options.redactor?.redact(value) ?? value, Math.min(limits.maxTextBytes, limits.maxEventBytes));
      const availableCommands = [];
      for (const cmd of listed) {
        if (availableCommands.length >= limits.acpCommandsPerUpdate) break;
        if (!cmd || typeof cmd.name !== "string" || typeof cmd.description !== "string") continue;
        const name = redact(cmd.name);
        if (!name) continue;
        const entry: { name: string; description: string; input?: { hint: string } } = {
          name,
          description: redact(cmd.description),
        };
        if (cmd.input && typeof cmd.input.hint === "string") {
          const hint = redact(cmd.input.hint);
          if (hint) entry.input = { hint };
        }
        availableCommands.push(entry);
      }
      await notify(client, sessionId, { sessionUpdate: "available_commands_update", availableCommands }, { events: 0, bytes: 0 }, limits);
    } catch {
      // best-effort: commands never fail session start.
    }
  };

  // F6: host-owned title seam. Best-effort — a throw or `undefined` yields no
  // title and no update; emission failures never fail the request.
  const titleSeam = options.sessions?.title;
  const resolveSessionTitle = async (
    sessionId: string,
    prompt: readonly ContentBlock[] | undefined,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    if (!titleSeam) return undefined;
    try {
      const title = await titleSeam({ sessionId, prompt, signal });
      return typeof title === "string" && title.length > 0
        ? truncate(options.redactor?.redact(title) ?? title, Math.min(limits.maxTextBytes, limits.maxEventBytes))
        : undefined;
    } catch {
      return undefined;
    }
  };
  const emitSessionTitle = async (
    active: ActiveSession,
    client: AgentContext | undefined,
    prompt: readonly ContentBlock[] | undefined,
    signal: AbortSignal,
  ): Promise<void> => {
    const title = await resolveSessionTitle(active.session.id, prompt, signal);
    if (title === undefined || title === active.title || !client) return;
    active.title = title;
    try {
      // ponytail: session/new emits before any stream exists — the request-context
      // client is the only handle; keep the update advisory (try/catch).
      await notify(
        client,
        active.session.id,
        { sessionUpdate: "session_info_update", title },
        active.budget ?? { events: 0, bytes: 0 },
        limits,
      );
    } catch {
      // best-effort: title updates never fail session/new or session/prompt.
    }
  };

  // Lifecycle -> session/update forwarding (freeze lifecycleEventMapping). Updates are
  // delivered only to sessions with an active prompt stream (no client handle otherwise)
  // and count against that session's shared per-run notification budget.
  const lifecycleMapper = createAcpLifecycleMapper({ redactor: options.redactor, projection: options.projection, limits: options.limits });
  if (options.coding?.lifecycle) {
    options.coding.lifecycle.on((event) => {
      if (event.type === "plan_changed" || event.type === "plan_removed") {
        // F5: UNSTABLE plan surface — only for clients that advertised ClientCapabilities.plan.
        if (!clientCapabilities.plan) return;
      }
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
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
      registerSession(sessions, limits, active);
      if (options.sessionStore && binding.session.id) await persist(binding.session.id, active, context.signal); // store failure fails the request; the live session survives in memory
      await emitAvailableCommands(context.client, binding.session.id, context.signal);
      return {
        sessionId: binding.session.id,
        ...sessionState(active, options, clientCapabilities),
      };
    })
    .onRequest(methods.agent.session.prompt, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await restore(authorization, context.signal);
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
      // F6: title resolution per prompt; emits session_info_update on change.
      // (SDK v1 NewSessionRequest has no prompt field — the seam only fires here.)
      await emitSessionTitle(current, context.client, context.params.prompt, controller.signal);
      try {
        const finishReason = await forward(
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
          persistRunRef(current),
        );
        return { stopReason: stopReasonFor(finishReason, controller.signal.aborted) };
      } finally {
        current.controller = undefined;
        current.client = undefined;
        current.budget = undefined;
      }
    })
    .onNotification(methods.agent.session.cancel, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (authorization) {
        await restore(authorization, context.signal);
        const current = sessions.get(context.params.sessionId);
        // Live abort always (0.2.5 parity).
        current?.controller?.abort(new Error("ACP session cancelled"));
        // Durable cancel (plan 026 Task 5): ownership/version/fence checked,
        // terminal/idempotent; a recovered run that is not live here is still
        // durably cancelled so it can never be resumed or replayed.
        if (runRecovery && current?.activeRun) {
          await runRecovery.cancel(
            { runId: current.activeRun.runId, sessionId: current.activeRun.sessionId },
            {
              ownership: authorization.ownership,
              agentId: current.agentId,
              ...(current.activeRun.version !== undefined ? { expectedVersion: current.activeRun.version } : {}),
              signal: context.signal,
            },
          );
        }
      }
    })
    .onRequest(methods.agent.session.close, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await restore(authorization, context.signal);
      if (options.sessionStore) await options.sessionStore.evict(context.params.sessionId, context.signal); // evict first: a failed store write surfaces before the session is torn down
      const current = sessions.get(context.params.sessionId);
      current?.controller?.abort(new Error("ACP session closed"));
      sessions.delete(context.params.sessionId);
    });

  if (options.sessions?.load) {
    app = app.onRequest(methods.agent.session.load, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await restore(authorization, context.signal);
      const inputs = await resolveSessionInputs(context.params, options, limits, context.signal);
      const existing = sessions.get(context.params.sessionId);
      if (existing && restoredIds.has(context.params.sessionId)) {
        await emitAvailableCommands(context.client, existing.session.id, context.signal);
        return sessionState(existing, options, clientCapabilities); // already restored by the durability seam (plan 018 Task 2)
      }
      const binding = await options.sessions!.load!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      // F2: replay the stored transcript (if the host wired the seam) before the session becomes current.
      await replayTranscript(context.client, context.params.sessionId, context.signal);
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
      registerSession(sessions, limits, active);
      await emitAvailableCommands(context.client, active.session.id, context.signal);
      return sessionState(active, options, clientCapabilities);
    });
  }
  if (options.sessions?.resume) {
    app = app.onRequest(methods.agent.session.resume, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await restore(authorization, context.signal);
      const inputs = await resolveSessionInputs(context.params, options, limits, context.signal);
      const existing = sessions.get(context.params.sessionId);
      if (existing && restoredIds.has(context.params.sessionId)) {
        await emitAvailableCommands(context.client, existing.session.id, context.signal);
        return sessionState(existing, options, clientCapabilities); // already restored by the durability seam (plan 018 Task 2)
      }
      const binding = await options.sessions!.resume!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      // F2: replay the stored transcript (if the host wired the seam) before the run resumes.
      await replayTranscript(context.client, context.params.sessionId, context.signal);
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
      registerSession(sessions, limits, active);
      await emitAvailableCommands(context.client, active.session.id, context.signal);
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
      await restore(authorization, context.signal);
      if (options.sessionStore) await options.sessionStore.evict(context.params.sessionId, context.signal);
      await options.sessions!.delete!({ sessionId: context.params.sessionId, signal: context.signal });
      sessions.delete(context.params.sessionId);
      return {};
    });
  }
  if (options.modes) {
    app = app.onRequest(methods.agent.session.setMode, async (context) => {
      const authorization = await options.authorize({ sessionId: context.params.sessionId, signal: context.signal });
      if (!authorization) throw new Error("Unauthorized ACP session");
      await restore(authorization, context.signal);
      const current = session(sessions, context.params.sessionId);
      const mode = options.modes!.modes.find((candidate) => candidate.id === context.params.modeId);
      if (!mode) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown mode '${context.params.modeId}'`);
      await mode.apply?.({ sessionId: context.params.sessionId, fromModeId: current.modeId, modeId: mode.id, signal: context.signal });
      current.modeId = mode.id;
      if (options.sessionStore) await persist(context.params.sessionId, current, context.signal);
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
      await restore(authorization, context.signal);
      const current = session(sessions, context.params.sessionId);
      const option = options.configOptions!.options.find((candidate) => candidate.id === context.params.configId);
      if (!option) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown config option '${context.params.configId}'`);
      // B3: per-type capability gate — select is never settable until the ACP
      // spec defines a select capability; boolean requires the advertisement.
      if (option.type === "select") {
        throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "select options are not settable until the ACP spec defines a select capability");
      }
      if (!clientCapabilities.configOptionBoolean) {
        throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "client did not advertise session.configOptions.boolean");
      }
      const value = validateConfigOptionValue(option, context.params.value);
      await options.configOptions!.onChange?.({ sessionId: context.params.sessionId, configId: option.id, value, signal: context.signal });
      current.configValues.set(option.id, value);
      if (options.sessionStore) await persist(context.params.sessionId, current, context.signal);
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
