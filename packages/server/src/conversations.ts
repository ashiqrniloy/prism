import { randomUUID } from "node:crypto";
import type { PersistenceLifecycleStore, RetentionPolicy } from "@arnilo/prism";
import {
  type AgentEventRecord,
  type AgentIdentity,
  type AgentRunResult,
  type AgentSession,
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  CONVERSATION_METADATA_KEY,
  ConversationError,
  conversationMarkerMetadata,
  conversationThreadFromRecord,
  decodeConversationReplayCursor,
  encodeConversationReplayCursor,
  isSessionMetadataConflict,
  type JsonObject,
  type Message,
  type OwnershipScope,
  type PersistencePage,
  type RunOptions,
  type SecretRedactor,
  type SessionRecord,
} from "@arnilo/prism";
import type { PrismRequestHandler, PrismServerAuthorization } from "./types.js";
import { PrismServerError } from "./types.js";

/** Phase 9 freeze: thread page 50/200; replay page 100/500; cursor 4/16 KiB; title 256 B/2 KiB;
 *  request id 256 B/2 KiB; active branches 16/64; export 8/32 MiB and 100/500 pages; body 64 KiB/1 MiB. */
export const DEFAULT_CONVERSATION_THREAD_PAGE_LIMIT = 50;
export const HARD_CONVERSATION_THREAD_PAGE_LIMIT = 200;
export const DEFAULT_CONVERSATION_REPLAY_PAGE_LIMIT = 100;
export const HARD_CONVERSATION_REPLAY_PAGE_LIMIT = 500;
export const DEFAULT_CONVERSATION_CURSOR_BYTES = 4 * 1024;
export const HARD_CONVERSATION_CURSOR_BYTES = 16 * 1024;
export const DEFAULT_CONVERSATION_TITLE_BYTES = 256;
export const HARD_CONVERSATION_TITLE_BYTES = 2 * 1024;
export const DEFAULT_CONVERSATION_REQUEST_ID_BYTES = 256;
export const HARD_CONVERSATION_REQUEST_ID_BYTES = 2 * 1024;
export const DEFAULT_CONVERSATION_MAX_ACTIVE_BRANCHES = 16;
export const HARD_CONVERSATION_MAX_ACTIVE_BRANCHES = 64;
export const DEFAULT_CONVERSATION_EXPORT_BYTES = 8 * 1024 * 1024;
export const HARD_CONVERSATION_EXPORT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_CONVERSATION_EXPORT_PAGES = 100;
export const HARD_CONVERSATION_EXPORT_PAGES = 500;
export const DEFAULT_CONVERSATION_REQUEST_BYTES = 64 * 1024;
export const HARD_CONVERSATION_REQUEST_BYTES = 1024 * 1024;

export interface ConversationLimits {
  readonly threadPageLimit?: number;
  readonly replayPageLimit?: number;
  readonly cursorBytes?: number;
  readonly titleBytes?: number;
  readonly requestIdBytes?: number;
  readonly maxActiveBranches?: number;
  readonly exportBytes?: number;
  readonly exportPages?: number;
  readonly maxRequestBytes?: number;
}

export interface ResolvedConversationLimits {
  readonly threadPageLimit: number;
  readonly replayPageLimit: number;
  readonly cursorBytes: number;
  readonly titleBytes: number;
  readonly requestIdBytes: number;
  readonly maxActiveBranches: number;
  readonly exportBytes: number;
  readonly exportPages: number;
  readonly maxRequestBytes: number;
}

