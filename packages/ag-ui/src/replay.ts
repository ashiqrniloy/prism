import type {
  AgentEventRecord,
  AgentEventSource,
  DurableAgentEventRecord,
  OwnershipScope,
  ProductionPersistenceStore,
} from "@arnilo/prism";
import { AgUiError } from "./errors.js";
import type { ResolvedAgUiLimits } from "./limits.js";
import type { AgUiRunReference, CoWorkContext, CoWorkEvent } from "./types.js";

export interface AgUiReplayRequest<Authorization> {
  readonly threadId: string;
  readonly runId: string;
  readonly cursor?: string;
  readonly authorization: Authorization;
  readonly signal?: AbortSignal;
}

export interface AgUiReplayPage {
  readonly records: readonly AgentEventRecord[];
  readonly nextCursor?: string;
  readonly terminal: boolean;
  readonly run: AgUiRunReference;
}

export interface AgUiReplayEvent {
  readonly record: DurableAgentEventRecord;
  readonly cursor: string;
  readonly run: AgUiRunReference;
}

export interface AgUiReplay<Authorization> {
  page(input: AgUiReplayRequest<Authorization>): Promise<AgUiReplayPage>;
  /** Optional durable replay-to-live stream. When present, handler never opens a local session for replay. */
  subscribe?(input: AgUiReplayRequest<Authorization>): AsyncIterable<AgUiReplayEvent>;
}

export interface PersistenceAgUiReplayOptions<Authorization> {
  /** Host authorization binds untrusted AG-UI thread/run selectors to internal IDs. */
  readonly resolveRun: (input: AgUiReplayRequest<Authorization>) => AgUiRunReference | undefined | Promise<AgUiRunReference | undefined>;
  readonly ownership: (authorization: Authorization) => import("@arnilo/prism").OwnershipScope | undefined;
  readonly limits?: Pick<ResolvedAgUiLimits, "maxCursorBytes" | "maxReplayEvents">;
}

/** Adapts one bounded, ownership-scoped durable event page. */
export function createPersistenceAgUiReplay<Authorization>(
  store: Pick<ProductionPersistenceStore, "queryEvents">,
  options: PersistenceAgUiReplayOptions<Authorization>,
): AgUiReplay<Authorization> {
  const limits = options.limits ?? { maxCursorBytes: 4 * 1024, maxReplayEvents: 100 };
  return {
    async page(input) {
      input.signal?.throwIfAborted();
      if (input.cursor && Buffer.byteLength(input.cursor, "utf8") > limits.maxCursorBytes)
        throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Replay cursor exceeds maxCursorBytes");
      const run = await options.resolveRun(input);
      if (!run) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Run is unavailable");
      const page = await store.queryEvents({
        sessionId: run.ref.sessionId,
        runId: run.ref.runId,
        cursor: input.cursor,
        limit: limits.maxReplayEvents,
        order: "asc",
        ...options.ownership(input.authorization),
      });
      if (page.items.length > limits.maxReplayEvents || page.items.some((record) => !record.redacted)) {
        throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay page is unavailable");
      }
      if (page.nextCursor && Buffer.byteLength(page.nextCursor, "utf8") > limits.maxCursorBytes) {
        throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay cursor is invalid");
      }
      return { records: page.items, nextCursor: page.nextCursor, terminal: page.items.some((record) => terminal(record)), run };
    },
  };
}

function terminal(record: AgentEventRecord): boolean {
  return (
    record.event.type === "agent_finished" ||
    record.event.type === "agent_denied" ||
    record.event.type === "run_limit_exceeded" ||
    record.event.type === "error"
  );
}

export interface AgentEventSourceAgUiReplayOptions<Authorization> {
  /** Host authorization binds untrusted AG-UI thread/run selectors to internal IDs. */
  readonly resolveRun: (input: AgUiReplayRequest<Authorization>) => AgUiRunReference | undefined | Promise<AgUiRunReference | undefined>;
  readonly ownership: (authorization: Authorization) => OwnershipScope;
  readonly limits?: Pick<ResolvedAgUiLimits, "maxCursorBytes" | "maxReplayEvents">;
}

