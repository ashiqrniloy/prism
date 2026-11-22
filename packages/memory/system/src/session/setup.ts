/**
 * The session tiers' setup (`stm`, with `wm` and `rehearsal` as passes of its background flush): the per-session
 * toggle, the background pass, the ledger, the `recall` tool, the context block, the compaction slot and the
 * `memory:session*` commands. The package root imports this module only when `stm` is on, so a host without the session
 * tiers loads none of it (plan 216 Task 6).
 */
import { type JsonObject, type JsonValue, type ModelClient, type ModelRef, type PackageAPI, type SessionContext } from "@arnilo/prism";

import { type MemorySystemComponents, MemorySystemError } from "../components.js";
import type { MemorySystemConfig } from "../config.js";
import { createObservationalMemoryCommands } from "./commands.js";
import { createObservationalCompactor } from "./compactor.js";
import {
  type CompactionTriggerPoint,
  resolveCompactionThreshold,
  resolveKeepRecentTokens,
  resolveMemorySystemConfig,
  resolveModelInputCap,
} from "./config.js";
import { createCompactionContextCache } from "./context-cache.js";
import { keptTailStartMessages } from "./cut.js";
import { createObservationalFlush, type ObservationalFlushResult, type ObservationalWorkerKind } from "./flush.js";
import { createObservationalRecallTool } from "./recall-tool.js";
import { createScopeStore, type PreparedScope } from "./scope.js";
import {
  initialObservationalMemoryState,
  ledgerOf,
  readObservationalMemoryState,
  SESSION_LEDGER_KEY,
  SESSION_STATE_KEY,
  storedModelRef,
} from "./state.js";
import { estimateMessageTokens } from "./tokens.js";

/** What the session tiers hand the `memory.system` service. */
export interface SessionTiers {
  setScope(session: SessionContext, text: string): Promise<PreparedScope>;
  /** Runs one WM pass now, below the trigger (`rehearse({ only: "wm" })`). `skipped` when a pass is in flight. */
  runWm(session: SessionContext, signal?: AbortSignal): Promise<ObservationalFlushResult>;
}

export function setupSessionTiers(prism: PackageAPI<MemorySystemConfig>, components: MemorySystemComponents): SessionTiers {
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
      wmItems: ledger.wmItems.length,
      inFlight: extra.inFlight,
      ...(extra.lastError === undefined ? {} : { lastError: extra.lastError }),
    });
  };

  // The secret set the kernel hands the compaction slot, kept per session (bounded) so every worker
  // call of a later background pass carries it too. Branch entries are already redacted at append.
  const secrets = createSessionSecrets();
  // The episode scope (plan 218 Task 1): set by `memory:scope`, `scope.text` or `memory.system.setScope()`; read by the
  // WM and Rehearsal requests only.
  const scope = createScopeStore({
    state,
    log,
    maxBytes: config.scope.maxBytes,
    ...(config.scope.text ? { fallback: config.scope.text } : {}),
    secretsFor: (session) => secrets.get(session.id),
  });
  const flush = createObservationalFlush({
    log,
    config,
    readState: read,
    scopeFor: (session) => scope.get(session),
    secretsFor: (session) => secrets.get(session.id),
    clientFor: (session, kind) => clientFor(prism, config, read(session), session, kind),
    onStatus: status,
  });

  // --- tools: recall is visible and callable only while the session's toggle is on.
  if (config.recall) {
    prism.tools.register(createObservationalRecallTool({ ...config.recallLimits, secretsFor: (sessionId) => secrets.get(sessionId) }), {
      when: (session) => read(session).enabled,
    });
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
    session.background("memory.session.observe", (signal) => flush.flush(session, { signal }));
  });

  // --- compaction (plan 218.3 Task 2): session memory is the agent's compaction system unless the host turns it off.
  if (config.context.compaction) setupSessionCompaction(prism, config, { log, read, secrets, flush });

  // --- commands.
  for (const command of createObservationalMemoryCommands({
    log,
    state,
    config,
    flush,
    scope,
    contextMode: async (session) => {
      await contextCache.blocks(session);
      return contextCache.mode(session);
    },
    onStatus: (session) => status(session, { inFlight: flush.status(session.id).inFlight }),
  })) {
    prism.commands.register(command);
  }
  return {
    setScope: (session, text) => scope.set(session, text),
    runWm: (session, signal) => flush.flush(session, { forceWm: true, ...(signal ? { signal } : {}) }),
  };
}

/**
 * The service every compaction system provides (`{ name }`), so two never run in one agent: the second fails at agent
 * creation, whichever loads first. `@arnilo/prism-extensions/compaction` provides it as `llm-compaction`.
 */
export const COMPACTION_SYSTEM_SERVICE = "compaction.system";
/** The service `@arnilo/prism-extensions/context-engineering` provides while `fold` or `attention` is on. */
export const CONTEXT_FOLD_SERVICE = "context.fold";

/** Sessions whose loop state is kept; the oldest is forgotten past this many. */
const MAX_LOOP_SESSIONS = 1_024;