export function resolveConversationLimits(input: ConversationLimits = {}): ResolvedConversationLimits {
  return {
    threadPageLimit: bounded(
      input.threadPageLimit,
      DEFAULT_CONVERSATION_THREAD_PAGE_LIMIT,
      HARD_CONVERSATION_THREAD_PAGE_LIMIT,
      "threadPageLimit",
    ),
    replayPageLimit: bounded(
      input.replayPageLimit,
      DEFAULT_CONVERSATION_REPLAY_PAGE_LIMIT,
      HARD_CONVERSATION_REPLAY_PAGE_LIMIT,
      "replayPageLimit",
    ),
    cursorBytes: bounded(input.cursorBytes, DEFAULT_CONVERSATION_CURSOR_BYTES, HARD_CONVERSATION_CURSOR_BYTES, "cursorBytes"),
    titleBytes: bounded(input.titleBytes, DEFAULT_CONVERSATION_TITLE_BYTES, HARD_CONVERSATION_TITLE_BYTES, "titleBytes"),
    requestIdBytes: bounded(
      input.requestIdBytes,
      DEFAULT_CONVERSATION_REQUEST_ID_BYTES,
      HARD_CONVERSATION_REQUEST_ID_BYTES,
      "requestIdBytes",
    ),
    maxActiveBranches: bounded(
      input.maxActiveBranches,
      DEFAULT_CONVERSATION_MAX_ACTIVE_BRANCHES,
      HARD_CONVERSATION_MAX_ACTIVE_BRANCHES,
      "maxActiveBranches",
    ),
    exportBytes: bounded(input.exportBytes, DEFAULT_CONVERSATION_EXPORT_BYTES, HARD_CONVERSATION_EXPORT_BYTES, "exportBytes"),
    exportPages: bounded(input.exportPages, DEFAULT_CONVERSATION_EXPORT_PAGES, HARD_CONVERSATION_EXPORT_PAGES, "exportPages"),
    maxRequestBytes: bounded(input.maxRequestBytes, DEFAULT_CONVERSATION_REQUEST_BYTES, HARD_CONVERSATION_REQUEST_BYTES, "maxRequestBytes"),
  };
}

/** Narrow persistence seam. sqlite/postgres adapters implement it; stores without
 *  `appendSession` cannot host conversations (fail-closed at factory time). */
export interface ConversationServiceStore {
  querySessions(query: import("@arnilo/prism").SessionQuery): Promise<PersistencePage<SessionRecord>>;
  queryEvents(query: import("@arnilo/prism").AgentEventQuery): Promise<PersistencePage<AgentEventRecord>>;
  /** Required at factory time; optional in the type so persistence unions stay assignable.
   *  Additive CAS: `expectedVersion` requires the stored version to match (0 = create-only);
   *  the returned `version` is the new write version. Throws `SessionMetadataConflictError`. */
  appendSession?(record: SessionRecord & { readonly expectedVersion?: number }): Promise<{ readonly version: number } | void>;
  readonly lifecycle?: Pick<PersistenceLifecycleStore, "applyRetention">;
}

export interface ConversationSessionFactoryInput {
  readonly thread: import("@arnilo/prism").ConversationThread;
  readonly ownership: OwnershipScope;
  /** Recorded branch leaf to continue from; undefined continues the session's current tip. */
  readonly leafId?: string;
  readonly signal?: AbortSignal;
}

export interface CreateConversationServiceOptions {
  /** Binds an agent session to the thread (host owns agent, store, and leaf checkout). */
  readonly sessionFactory: (input: ConversationSessionFactoryInput) => AgentSession | Promise<AgentSession>;
  /** Required: replay/export only serve redacted ledger rows, and `continue` runs with this redactor. */
  readonly redactor: SecretRedactor;
  readonly runOptions?: Omit<RunOptions, "ownership" | "identity" | "signal" | "redactor" | "idempotencyKey">;
  readonly limits?: ConversationLimits;
}

export interface ConversationServiceInput {
  readonly ownership: OwnershipScope;
  readonly identity?: AgentIdentity;
  readonly signal?: AbortSignal;
}

export interface ConversationCreateInput extends ConversationServiceInput {
  /** Explicit thread id makes create idempotent (get-or-create). Generated when omitted. */
  readonly id?: string;
  readonly title?: string;
  readonly requestId?: string;
  readonly metadata?: JsonObject;
}

