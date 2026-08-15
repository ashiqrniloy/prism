/** core (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type { AcpCapabilitiesSource, ResolvedAcpClientCapabilities } from "../capabilities.js";
import { resolveAcpAgentCapabilities, resolveAcpClientCapabilities } from "../capabilities.js";
import { AcpError } from "../errors.js";
import type { AgentApp, SessionUpdate } from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION, agent, methods } from "@agentclientprotocol/sdk";
import type { PersistedAcpSession } from "../session-store.js";
import { ownershipKey, validatePersistedSession } from "../session-store.js";
import { createAcpLifecycleMapper } from "../mapper.js";
import {
  initialConfigValues,
  initialModeId,
  toSessionConfigOptions,
  validateConfigOptionValue,
  validateConfigOptionsSeam,
  validateModeSeam,
} from "../modes.js";
import packageJson from "../../../package.json" with { type: "json" };
import { projectAcpPrompt } from "../prompt.js";
import { randomUUID } from "node:crypto";
import { resolveAgUiLimits } from "../../limits.js";
import type { AcpAuthorization, ActiveSession, CreatePrismAcpAgentOptions } from "./types.js";
import { abortOn } from "./abort-truncate.js";
import { buildAcpCoding } from "./coding.js";
import { forward, notify, toPrismPrompt } from "./forward-notify.js";
import { parseCursor, registerSession, resolveSessionInputs, session, sessionState, toSessionInfo } from "./registry.js";

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
    registerSession(sessions, limits, active); // T5: registry cap enforced on restore too
    restoredIds.add(entry.sessionId);
  }
  async function save(entry: PersistedAcpSession, _signal: AbortSignal): Promise<void> {
    const safe = options.redactor?.redact(entry) ?? entry; // T2: redaction at the store boundary
    validatePersistedSession(safe);
    await options.sessionStore!.save(safe); // store failure fails the request (host sees it)
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
        updatedAt: new Date().toISOString(),
      },
      signal,
    );
  };

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
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
      registerSession(sessions, limits, active);
      if (options.sessionStore && binding.session.id) await persist(binding.session.id, active, context.signal); // store failure fails the request; the live session survives in memory
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
      if (authorization) {
        await restore(authorization, context.signal);
        sessions.get(context.params.sessionId)?.controller?.abort(new Error("ACP session cancelled"));
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
      if (existing && restoredIds.has(context.params.sessionId)) return sessionState(existing, options, clientCapabilities); // already restored by the durability seam (plan 018 Task 2)
      const binding = await options.sessions!.load!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
      registerSession(sessions, limits, active);
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
      if (existing && restoredIds.has(context.params.sessionId)) return sessionState(existing, options, clientCapabilities); // already restored by the durability seam (plan 018 Task 2)
      const binding = await options.sessions!.resume!({
        sessionId: context.params.sessionId,
        cwd: context.params.cwd,
        signal: context.signal,
      });
      const active: ActiveSession = { ...binding, configValues: initialConfigValues(options.configOptions) };
      active.modeId = initialModeId(options.modes);
      active.ownership = authorization.ownership;
      active.cwd = context.params.cwd;
      active.additionalDirectories = inputs.additionalDirectories;
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
      if (!clientCapabilities.configOptionBoolean) {
        throw new AcpError("ERR_PRISM_ACP_CAPABILITY", "client did not advertise session.configOptions.boolean");
      }
      const option = options.configOptions!.options.find((candidate) => candidate.id === context.params.configId);
      if (!option) throw new AcpError("ERR_PRISM_ACP_INPUT", `unknown config option '${context.params.configId}'`);
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