/** Adapts one durable source for both pages and gap-free replay-to-live follow. */
export function createAgentEventSourceAgUiReplay<Authorization>(
  source: AgentEventSource,
  options: AgentEventSourceAgUiReplayOptions<Authorization>,
): AgUiReplay<Authorization> {
  const limits = options.limits ?? { maxCursorBytes: 4 * 1024, maxReplayEvents: 100 };
  const resolve = async (input: AgUiReplayRequest<Authorization>) => {
    input.signal?.throwIfAborted();
    if (input.cursor && Buffer.byteLength(input.cursor, "utf8") > limits.maxCursorBytes) {
      throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Replay cursor exceeds maxCursorBytes");
    }
    const run = await options.resolveRun(input);
    if (!run?.ref.sessionId) throw new AgUiError("ERR_PRISM_AG_UI_FORBIDDEN", "Run is unavailable");
    return { run, sessionId: run.ref.sessionId, ownership: options.ownership(input.authorization) };
  };
  return {
    async page(input) {
      const { run, sessionId, ownership } = await resolve(input);
      const page = await source.page({
        ownership,
        sessionId,
        runId: run.ref.runId,
        after: input.cursor,
        limit: limits.maxReplayEvents,
        signal: input.signal,
      });
      return { records: page.items.map((item) => item.record), nextCursor: page.nextCursor, terminal: page.terminal, run };
    },
    subscribe(input) {
      return {
        async *[Symbol.asyncIterator]() {
          const { run, sessionId, ownership } = await resolve(input);
          for await (const item of source.subscribe({
            ownership,
            sessionId,
            runId: run.ref.runId,
            after: input.cursor,
            limit: limits.maxReplayEvents,
            signal: input.signal,
          })) {
            if (!item.record.redacted) throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Replay record is unavailable");
            yield { ...item, run };
          }
        },
      };
    },
  };
}

export interface CoWorkReplayRequest<Authorization> {
  readonly context: CoWorkContext;
  readonly cursor?: string;
  readonly authorization: Authorization;
  readonly signal?: AbortSignal;
}

export interface CoWorkReplayPage {
  readonly events: readonly CoWorkEvent[];
  readonly nextCursor?: string;
}

/** Host-owned, ownership-scoped durable co-work state (artifacts/drafts/snapshots). */
export interface CoWorkSource<Authorization> {
  page(input: CoWorkReplayRequest<Authorization>): Promise<CoWorkReplayPage>;
}

export interface CoWorkReplay<Authorization> {
  page(input: CoWorkReplayRequest<Authorization>): Promise<CoWorkReplayPage>;
}

export interface CoWorkReplayOptions<Authorization> {
  readonly source: CoWorkSource<Authorization>;
  readonly limits?: Pick<ResolvedAgUiLimits, "maxCursorBytes" | "maxReplayEvents">;
}

/**
 * Bounds one durable co-work page behind the frozen cursor/event caps. Pure read + map by
 * the caller's mapper, so disconnect/resume from a cursor replays state without duplicate
 * side effects. Oversized cursors and over-limit pages fail closed.
 */
export function createCoWorkReplay<Authorization>(options: CoWorkReplayOptions<Authorization>): CoWorkReplay<Authorization> {
  const limits = options.limits ?? { maxCursorBytes: 4 * 1024, maxReplayEvents: 100 };
  return {
    async page(input) {
      input.signal?.throwIfAborted();
      if (input.cursor && Buffer.byteLength(input.cursor, "utf8") > limits.maxCursorBytes) {
        throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Co-work replay cursor exceeds maxCursorBytes");
      }
      const page = await options.source.page(input);
      if (page.events.length > limits.maxReplayEvents) {
        throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Co-work replay page is unavailable");
      }
      if (page.nextCursor && Buffer.byteLength(page.nextCursor, "utf8") > limits.maxCursorBytes) {
        throw new AgUiError("ERR_PRISM_AG_UI_REPLAY", "Co-work replay cursor is invalid");
      }
      return page;
    },
  };
}