export interface ConversationListInput extends ConversationServiceInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ConversationRefInput extends ConversationServiceInput {
  readonly threadId: string;
}

export interface ConversationContinueInput extends ConversationRefInput {
  readonly message: string | Message | readonly Message[];
  /** Client request id; flows into session append idempotency so duplicate continues deduplicate. */
  readonly requestId?: string;
  /** Must be a branch ref recorded by `branch()`; undefined continues the current tip. */
  readonly leafId?: string;
}

export interface ConversationBranchInput extends ConversationRefInput {
  readonly leafId: string;
}

export interface ConversationExportInput extends ConversationRefInput {
  readonly cursor?: string;
}

export interface ConversationReplayInput extends ConversationRefInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ConversationReplayPage {
  readonly records: readonly AgentEventRecord[];
  readonly nextCursor?: string;
  readonly terminal: boolean;
}

export interface ConversationExportPage {
  readonly thread: import("@arnilo/prism").ConversationThread;
  readonly events: readonly AgentEventRecord[];
  readonly nextCursor?: string;
  readonly truncated: boolean;
}

export interface ConversationService {
  create(input: ConversationCreateInput): Promise<import("@arnilo/prism").ConversationThread>;
  list(input: ConversationListInput): Promise<PersistencePage<import("@arnilo/prism").ConversationThread>>;
  get(input: ConversationRefInput): Promise<import("@arnilo/prism").ConversationThread>;
  continue(input: ConversationContinueInput): Promise<AgentRunResult>;
  branch(input: ConversationBranchInput): Promise<import("@arnilo/prism").ConversationThread>;
  archive(input: ConversationRefInput): Promise<import("@arnilo/prism").ConversationThread>;
  export(input: ConversationExportInput): Promise<ConversationExportPage>;
  delete(input: ConversationRefInput): Promise<{ readonly deleted: boolean; readonly held: boolean }>;
  replay(input: ConversationReplayInput): Promise<ConversationReplayPage>;
}

