/**
 * The session tiers' setup (`stm`, with `wm` and `rehearsal` as passes of its background flush): the per-session
 * toggle, the background pass, the ledger, the `recall` tool, the context block, the compaction slot and the
 * `memory:session*` commands. The package root imports this module only when `stm` is on, so a host without the session
 * tiers loads none of it (plan 216 Task 6).
 */
import {
  type JsonObject,
  type JsonValue,
  type ModelClient,
  type ModelRef,
  type PackageAPI,
  resolveInputCap,
  resolveShouldCompact,
  type SessionContext,
} from "@arnilo/prism";

import { type ChunkOp, type ChunkStore, createChunkStoreHandle, MEMORY_CHUNK_STORE_SERVICE } from "../chunks.js";
import type { MemorySystemComponents } from "../components.js";
import type { MemorySystemConfig } from "../config.js";
import { createObservationalMemoryCommands } from "./commands.js";
import { createObservationalCompactor } from "./compactor.js";
import { resolveCompactAtThreshold, resolveMemorySystemConfig } from "./config.js";
import { createCompactionContextCache } from "./context-cache.js";
import { createObservationalFlush, type ObservationalWorkerKind } from "./flush.js";
import { activeObservations } from "./ledger.js";
import { createObservationalRecallTool } from "./recall-tool.js";
import {
  initialObservationalMemoryState,
  ledgerOf,
  readObservationalMemoryState,
  SESSION_LEDGER_KEY,
  SESSION_STATE_KEY,
  storedModelRef,
} from "./state.js";
import { SESSION_COMPACTED } from "./types.js";

export function setupSessionTiers(prism: PackageAPI<MemorySystemConfig>, components: MemorySystemComponents): void {
  const config = resolveMemorySystemConfig(prism.config ?? {}, components);
  const state = prism.state.session<JsonObject>(SESSION_STATE_KEY, initialObservationalMemoryState(config.enabled));
  const log = prism.state.log<JsonValue>(SESSION_LEDGER_KEY);
  const contextCache = createCompactionContextCache(log, config);
  const read = (session: SessionContext) => readObservationalMemoryState(state.get(session));

  const status = (session: SessionContext, extra: { inFlight: boolean; lastError?: string }) => {
    const ledger = ledgerOf(log.entries(session));
    prism.events.emit("memory.session.status", {
      enabled: read(session).enabled,
      contextMode: contextCache.mode(session),
      observations: ledger.observations.length,
      reflections: ledger.reflections.length,
      inFlight: extra.inFlight,
      ...(extra.lastError === undefined ? {} : { lastError: extra.lastError }),
    });
  };

  // The secret set the kernel hands the compaction slot, kept per session (bounded) so every worker
  // call of a later background pass carries it too. Branch entries are already redacted at append.
  const secrets = createSessionSecrets();
  // The chunk store opens at first use: nothing is opened until a pass stores a chunk or a fork carries refs.
  const chunks = createChunkStoreHandle(config.stm.chunkStore, () => prism.services.consume<ChunkStore>(MEMORY_CHUNK_STORE_SERVICE));
  prism.onDispose(() => chunks.close());
  const flush = createObservationalFlush({
    log,
    config,
    chunks,
    readState: read,
    secretsFor: (session) => secrets.get(session.id),
    clientFor: (session, kind) => clientFor(prism, config, read(session), session, kind),
    onStatus: status,
  });

  // --- tools: recall is visible and callable only while the session's toggle is on.
  if (config.recall) {
    prism.tools.register(createObservationalRecallTool({ chunks }), { when: (session) => read(session).enabled });
  }

  // --- fork referrers (I3): a fork or resumed session adds its own referrer for every chunk its active records cite,
  // so a drop in the parent cannot delete a chunk the child still holds. Queued now, so it precedes any later drop.
  prism.hooks.on("session.opened", (event, context) => {
    const session = context.session;
    if (!session || event.restored !== true) return;
    const ops: ChunkOp[] = activeObservations(ledgerOf(log.entries(session))).flatMap((record) =>
      (record.chunkRefs ?? []).map((ref) => ({
        op: "ref" as const,
        id: ref.id,
        by: { kind: "stm" as const, id: record.id, sessionId: session.id },
      })),
    );
    if (ops.length)
      void chunks
        .run((store) => store.apply(ops))
        .catch(() => prism.status.note("warn", "memory-system: could not add a restored session's chunk referrers"));
  });

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
    session.background("memory.session.observe", (signal) => flush.flush(session, { signal }));
  });

  // --- compaction: request it past the configured gate, and compact from the ledger. While on,
  // The package answers the vote (`false` below its gate) so the host's fallback does not override it.
  prism.hooks.on("compaction.when", async (payload, context) => {
    const session = context.session;
    if (!session || !read(session).enabled) return undefined;
    await contextCache.blocks(session);
    if (contextCache.mode(session) === "own-compaction") {
      const records = log.entries(session);
      const compacted = [...records]
        .reverse()
        .find((value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.type === SESSION_COMPACTED);
      const coverage = ledgerOf(records).latestObservationCoverageId;
      if (compacted && typeof compacted === "object" && !Array.isArray(compacted) && coverage && coverage !== compacted.coversUpToId)
        return { compact: true };
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
      onSecrets: (session, values) => secrets.add(session.id, values),
    }),
  );

  // --- commands.
  for (const command of createObservationalMemoryCommands({
    log,
    state,
    config,
    flush,
    contextMode: async (session) => {
      await contextCache.blocks(session);
      return contextCache.mode(session);
    },
    onStatus: (session) => status(session, { inFlight: flush.status(session.id).inFlight }),
  })) {
    prism.commands.register(command);
  }
}

/** Sessions whose secret set is kept; the oldest is forgotten past this many. */
const MAX_SECRET_SESSIONS = 256;

function createSessionSecrets() {
  const sets = new Map<string, Set<string>>();
  return {
    get: (sessionId: string): readonly string[] => [...(sets.get(sessionId) ?? [])],
    add(sessionId: string, values: readonly (string | undefined)[]): void {
      const set = sets.get(sessionId) ?? new Set<string>();
      for (const value of values) if (value) set.add(value);
      sets.delete(sessionId);
      sets.set(sessionId, set);
      const oldest = sets.keys().next();
      if (sets.size > MAX_SECRET_SESSIONS && !oldest.done) sets.delete(oldest.value);
    },
  };
}

/**
 * The worker model call: the per-session `memory:session:model` ref, else the config's, else the session model.
 * The provider and its key come from the kernel, so the package holds no credential.
 */
function clientFor(
  prism: PackageAPI<MemorySystemConfig>,
  config: ReturnType<typeof resolveMemorySystemConfig>,
  sessionState: { readonly stmModel?: JsonValue; readonly wmModel?: JsonValue },
  session: SessionContext,
  kind: ObservationalWorkerKind,
): ModelClient {
  const ref: ModelRef | undefined =
    kind === "observer"
      ? (storedModelRef(sessionState.stmModel) ?? config.stm.model)
      : kind === "reflector"
        ? (storedModelRef(sessionState.wmModel) ?? config.wm.model)
        : config.rehearsal.model;
  return prism.models.client(ref ?? session.model);
}
