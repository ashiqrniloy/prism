/**
 * `@arnilo/prism-memory-observational` — observational memory as a package (roadmap §2.11).
 *
 * The package owns everything the 0.12 lab coordinator did: the per-session toggle, the background
 * observation pass, the ledger, the `recall` tool, the context block, and the compaction slot. The
 * host imports nothing and wires nothing: installing the package is the opt-in, and `om` turns it on
 * per session.
 *
 * Cost: off by default. With the toggle off, `context.build`, `turn.completed`, and `compaction.when`
 * each return after one synchronous state read — no model call, no store write, no branch read. With
 * it on, one pass per threshold reads the branch once and appends one ledger record per recorded
 * batch; the observer, reflector, and dropper each make their own model call.
 *
 * ```ts
 * import memoryObservational from "@arnilo/prism-memory-observational";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "anthropic/claude-sonnet-4-5",
 *   packages: [memoryObservational({ observer: { messageTokens: 4_000 } })],
 * });
 * const session = await agent.session();
 * await agent.commands.run("om", {}, { session });
 * ```
 */
import manifest from "../package.json" with { type: "json" };
import {
  type JsonObject,
  type JsonValue,
  type ModelClient,
  type ModelRef,
  type PackageAPI,
  definePackage,
  resolveInputCap,
  resolveShouldCompact,
  type SessionContext,
} from "@arnilo/prism";

import { createObservationalCompactor } from "./compactor.js";
import { createObservationalMemoryCommands } from "./commands.js";
import {
  type MemoryObservationalConfig,
  memoryObservationalConfigSchema,
  resolveCompactAtThreshold,
  resolveMemoryObservationalConfig,
} from "./config.js";
import { createCompactionContextCache } from "./context-cache.js";
import { createObservationalFlush, type ObservationalWorkerKind } from "./flush.js";
import { createObservationalRecallTool } from "./recall-tool.js";
import {
  initialObservationalMemoryState,
  ledgerOf,
  OM_LEDGER_KEY,
  OM_STATE_KEY,
  readObservationalMemoryState,
  storedModelRef,
} from "./state.js";

// The moved library surface (ledger, workers, render, limits, settings, config, flush, commands).
export * from "./exports.js";

const definition = definePackage<MemoryObservationalConfig>({
  name: "@arnilo/prism-memory-observational",
  version: manifest.version,
  description: "Observational memory: a background observer, a source-backed ledger, recall, and ledger-driven compaction.",
  requires: { api: 1 },
  capabilities: ["models", "session-state", "background", "slot:compaction"],
  config: memoryObservationalConfigSchema,
  setup(prism) {
    const config = resolveMemoryObservationalConfig(prism.config ?? {});
    const state = prism.state.session<JsonObject>(OM_STATE_KEY, initialObservationalMemoryState(config.enabled));
    const log = prism.state.log<JsonValue>(OM_LEDGER_KEY);
    const contextCache = createCompactionContextCache(log, config);
    const read = (session: SessionContext) => readObservationalMemoryState(state.get(session));

    const status = (session: SessionContext, extra: { inFlight: boolean; lastError?: string }) => {
      const ledger = ledgerOf(log.entries(session));
      prism.events.emit("om.status", {
        enabled: read(session).enabled,
        contextMode: contextCache.mode(session),
        observations: ledger.observations.length,
        reflections: ledger.reflections.length,
        inFlight: extra.inFlight,
        ...(extra.lastError === undefined ? {} : { lastError: extra.lastError }),
      });
    };

    const flush = createObservationalFlush({
      log,
      config,
      readState: read,
      clientFor: (session, kind) => clientFor(prism, config, read(session), session, kind),
      onStatus: status,
    });

    // --- tools: recall is visible and callable only while the session's toggle is on.
    if (config.recall) {
      prism.tools.register(createObservationalRecallTool(), { when: (session) => read(session).enabled });
    }

    prism.hooks.on("compaction.completed", (event, context) => {
      if (event.error || !context.session) return;
      if (read(context.session).enabled) contextCache.completed(context.session);
      else contextCache.forget(context.session);
    });
    prism.hooks.on("context.build", async (draft, context) => {
      const session = context.session;
      if (!session || !read(session).enabled) return undefined;
      const blocks = await contextCache.blocks(session);
      if (!blocks.length) return undefined;
      return { ...draft, context: [...(draft.context ?? []), ...blocks] };
    });

    // --- observation: a tracked background pass after each turn. The pass itself decides whether a
    // threshold is crossed, so the handler pays one synchronous state read and nothing else.
    prism.hooks.on("turn.completed", (_event, context) => {
      const session = context.session;
      if (!session || !read(session).enabled) return;
      session.background("om.observe", (signal) => flush.flush(session, { signal }));
    });

    // --- compaction: request it past the configured gate, and compact from the ledger. While on,
    // OM answers the vote (`false` below its gate) so the host's fallback does not override it.
    prism.hooks.on("compaction.when", async (payload, context) => {
      const session = context.session;
      if (!session || !read(session).enabled) return undefined;
      await contextCache.blocks(session);
      if (contextCache.mode(session) === "own-compaction") {
        const records = log.entries(session);
        const compacted = [...records].reverse().find((value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.type === "om.compacted");
        const coverage = ledgerOf(records).latestObservationCoverageId;
        if (compacted && typeof compacted === "object" && !Array.isArray(compacted) && coverage && coverage !== compacted.coversUpToId) return { compact: true };
      }
      if (!config.context.trigger) {
        const threshold = resolveCompactAtThreshold(config.context.compactAt, session.model);
        return (payload.estimatedTokens ?? 0) >= threshold ? { compact: true } : { compact: false };
      }
      const compact = await resolveShouldCompact(
        { trigger: config.context.trigger },
        {
          sessionId: payload.sessionId,
          entryCount: payload.entryCount,
          ...(payload.turn === undefined ? {} : { turn: payload.turn }),
          estimateInputTokens: () => payload.estimatedTokens ?? 0,
          resolveInputCapTokens: () => resolveInputCap(undefined, session.model),
          signal: context.signal,
        },
      );
      return compact ? { compact: true } : { compact: false };
    });
    prism.slots.compaction.provide(
      createObservationalCompactor({
        log,
        config,
        fallback: prism.slots.compaction.default,
        isEnabled: (session) => read(session).enabled,
      }),
    );

    // --- commands.
    for (const command of createObservationalMemoryCommands({
      log,
      state,
      config,
      flush,
      contextMode: async (session) => { await contextCache.blocks(session); return contextCache.mode(session); },
      onStatus: (session) => status(session, { inFlight: flush.status(session.id).inFlight }),
    })) {
      prism.commands.register(command);
    }
  },
});

export default definition;

/**
 * The worker model call: the per-session `om:model` ref, else the config's, else the session model.
 * The provider and its key come from the kernel, so the package holds no credential.
 */
function clientFor(
  prism: PackageAPI<MemoryObservationalConfig>,
  config: ReturnType<typeof resolveMemoryObservationalConfig>,
  sessionState: { readonly observerModel?: JsonValue; readonly reflectorModel?: JsonValue },
  session: SessionContext,
  kind: ObservationalWorkerKind,
): ModelClient {
  const ref: ModelRef | undefined =
    kind === "observer"
      ? (storedModelRef(sessionState.observerModel) ?? config.observer.model)
      : kind === "reflector"
        ? (storedModelRef(sessionState.reflectorModel) ?? config.reflector.model)
        : config.dropper.model;
  return prism.models.client(ref ?? session.model);
}