// Explicit-candidate retention policy; candidates bypass policy discovery, holds still win.
const CONVERSATION_DELETE_POLICY: RetentionPolicy = {
  id: "prism-conversation-delete",
  name: "prism-conversation-delete",
  createdAt: "1970-01-01T00:00:00.000Z",
};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function createConversationService(store: ConversationServiceStore, options: CreateConversationServiceOptions): ConversationService {
  if (typeof store.appendSession !== "function") {
    throw new RangeError("ConversationServiceStore requires appendSession (sqlite/postgres persistence)");
  }
  const appendSession = store.appendSession;
  const limits = resolveConversationLimits(options.limits);

  async function loadThread(input: ConversationServiceInput, threadId: string) {
    assertOwnership(input.ownership);
    input.signal?.throwIfAborted();
    const page = await store.querySessions({ id: assertId(threadId, "threadId"), ...input.ownership, limit: 1 });
    const thread = page.items[0] === undefined ? undefined : conversationThreadFromRecord(page.items[0]);
    if (!thread) throw new ConversationError("Conversation thread not found", "not_found");
    return thread;
  }

  async function writeMarker(thread: import("@arnilo/prism").ConversationThread, marker: Parameters<typeof conversationMarkerMetadata>[0]) {
    const now = new Date().toISOString();
    const result = await appendSession({
      id: thread.id,
      ...(thread.tenantId !== undefined ? { tenantId: thread.tenantId } : {}),
      ...(thread.accountId !== undefined ? { accountId: thread.accountId } : {}),
      ...(thread.userId !== undefined ? { userId: thread.userId } : {}),
      createdAt: thread.createdAt,
      updatedAt: now,
      metadata: conversationMarkerMetadata(marker),
      expectedVersion: thread.version ?? 0,
    });
    return result?.version ?? (thread.version ?? 0) + 1;
  }

  /** CAS conflict on create is a race between two get-or-create callers: the winner wins. */
  function throwMetadataConflict(): never {
    throw new ConversationError("Conversation thread changed concurrently", "metadata_conflict");
  }

  return {
    async create(input) {
      assertOwnership(input.ownership);
      input.signal?.throwIfAborted();
      if (input.identity) assertIdentityMatchesOwnership(input.identity, input.ownership);
      const id = input.id === undefined ? `conv_${randomUUID()}` : assertId(input.id, "id");
      if (input.title !== undefined) assertBytes(input.title, limits.titleBytes, "title_too_large");
      if (input.requestId !== undefined) assertBytes(input.requestId, limits.requestIdBytes, "request_id_too_large");
      if (input.id !== undefined) {
        // Idempotent get-or-create for explicit ids; the create-only CAS below is the
        // race backstop, so a concurrent create returns the winner's thread untouched.
        const existing = await this.get({ ...input, threadId: id }).catch((error: unknown) => {
          if (error instanceof ConversationError && error.reason === "not_found") return undefined;
          throw error;
        });
        if (existing) return existing;
      }
      const now = new Date().toISOString();
      try {
        await appendSession({
          id,
          ...input.ownership,
          createdAt: now,
          updatedAt: now,
          metadata: conversationMarkerMetadata({
            ...(input.title === undefined ? {} : { title: input.title }),
            state: "active",
            ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          }),
          expectedVersion: 0,
        });
      } catch (error) {
        if (isSessionMetadataConflict(error)) return this.get({ ...input, threadId: id });
        throw error;
      }
      return this.get({ ...input, threadId: id });
    },

    async list(input) {
      assertOwnership(input.ownership);
      input.signal?.throwIfAborted();
      if (input.cursor !== undefined) assertBytes(input.cursor, limits.cursorBytes, "cursor_too_large");
      const limit = Math.min(input.limit ?? limits.threadPageLimit, limits.threadPageLimit);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new ConversationError("limit is invalid", "invalid_input");
      const page = await store.querySessions({
        ...input.ownership,
        metadataKey: CONVERSATION_METADATA_KEY,
        cursor: input.cursor,
        limit,
        order: "desc",
      });
      const threads = page.items
        .map((record) => conversationThreadFromRecord(record))
        .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined);
      if (page.nextCursor !== undefined) assertBytes(page.nextCursor, limits.cursorBytes, "cursor_too_large");
      return { items: threads, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
    },

    get(input) {
      return loadThread(input, input.threadId);
    },

    async continue(input) {
      const thread = await loadThread(input, input.threadId);
      if (thread.state === "archived") throw new ConversationError("Conversation thread is archived", "thread_archived");
      const message = assertMessage(input.message);
      if (input.requestId !== undefined) assertBytes(input.requestId, limits.requestIdBytes, "request_id_too_large");
      if (input.leafId !== undefined) {
        assertId(input.leafId, "leafId");
        if (!thread.branches.some((branch) => branch.leafId === input.leafId)) {
          throw new ConversationError("leafId is not a recorded branch of this thread", "unknown_branch");
        }
      }
      const session = await options.sessionFactory({
        thread,
        ownership: input.ownership,
        ...(input.leafId === undefined ? {} : { leafId: input.leafId }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return session.run(message, {
        ...options.runOptions,
        ownership: input.ownership,
        ...(input.identity === undefined ? {} : { identity: input.identity }),
        redactor: options.redactor,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.requestId === undefined ? {} : { idempotencyKey: input.requestId }),
        metadata: { ...options.runOptions?.metadata, conversationThreadId: thread.id },
      });
    },

    async branch(input) {
      const thread = await loadThread(input, input.threadId);
      if (thread.state === "archived") throw new ConversationError("Conversation thread is archived", "thread_archived");
      const leafId = assertId(input.leafId, "leafId");
      if (thread.branches.some((branch) => branch.leafId === leafId)) return thread;
      if (thread.branches.length >= limits.maxActiveBranches) {
        throw new ConversationError("Too many active branches for this thread", "too_many_branches");
      }
      // Branch refs are append-only within the marker; the CAS version guard makes the
      // read-modify-write atomic, so concurrent branches cannot lose a ref or exceed the cap.
      try {
        await writeMarker(thread, {
          ...(thread.title === undefined ? {} : { title: thread.title }),
          state: thread.state,
          branches: [...thread.branches, { leafId, createdAt: new Date().toISOString() }],
          ...(thread.metadata === undefined ? {} : { metadata: thread.metadata }),
        });
      } catch (error) {
        if (isSessionMetadataConflict(error)) throwMetadataConflict();
        throw error;
      }
      return loadThread(input, thread.id);
    },

    async archive(input) {
      const thread = await loadThread(input, input.threadId);
      if (thread.state === "archived") return thread;
      try {
        await writeMarker(thread, {
          ...(thread.title === undefined ? {} : { title: thread.title }),
          state: "archived",
          ...(thread.branches.length === 0 ? {} : { branches: thread.branches }),
          ...(thread.metadata === undefined ? {} : { metadata: thread.metadata }),
        });
      } catch (error) {
        if (isSessionMetadataConflict(error)) throwMetadataConflict();
        throw error;
      }
      return loadThread(input, thread.id);
    },

    async export(input) {
      const thread = await loadThread(input, input.threadId);
      const start =
        input.cursor === undefined ? undefined : decodeConversationReplayCursor(input.cursor, thread.id, limits.cursorBytes).cursor;
      const events: AgentEventRecord[] = [];
      let bytes = 0;
      let pages = 0;
      let truncated = false;
      let resumeCursor: string | undefined = start;
      let nextCursor: string | undefined;
      while (true) {
        input.signal?.throwIfAborted();
        const pageCursor = resumeCursor;
        const page = await store.queryEvents({
          sessionId: thread.id,
          ...input.ownership,
          ...(pageCursor === undefined ? {} : { cursor: pageCursor }),
          limit: limits.replayPageLimit,
          order: "asc",
          redacted: true,
        });
        // Rows from runs without a redactor are never served (fail-closed skip, not throw).
        const records = page.items.filter((record) => record.redacted);
        const pageBytes = records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record), "utf8"), 0);
        // Page-granular byte backstop: stop before a page that would exceed the cap and hand
        // back the cursor to that page. ponytail: a single page larger than exportBytes cannot
        // be exported (no finer store cursor exists); raise exportBytes or stream via replay.
        if (bytes + pageBytes > limits.exportBytes && (bytes > 0 || pageCursor !== undefined)) {
          truncated = true;
          nextCursor = pageCursor;
          break;
        }
        events.push(...records);
        bytes += pageBytes;
        pages += 1;
        if (page.nextCursor === undefined) break;
        if (pages >= limits.exportPages) {
          truncated = true;
          nextCursor = page.nextCursor;
          break;
        }
        resumeCursor = page.nextCursor;
      }
      return {
        thread,
        events: options.redactor.redact(events),
        ...(nextCursor === undefined
          ? {}
          : { nextCursor: encodeConversationReplayCursor({ v: 1, threadId: thread.id, cursor: nextCursor }) }),
        truncated,
      };
    },

    async delete(input) {
      const thread = await loadThread(input, input.threadId);
      if (!store.lifecycle) throw new ConversationError("Store does not support conversation deletion", "unsupported");
      // Lifecycle purges the whole session ledger (entries, runs, events, tool calls, usage,
      // branches, search rows) under legal-hold protection; holds always win over deletion.
      const result = await store.lifecycle.applyRetention({
        policy: CONVERSATION_DELETE_POLICY,
        candidates: [thread.id],
        ...input.ownership,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      return {
        deleted: result.deleted.includes(thread.id),
        held: result.skippedHeld.includes(thread.id),
      };
    },

    async replay(input) {
      const thread = await loadThread(input, input.threadId);
      const inner =
        input.cursor === undefined ? undefined : decodeConversationReplayCursor(input.cursor, thread.id, limits.cursorBytes).cursor;
      const limit = Math.min(input.limit ?? limits.replayPageLimit, limits.replayPageLimit);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new ConversationError("limit is invalid", "invalid_input");
      const page = await store.queryEvents({
        sessionId: thread.id,
        ...input.ownership,
        ...(inner === undefined ? {} : { cursor: inner }),
        limit,
        order: "asc",
        redacted: true,
      });
      if (page.items.length > limit) throw new ConversationError("Replay page exceeds limit", "limit_exceeded");
      const records = page.items.filter((record) => record.redacted);
      const terminal = records.some(
        (record) => record.event.type === "agent_finished" || record.event.type === "agent_denied" || record.event.type === "error",
      );
      if (page.nextCursor !== undefined) assertBytes(page.nextCursor, limits.cursorBytes, "cursor_too_large");
      return {
        records,
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: encodeConversationReplayCursor({ v: 1, threadId: thread.id, cursor: page.nextCursor }) }),
        terminal,
      };
    },
  };
}

