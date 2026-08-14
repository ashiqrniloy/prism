import type { OwnershipScope, SessionRecord } from "./contracts.js";

/** Conversation thread lifecycle state. Archive is soft; deletion goes through persistence lifecycle. */
export type ConversationThreadState = "active" | "archived";

/** Well-known `SessionRecord.metadata` key marking conversation threads. */
export const CONVERSATION_METADATA_KEY = "prismConversation";

export const DEFAULT_MAX_CONVERSATION_CURSOR_BYTES = 4 * 1024;
export const HARD_MAX_CONVERSATION_CURSOR_BYTES = 16 * 1024;

export interface ConversationBranchRef {
  readonly leafId: string;
  readonly createdAt: string;
}

/**
 * Durable user-scoped conversation thread. A thread is an ownership-scoped session
 * branch plus metadata; content lives in session entries and the redacted event ledger.
 */
export interface ConversationThread extends OwnershipScope {
  readonly id: string;
  readonly title?: string;
  readonly state: ConversationThreadState;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Branch leaves recorded by the conversation service; the entry tree remains the content source of truth. */
  readonly branches: readonly ConversationBranchRef[];
  /** CAS write version (stored `SessionRecord.version`); undefined on legacy rows. */
  readonly version?: number;
  /** Host-supplied create metadata; never credentials or raw transcripts. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Opaque thread-bound replay cursor; prevents replaying a cursor minted for another thread. */
export interface ConversationReplayCursor {
  readonly v: 1;
  readonly threadId: string;
  /** Opaque store keyset cursor; undefined means the start of the thread. */
  readonly cursor?: string;
}

export class ConversationError extends Error {
  readonly code = "ERR_PRISM_CONVERSATION";
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

export function encodeConversationReplayCursor(cursor: ConversationReplayCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeConversationReplayCursor(
  encoded: string,
  expectedThreadId: string,
  maxBytes: number = DEFAULT_MAX_CONVERSATION_CURSOR_BYTES,
): ConversationReplayCursor {
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new ConversationError("Replay cursor is required", "invalid_cursor");
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new ConversationError("Replay cursor exceeds byte limit", "cursor_too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ConversationError("Replay cursor is invalid", "invalid_cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConversationError("Replay cursor is invalid", "invalid_cursor");
  }
  const cursor = parsed as Record<string, unknown>;
  if (cursor.v !== 1 || typeof cursor.threadId !== "string" || cursor.threadId.length === 0) {
    throw new ConversationError("Replay cursor is invalid", "invalid_cursor");
  }
  if (cursor.threadId !== expectedThreadId) {
    throw new ConversationError("Replay cursor belongs to another thread", "cursor_thread_mismatch");
  }
  if (cursor.cursor !== undefined && (typeof cursor.cursor !== "string" || cursor.cursor.length === 0)) {
    throw new ConversationError("Replay cursor is invalid", "invalid_cursor");
  }
  return {
    v: 1,
    threadId: cursor.threadId,
    ...(cursor.cursor === undefined ? {} : { cursor: cursor.cursor }),
  };
}

/** Project a persisted session record into a conversation thread. Undefined for non-conversation sessions. */
export function conversationThreadFromRecord(record: SessionRecord): ConversationThread | undefined {
  const marker = record.metadata?.[CONVERSATION_METADATA_KEY];
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return undefined;
  const value = marker as Record<string, unknown>;
  const branches: ConversationBranchRef[] = [];
  if (Array.isArray(value.branches)) {
    for (const item of value.branches) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).leafId === "string" &&
        typeof (item as Record<string, unknown>).createdAt === "string"
      ) {
        branches.push({
          leafId: (item as Record<string, unknown>).leafId as string,
          createdAt: (item as Record<string, unknown>).createdAt as string,
        });
      }
    }
  }
  const metadata =
    value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata)
      ? (value.metadata as Readonly<Record<string, unknown>>)
      : undefined;
  return {
    id: record.id,
    ...(record.tenantId !== undefined ? { tenantId: record.tenantId } : {}),
    ...(record.accountId !== undefined ? { accountId: record.accountId } : {}),
    ...(record.userId !== undefined ? { userId: record.userId } : {}),
    ...(typeof value.title === "string" && value.title.length > 0 ? { title: value.title } : {}),
    state: value.state === "archived" ? "archived" : "active",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    branches: Object.freeze(branches),
    version: record.version ?? 0,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

/** Serialize conversation marker metadata for `SessionRecord.metadata`. */
export function conversationMarkerMetadata(marker: {
  readonly title?: string;
  readonly state: ConversationThreadState;
  readonly branches?: readonly ConversationBranchRef[];
  readonly requestId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    [CONVERSATION_METADATA_KEY]: {
      ...(marker.title === undefined ? {} : { title: marker.title }),
      state: marker.state,
      ...(marker.branches === undefined || marker.branches.length === 0 ? {} : { branches: marker.branches }),
      ...(marker.requestId === undefined ? {} : { requestId: marker.requestId }),
      ...(marker.metadata === undefined ? {} : { metadata: marker.metadata }),
    },
  };
}