/**
 * Session memory as the compaction system: the `compaction` slot, and a vote that answers every check of a session with
 * memory on, on two triggers. A check with a turn is mid-loop; a run-start check (no turn) is between loops, unless the
 * run resumes a suspended loop or continues an unfinished one (`run.started` carries `resumed` / `continued`), which is
 * still the same loop. The vote reads one per-session flag and compares the kernel's estimate (history plus summaries:
 * no system prompt, tools or context blocks) with a threshold from the model's declared window: no model call, no store
 * read. A session with memory off is compacted by the kernel default at the kernel's trigger.
 */
function setupSessionCompaction(
  prism: PackageAPI<MemorySystemConfig>,
  config: ReturnType<typeof resolveMemorySystemConfig>,
  deps: {
    log: Parameters<typeof createObservationalCompactor>[0]["log"];
    read: (session: SessionContext) => { readonly enabled: boolean };
    secrets: ReturnType<typeof createSessionSecrets>;
    flush: ReturnType<typeof createObservationalFlush>;
  },
): void {
  const other = prism.services.consume<{ readonly name?: string }>(COMPACTION_SYSTEM_SERVICE);
  if (other !== undefined)
    throw new MemorySystemError(
      "memory_system_compaction_conflict",
      `session memory is the compaction system (context.compaction), but "${other.name ?? "another package"}" is one too; ` +
        "list only one, or set context.compaction: false",
    );
  if (prism.services.consume(CONTEXT_FOLD_SERVICE) !== undefined)
    throw new MemorySystemError(
      "memory_system_compaction_conflict",
      "session memory is the compaction system (context.compaction), so context-engineering fold and attention must be off; " +
        "turn them off, or set context.compaction: false",
    );
  prism.services.provide(COMPACTION_SYSTEM_SERVICE, Object.freeze({ name: "session-memory" }));

  const inLoop = new Map<string, boolean>();
  // The point of each session's last vote, so the compaction it asks for cuts by that point's rule (Task 3).
  const votedAt = new Map<string, CompactionTriggerPoint>();
  const remember = <T>(map: Map<string, T>, id: string, value: T) => {
    map.delete(id);
    map.set(id, value);
    const oldest = map.keys().next();
    if (map.size > MAX_LOOP_SESSIONS && !oldest.done) map.delete(oldest.value);
  };
  // Sessions with a run in flight: a manual compaction there is mid-loop, between runs it is between loops.
  const active = new Map<string, true>();
  prism.hooks.on("run.started", (event, context) => {
    const id = context.session?.id ?? event.sessionId;
    remember(inLoop, id, event.resumed === true || event.continued === true);
    remember(active, id, true);
  });
  const settled = (event: { readonly sessionId?: string }, context: { readonly session?: SessionContext }) => {
    const id = context.session?.id ?? event.sessionId;
    if (id !== undefined) active.delete(id);
  };
  prism.hooks.on("run.completed", settled);
  prism.hooks.on("run.failed", settled);
  prism.hooks.on("run.suspended", settled);
  prism.hooks.on("compaction.when", (payload, context) => {
    const session = context.session;
    if (!session || !deps.read(session).enabled) return undefined;
    const point = payload.turn !== undefined || inLoop.get(session.id) === true ? "mid-loop" : "between-loops";
    remember(votedAt, session.id, point);
    const threshold = resolveCompactionThreshold(config.context, session.model, point);
    if ((payload.estimatedTokens ?? 0) < threshold) return { compact: false };
    // Avoid `nothing_to_compact` event noise when every active message belongs to the kept tail, while still letting
    // Task 5's mid-loop oversized-entry decline report `oversized_entry` once before the provider rejects.
    const cap = resolveModelInputCap(session.model);
    const messages = payload.messages ?? [];
    const cut = keptTailStartMessages(messages, { point, keepRecentTokens: resolveKeepRecentTokens(config.context, cap) });
    if (cut > 0) return { compact: true };
    if (point === "mid-loop" && cap !== undefined) {
      const roundStart = keptTailStartMessages(messages, { point: "mid-loop", keepRecentTokens: 0 });
      if (messages.slice(roundStart).some((message) => estimateMessageTokens(message) > cap)) return { compact: true };
    }
    return { compact: false };
  });
  prism.slots.compaction.provide(
    createObservationalCompactor({
      log: deps.log,
      config,
      fallback: prism.slots.compaction.default,
      isEnabled: (session) => deps.read(session).enabled,
      cover: (session, entryId, signal) => deps.flush.flush(session, { coverThrough: entryId, ...(signal ? { signal } : {}) }),
      // An automatic compaction follows a vote and cuts by its point; an overflow is mid-loop; a manual one is mid-loop
      // while a run is in flight and between loops otherwise.
      pointFor: (session, trigger) =>
        trigger === "auto"
          ? (votedAt.get(session.id) ?? "mid-loop")
          : trigger === "overflow" || active.has(session.id)
            ? "mid-loop"
            : "between-loops",
      onSecrets: (session, values) => deps.secrets.add(session.id, values),
    }),
  );
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
      : kind === "wm"
        ? (storedModelRef(sessionState.wmModel) ?? config.wm.model)
        : config.rehearsal.model;
  return prism.models.client(ref ?? session.model);
}