export type ConversationOperation =
  | "conversation.create"
  | "conversation.list"
  | "conversation.get"
  | "conversation.continue"
  | "conversation.branch"
  | "conversation.archive"
  | "conversation.export"
  | "conversation.delete"
  | "conversation.replay";

export interface ConversationAuthorizationInput {
  readonly request: Request;
  readonly operation: ConversationOperation;
  readonly threadId?: string;
  readonly signal: AbortSignal;
}

export type ConversationAuthorizer = (
  input: ConversationAuthorizationInput,
) => false | PrismServerAuthorization | Promise<false | PrismServerAuthorization>;

export interface CreateConversationHandlerOptions {
  readonly service: ConversationService;
  readonly authorize: ConversationAuthorizer;
  readonly basePath?: string;
  readonly redactor?: SecretRedactor;
  readonly limits?: ConversationLimits;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Framework-free HTTP adapter for one mounted conversation service (default base `/prism/conversations`). */
export function createConversationHandler(options: CreateConversationHandlerOptions): PrismRequestHandler {
  const base = normalizeBasePath(options.basePath ?? "/prism/conversations");
  const limits = resolveConversationLimits(options.limits);

  return async (request) => {
    try {
      const route = parseConversationRoute(request, base);
      if (!route) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      const authorization = await options.authorize({
        request,
        operation: route.operation,
        ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
        signal: request.signal,
      });
      if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      if (authorization.identity) {
        assertIdentityActive(authorization.identity);
        assertIdentityMatchesOwnership(authorization.identity, authorization.ownership);
      }
      const input = {
        ownership: authorization.ownership,
        ...(authorization.identity === undefined ? {} : { identity: authorization.identity }),
        signal: request.signal,
      };
      const service = options.service;
      switch (route.kind) {
        case "create": {
          const body = await readBody(request, limits.maxRequestBytes);
          const thread = await service.create({
            ...input,
            ...(body.id === undefined ? {} : { id: readString(body.id, "id") }),
            ...(body.title === undefined ? {} : { title: readString(body.title, "title") }),
            ...(body.requestId === undefined ? {} : { requestId: readString(body.requestId, "requestId") }),
            ...(body.metadata === undefined ? {} : { metadata: readObject(body.metadata, "metadata") }),
          });
          return json(options, thread, 201);
        }
        case "list": {
          const query = new URL(request.url).searchParams;
          const page = await service.list({
            ...input,
            ...(query.get("cursor") === null ? {} : { cursor: query.get("cursor") ?? undefined }),
            ...(query.get("limit") === null ? {} : { limit: readPositiveInt(query.get("limit"), "limit") }),
          });
          return json(options, page, 200);
        }
        case "get":
          return json(options, await service.get({ ...input, threadId: route.threadId }), 200);
        case "continue": {
          const body = await readBody(request, limits.maxRequestBytes);
          const result = await service.continue({
            ...input,
            threadId: route.threadId,
            message: body.message as string | Message | readonly Message[],
            ...(body.requestId === undefined ? {} : { requestId: readString(body.requestId, "requestId") }),
            ...(body.leafId === undefined ? {} : { leafId: readString(body.leafId, "leafId") }),
          });
          return json(options, result, 200);
        }
        case "branch": {
          const body = await readBody(request, limits.maxRequestBytes);
          const thread = await service.branch({ ...input, threadId: route.threadId, leafId: readString(body.leafId, "leafId") });
          return json(options, thread, 200);
        }
        case "archive":
          return json(options, await service.archive({ ...input, threadId: route.threadId }), 200);
        case "export": {
          const body = await readBody(request, limits.maxRequestBytes);
          const page = await service.export({
            ...input,
            threadId: route.threadId,
            ...(body.cursor === undefined ? {} : { cursor: readString(body.cursor, "cursor") }),
          });
          return json(options, page, 200);
        }
        case "delete": {
          const result = await service.delete({ ...input, threadId: route.threadId });
          return json(options, result, 200);
        }
        case "replay": {
          const query = new URL(request.url).searchParams;
          const page = await service.replay({
            ...input,
            threadId: route.threadId,
            ...(query.get("cursor") === null ? {} : { cursor: query.get("cursor") ?? undefined }),
            ...(query.get("limit") === null ? {} : { limit: readPositiveInt(query.get("limit"), "limit") }),
          });
          return json(options, page, 200);
        }
      }
    } catch (error) {
      return conversationErrorResponse(error);
    }
  };
}

type ConversationRoute =
  | { readonly kind: "create"; readonly operation: "conversation.create"; readonly threadId?: undefined }
  | { readonly kind: "list"; readonly operation: "conversation.list"; readonly threadId?: undefined }
  | { readonly kind: "get"; readonly operation: "conversation.get"; readonly threadId: string }
  | { readonly kind: "continue"; readonly operation: "conversation.continue"; readonly threadId: string }
  | { readonly kind: "branch"; readonly operation: "conversation.branch"; readonly threadId: string }
  | { readonly kind: "archive"; readonly operation: "conversation.archive"; readonly threadId: string }
  | { readonly kind: "export"; readonly operation: "conversation.export"; readonly threadId: string }
  | { readonly kind: "delete"; readonly operation: "conversation.delete"; readonly threadId: string }
  | { readonly kind: "replay"; readonly operation: "conversation.replay"; readonly threadId: string };

function parseConversationRoute(request: Request, base: string): ConversationRoute | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  let parts: string[];
  try {
    parts = pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new PrismServerError("Invalid route", 400, "ERR_PRISM_SERVER_ROUTE");
  }
  if (parts.length === 0) {
    if (request.method === "POST") return { kind: "create", operation: "conversation.create" };
    if (request.method === "GET") return { kind: "list", operation: "conversation.list" };
    return undefined;
  }
  const [threadId, action] = parts;
  if (!ID_PATTERN.test(threadId) || threadId.length > 128) return undefined;
  if (parts.length === 1) {
    if (request.method === "GET") return { kind: "get", operation: "conversation.get", threadId };
    if (request.method === "DELETE") return { kind: "delete", operation: "conversation.delete", threadId };
    return undefined;
  }
  if (parts.length !== 2) return undefined;
  if (action === "continue" && request.method === "POST") return { kind: "continue", operation: "conversation.continue", threadId };
  if (action === "branch" && request.method === "POST") return { kind: "branch", operation: "conversation.branch", threadId };
  if (action === "archive" && request.method === "POST") return { kind: "archive", operation: "conversation.archive", threadId };
  if (action === "export" && request.method === "POST") return { kind: "export", operation: "conversation.export", threadId };
  if (action === "events" && request.method === "GET") return { kind: "replay", operation: "conversation.replay", threadId };
  return undefined;
}

