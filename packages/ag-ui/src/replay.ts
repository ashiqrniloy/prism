import type { AgentEventRecord, ProductionPersistenceStore } from "@arnilo/prism";
import { AgUiError } from "./errors.js";
import type { ResolvedAgUiLimits } from "./limits.js";
import type { AgUiRunReference } from "./types.js";

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

export interface AgUiReplay<Authorization> {
  page(input: AgUiReplayRequest<Authorization>): Promise<AgUiReplayPage>;
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
      if (input.cursor && Buffer.byteLength(input.cursor, "utf8") > limits.maxCursorBytes) throw new AgUiError("ERR_PRISM_AG_UI_LIMIT", "Replay cursor exceeds maxCursorBytes");
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
  return record.event.type === "agent_finished" || record.event.type === "agent_denied" || record.event.type === "error";
}
