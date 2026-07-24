import type {
  AgentEventRecord,
  OwnershipScope,
  PersistencePage,
  ProductionPersistenceStore,
} from "@arnilo/prism";
import {
  resolvePrismDeploymentLimits,
  type PrismDeploymentLimits,
  type ResolvedPrismDeploymentLimits,
} from "./limits.js";
import { PrismServerError } from "./types.js";

export interface PrismEventReplayRequest {
  readonly ownership: OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface PrismEventReplay {
  page(input: PrismEventReplayRequest): Promise<PersistencePage<AgentEventRecord>>;
}

export interface CreatePrismEventReplayOptions {
  readonly limits?: PrismDeploymentLimits;
}

/** Ownership-scoped, cursor-paginated durable event replay. Does not re-run work. */
export function createPrismEventReplay(
  store: Pick<ProductionPersistenceStore, "queryEvents">,
  options: CreatePrismEventReplayOptions = {},
): PrismEventReplay {
  const limits = resolvePrismDeploymentLimits(options.limits);
  return {
    async page(input) {
      input.signal?.throwIfAborted();
      assertOwnership(input.ownership);
      if (!input.sessionId || !input.runId) {
        throw new PrismServerError("sessionId and runId are required", 400, "ERR_PRISM_SERVER_REPLAY");
      }
      if (input.cursor !== undefined) assertCursor(input.cursor, limits);
      const page = await store.queryEvents({
        sessionId: input.sessionId,
        runId: input.runId,
        cursor: input.cursor,
        limit: limits.maxReplayEvents,
        order: "asc",
        redacted: true,
        ...input.ownership,
      });
      if (page.items.length > limits.maxReplayEvents) {
        throw new PrismServerError("Replay page exceeds limit", 507, "ERR_PRISM_SERVER_REPLAY_LIMIT");
      }
      if (page.items.some((record) => !record.redacted)) {
        throw new PrismServerError("Replay page must be redacted", 500, "ERR_PRISM_SERVER_REPLAY");
      }
      if (page.nextCursor !== undefined) assertCursor(page.nextCursor, limits);
      return page;
    },
  };
}

export interface CreatePrismReplayHandlerOptions {
  readonly replay: PrismEventReplay;
  readonly authorize: (request: Request) => false | OwnershipScope | Promise<false | OwnershipScope>;
  readonly basePath?: string;
  readonly limits?: PrismDeploymentLimits;
}

/** Optional HTTP adapter: POST `{ sessionId, runId, cursor? }` → ownership-scoped page. */
export function createPrismReplayHandler(options: CreatePrismReplayHandlerOptions): import("./types.js").PrismRequestHandler {
  const base = (options.basePath ?? "/prism/replay/events").replace(/\/$/, "");
  const limits = resolvePrismDeploymentLimits(options.limits);
  return async (request) => {
    try {
      if (request.method !== "POST") {
        throw new PrismServerError("Method not allowed", 405, "ERR_PRISM_SERVER_METHOD");
      }
      const path = new URL(request.url).pathname.replace(/\/$/, "");
      if (path !== base) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      const ownership = await options.authorize(request);
      if (!ownership) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      assertOwnership(ownership);
      const body = await readSmallJson(request, limits.maxReplayCursorBytes + 1024);
      const page = await options.replay.page({
        ownership,
        sessionId: readId(body.sessionId, "sessionId"),
        runId: readId(body.runId, "runId"),
        cursor: body.cursor === undefined ? undefined : readCursor(body.cursor, limits),
        signal: request.signal,
      });
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch (error) {
      if (error instanceof PrismServerError) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
          status: error.status,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "ERR_PRISM_SERVER", message: "Replay failed" } }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
  };
}

function assertOwnership(ownership: OwnershipScope): void {
  if (![ownership.tenantId, ownership.accountId, ownership.userId].some((v) => typeof v === "string" && v.length > 0)) {
    throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
  }
}

function assertCursor(cursor: string, limits: ResolvedPrismDeploymentLimits): void {
  if (typeof cursor !== "string" || Buffer.byteLength(cursor, "utf8") > limits.maxReplayCursorBytes) {
    throw new PrismServerError("Replay cursor exceeds limit", 400, "ERR_PRISM_SERVER_REPLAY_CURSOR");
  }
}

function readCursor(value: unknown, limits: ResolvedPrismDeploymentLimits): string {
  if (typeof value !== "string") throw new PrismServerError("cursor must be a string", 400, "ERR_PRISM_SERVER_BODY");
  assertCursor(value, limits);
  return value;
}

function readId(value: unknown, name: string): string {
  if (typeof value !== "string" || !value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new PrismServerError(`Invalid ${name}`, 400, "ERR_PRISM_SERVER_BODY");
  }
  return value;
}

async function readSmallJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new PrismServerError("Invalid JSON object body", 400, "ERR_PRISM_SERVER_BODY");
  }
}