function json(options: CreateConversationHandlerOptions, value: unknown, status: number): Response {
  const safe = options.redactor?.redact(value) ?? value;
  return new Response(JSON.stringify(safe), { status, headers: JSON_HEADERS });
}

function conversationErrorResponse(error: unknown): Response {
  let status = 500;
  let code = "ERR_PRISM_SERVER_INTERNAL";
  let message = "Internal server error";
  if (error instanceof PrismServerError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof ConversationError) {
    code = error.code;
    message = error.message;
    status =
      error.reason === "not_found"
        ? 404
        : error.reason === "thread_archived"
          ? 409
          : error.reason === "metadata_conflict"
            ? 409
            : error.reason === "ownership"
              ? 403
              : error.reason === "unsupported"
                ? 501
                : error.reason === "not_redacted" || error.reason === "limit_exceeded"
                  ? 500
                  : 400;
  } else if (error instanceof RangeError) {
    status = 400;
    code = "ERR_PRISM_SERVER_INPUT";
    message = error.message;
  } else if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ERR_PRISM_IDENTITY") {
    status = 403;
    code = "ERR_PRISM_SERVER_FORBIDDEN";
    message = "Forbidden";
  } else if (error instanceof DOMException && error.name === "AbortError") {
    status = 499;
    code = "ERR_PRISM_SERVER_ABORTED";
    message = "Request aborted";
  }
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
}

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) throw new RangeError("basePath must be an absolute URL path");
  const normalized = value.length > 1 ? value.replace(/\/+$/, "") : value;
  if (normalized === "/") throw new RangeError("basePath cannot expose the URL root");
  return normalized;
}

function assertOwnership(ownership: OwnershipScope): void {
  if (![ownership.tenantId, ownership.accountId, ownership.userId].some((v) => typeof v === "string" && v.length > 0)) {
    throw new ConversationError("Ownership is required", "ownership");
  }
}

function assertId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !ID_PATTERN.test(value)) {
    throw new ConversationError(`${name} is invalid`, "invalid_id");
  }
  return value;
}

function assertBytes(value: string, maxBytes: number, reason: string): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new ConversationError(`Value exceeds ${maxBytes} bytes`, reason);
}

function assertMessage(value: unknown): string | Message | readonly Message[] {
  if (typeof value === "string" && value.length > 0) return value;
  if (isMessage(value)) return value;
  if (Array.isArray(value) && value.length > 0 && value.every(isMessage)) return value;
  throw new ConversationError("message must be a non-empty string, message, or message array", "invalid_input");
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["system", "user", "assistant", "tool"].includes(String(item.role)) && Array.isArray(item.content);
}

function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap) {
    throw new RangeError(`${name} must be a positive safe integer <= ${cap}`);
  }
  return resolved;
}

async function readBody(request: Request, maxBytes: number): Promise<JsonObject> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  }
  if (text.length === 0) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as JsonObject;
  } catch {
    throw new PrismServerError("Invalid JSON object body", 400, "ERR_PRISM_SERVER_BODY");
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new PrismServerError(`${name} must be a string`, 400, "ERR_PRISM_SERVER_INPUT");
  return value;
}

function readObject(value: unknown, name: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrismServerError(`${name} must be an object`, 400, "ERR_PRISM_SERVER_INPUT");
  return value as JsonObject;
}

function readPositiveInt(value: string | null, name: string): number {
  const parsed = value === null ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new PrismServerError(`${name} must be a positive safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return parsed;
}
