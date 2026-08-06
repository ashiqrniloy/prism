import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AgentEventSourceError,
  type AgentEventEnvelope,
  type AgentEventRecord,
  type AgentEventSource,
  type AgentEventSourceCleanup,
  type AgentEventSourceOptions,
  type AgentEventSourcePage,
  type AgentEventSourceRead,
  type DurableAgentEventRecord,
  type OwnershipScope,
} from "@arnilo/prism";
import type { NatsJetStream, NatsJetStreamConsumer } from "./jetstream.js";

const SUBJECT_PREFIX = "prism.agent-events";
const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;
const HARD_MAX_EVENT_BYTES = 1024 * 1024;
const DEFAULT_MAX_PAGE_SIZE = 100;
const HARD_MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_CURSOR_BYTES = 4 * 1024;
const HARD_MAX_CURSOR_BYTES = 16 * 1024;
const DEFAULT_MAX_QUEUED_EVENTS = 128;
const HARD_MAX_QUEUED_EVENTS = 4096;
const DEFAULT_MAX_SUBSCRIBERS = 256;
const HARD_MAX_SUBSCRIBERS = 4096;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const HARD_POLL_INTERVAL_MS = 30_000;
const DEFAULT_RECONNECT_INITIAL_MS = 100;
const HARD_RECONNECT_INITIAL_MS = 5000;
const DEFAULT_RECONNECT_MAX_MS = 5000;
const HARD_RECONNECT_MAX_MS = 30_000;
const DEFAULT_MAX_RETAINED_EVENTS_PER_RUN = 100_000;
const HARD_MAX_RETAINED_EVENTS_PER_RUN = 1_000_000;
const DEFAULT_CLEANUP_BATCH = 100;
const HARD_CLEANUP_BATCH = 500;
const ACK_WAIT_NS = 30_000_000_000; // 30s: unacked messages redeliver after this
const MAX_DELIVER = 1000; // redelivery cap; beyond it the consumer stalls for host reconciliation

type Limits = Required<AgentEventSourceOptions>;
type Cursor = {
  readonly v: 1;
  readonly tenantId: string;
  readonly accountId?: string;
  readonly userId?: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly id: string;
};
type NormalizedRecord = Omit<DurableAgentEventRecord, "sequence" | "tenantId"> & { readonly sequence?: number; readonly tenantId: string };
type StoredRecord = DurableAgentEventRecord & { readonly tenantId: string };
type NormalizedRead = AgentEventSourceRead & {
  readonly ownership: Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope;
  readonly limit: number;
};

export interface NatsAgentEventSourceOptions {
  /** Narrow JetStream surface (see `createNatsJetStream`); the official client is adapted by the host. */
  readonly connection: NatsJetStream;
  /** Existing JetStream stream name. The host provisions it (subjects `prism.agent-events.>`). */
  readonly stream: string;
  readonly limits?: AgentEventSourceOptions;
  /** Reuse this secret on every replica to make source cursors resumable across them. */
  readonly cursorSecret?: string | Uint8Array;
}

export interface ClosableNatsAgentEventSource extends AgentEventSource {
  close(): Promise<void>;
}

/**
 * NATS JetStream durable `AgentEventSource` (FR-5).
 *
 * One subject per run (`prism.agent-events.<tenant>.<session>.<run>`); the
 * JetStream per-subject sequence is the per-run event sequence. `append` is
 * idempotent by `record.id` within the stream's dedupe window (`Nats-Msg-Id`);
 * `page`/`subscribe` replay per subject from an HMAC-signed cursor;
 * `subscribe` uses a durable pull consumer with explicit acks (at-least-once,
 * redelivery after `ack_wait`); `cleanup` enumerates the session prefix and
 * deletes messages older than `before`. Ownership scoping matches the
 * Postgres source: tenant in the subject, account/user enforced at read time.
 */
export function createNatsAgentEventSource(options: NatsAgentEventSourceOptions): ClosableNatsAgentEventSource {
  if (!options || typeof options !== "object") throw inputError();
  const stream = requiredText(options.stream, "stream");
  const limits = resolveLimits(options.limits ?? {});
  const cursorSecret = resolveCursorSecret(options.cursorSecret);
  const activeSubscribers = new Set<AsyncGenerator<AgentEventEnvelope>>();
  let closed = false;

  const source: ClosableNatsAgentEventSource = {
    async append(input) {
      assertOpen();
      const record = normalizeRecord(input, limits.maxEventBytes);
      const subject = runSubject(record.tenantId, record.sessionId, record.runId);
      const payload = Buffer.from(JSON.stringify(record), "utf8");
      const ack = await options.connection.publish(subject, payload, { msgID: record.id });
      if (ack.duplicate) {
        // The message already exists (same id within the stream dedupe window).
        // Verify the stored content matches; a same-id different-content append fails closed.
        const stored = await options.connection.getMessage(stream, ack.seq);
        if (!stored || !samePayload(stored.data, payload)) throw inputError("Agent event id collision");
        return { ...record, sequence: ack.seq };
      }
      return { ...record, sequence: ack.seq };
    },

    async page(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const read = normalizeRead(input, limits.maxPageSize);
      const after = read.after === undefined ? undefined : await readCursor(read.after, read);
      const startSeq = after === undefined ? 1 : after.sequence + 1;
      const name = ephemeralName("page");
      const consumer = await createConsumer(name, runSubject(read.ownership.tenantId, read.sessionId, read.runId), "all", startSeq);
      try {
        const items: AgentEventEnvelope[] = [];
        let last: StoredRecord | undefined = after;
        const messages = await consumer.fetch({
          max_messages: read.limit + 1,
          expires: limits.pollIntervalMs,
        });
        for await (const message of messages) {
          const record = parseRecord(message.data);
          if (!sameOwnership(read.ownership, record)) continue;
          last = { ...record, sequence: message.seq };
          items.push({ record: last, cursor: encodeCursor(last) });
          if (items.length > read.limit) break;
        }
        const hasMore = items.length > read.limit;
        const selected = hasMore ? items.slice(0, read.limit) : items;
        return {
          items: selected,
          ...(hasMore && selected.length > 0 ? { nextCursor: selected.at(-1)!.cursor } : {}),
          terminal: !hasMore && last !== undefined && isTerminal(last),
        } satisfies AgentEventSourcePage;
      } finally {
        await deleteConsumer(name);
      }
    },

    subscribe(input) {
      assertOpen();
      const read = normalizeRead(input, limits.maxPageSize);
      if (activeSubscribers.size >= limits.maxSubscribers) throw overflowError();
      const generator = subscribe(read, () => activeSubscribers.delete(generator));
      activeSubscribers.add(generator);
      return {
        [Symbol.asyncIterator]() {
          return generator;
        },
      };
    },

    async cleanup(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const ownership = normalizeOwnership(input.ownership);
      const before = parseTimestamp(input.before, "input");
      const limit = bounded(input.limit, DEFAULT_CLEANUP_BATCH, HARD_CLEANUP_BATCH, "cleanup limit");
      const name = ephemeralName("cleanup");
      const subject = `${SUBJECT_PREFIX}.${token(ownership.tenantId, "tenantId")}.*.*`;
      const consumer = await createConsumer(name, subject, "all", 1);
      try {
        let deleted = 0;
        while (deleted < limit) {
          throwIfAborted(input.signal);
          const messages = await consumer.fetch({
            max_messages: Math.min(limit - deleted, limits.maxPageSize) + 1,
            expires: limits.pollIntervalMs,
          });
          let received = 0;
          for await (const message of messages) {
            received += 1;
            const record = parseRecord(message.data);
            if (!sameOwnership(ownership, record)) continue;
            if (Date.parse(record.timestamp) < before) {
              await options.connection.deleteMessage(stream, message.seq);
              deleted += 1;
              if (deleted >= limit) break;
            }
          }
          if (received === 0) break;
        }
        return { deleted };
      } finally {
        await deleteConsumer(name);
      }
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const generator of activeSubscribers) {
        try {
          await generator.return(undefined);
        } catch {
          // Best-effort: the underlying consumer is deleted by the generator's finally.
        }
      }
      activeSubscribers.clear();
    },
  };

  return source;

  async function* subscribe(read: NormalizedRead, onDone: () => void): AsyncGenerator<AgentEventEnvelope> {
    const seen = new Set<string>();
    const after = read.after === undefined ? undefined : await readCursor(read.after, read);
    const startSeq = after === undefined ? 1 : after.sequence + 1;
    const name = durableName(read);
    const subject = runSubject(read.ownership.tenantId, read.sessionId, read.runId);
    const consumer = await createConsumer(name, subject, "explicit", startSeq);
    try {
      while (true) {
        throwIfAborted(read.signal);
        const messages = await consumer.fetch({
          max_messages: Math.min(read.limit, limits.maxPageSize, limits.maxQueuedEvents),
          expires: limits.pollIntervalMs,
        });
        for await (const message of messages) {
          const record = { ...parseRecord(message.data), sequence: message.seq };
          if (!sameOwnership(read.ownership, record)) {
            message.ack();
            continue;
          }
          if (seen.has(record.id)) {
            message.ack();
            continue;
          }
          seen.add(record.id);
          if (seen.size > limits.maxRetainedEventsPerRun) seen.delete(seen.values().next().value!);
          const envelope: AgentEventEnvelope = { record, cursor: encodeCursor(record) };
          yield envelope;
          message.ack();
          if (isTerminal(record)) return;
        }
      }
    } finally {
      onDone();
      await deleteConsumer(name);
    }
  }

  async function createConsumer(name: string, subject: string, ackPolicy: "explicit" | "all", startSeq: number): Promise<NatsJetStreamConsumer> {
    await options.connection.addConsumer(stream, {
      name,
      filter_subject: subject,
      ack_policy: ackPolicy,
      deliver_policy: startSeq <= 1 ? "all" : "by_start_sequence",
      ...(startSeq > 1 ? { opt_start_seq: startSeq } : {}),
      ...(ackPolicy === "explicit" ? { ack_wait: ACK_WAIT_NS, max_deliver: MAX_DELIVER } : {}),
    });
    return options.connection.getConsumer(stream, name);
  }

  async function deleteConsumer(name: string): Promise<void> {
    try {
      await options.connection.deleteConsumer(stream, name);
    } catch {
      // The consumer may already be gone; cleanup is best-effort.
    }
  }

  function runSubject(tenantId: string, sessionId: string, runId: string): string {
    return `${SUBJECT_PREFIX}.${token(tenantId, "tenantId")}.${token(sessionId, "sessionId")}.${token(runId, "runId")}`;
  }

  function encodeCursor(record: StoredRecord): string {
    const payload: Cursor = {
      v: 1,
      tenantId: record.tenantId,
      ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
      ...(record.userId === undefined ? {} : { userId: record.userId }),
      sessionId: record.sessionId,
      runId: record.runId,
      sequence: record.sequence,
      id: record.id,
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", cursorSecret).update(body).digest("base64url");
    const encoded = `${body}.${signature}`;
    if (Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) throw inputError();
    return encoded;
  }

  async function readCursor(encoded: string, input: NormalizedRead): Promise<StoredRecord> {
    const cursor = decodeCursor(encoded, input);
    const stored = await options.connection.getMessage(stream, cursor.sequence);
    if (!stored) throw retentionError();
    const record = parseRecord(stored.data);
    if (
      record.id !== cursor.id ||
      record.sessionId !== input.sessionId ||
      record.runId !== input.runId ||
      !sameOwnership(input.ownership, record)
    ) {
      throw retentionError();
    }
    return { ...record, sequence: cursor.sequence };
  }

  function decodeCursor(encoded: string, input: NormalizedRead): Cursor {
    if (typeof encoded !== "string" || encoded.length === 0 || Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) {
      throw cursorError();
    }
    const [body, signature, extra] = encoded.split(".");
    if (!body || !signature || extra !== undefined) throw cursorError();
    const expected = createHmac("sha256", cursorSecret).update(body).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      throw cursorError();
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw cursorError();
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      throw cursorError();
    }
    if (!validCursor(value)) throw cursorError();
    if (!sameOwnership(input.ownership, value) || value.sessionId !== input.sessionId || value.runId !== input.runId) throw cursorError();
    return value;
  }

  function assertOpen(): void {
    if (closed) throw closedError();
  }
}

function normalizeRecord(input: AgentEventRecord, maxEventBytes: number): NormalizedRecord {
  if (!input || typeof input !== "object") throw inputError();
  const record = clone(input);
  const ownership = normalizeOwnership(record);
  const sessionId = requiredText(record.sessionId);
  const runId = requiredText(record.runId);
  const id = requiredText(record.id);
  if (
    record.redacted !== true ||
    record.type !== record.event?.type ||
    record.event?.sessionId !== sessionId ||
    record.event?.runId !== runId
  ) {
    throw inputError();
  }
  parseTimestamp(record.timestamp, "input");
  if (record.sequence !== undefined && (!Number.isSafeInteger(record.sequence) || record.sequence < 1)) throw inputError();
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > maxEventBytes) throw inputError();
  return { ...record, ...ownership, id, sessionId, runId };
}

function normalizeRead(input: AgentEventSourceRead, maxPageSize: number): NormalizedRead {
  if (!input || typeof input !== "object") throw inputError();
  return {
    ...input,
    ownership: normalizeOwnership(input.ownership),
    sessionId: requiredText(input.sessionId),
    runId: requiredText(input.runId),
    limit: bounded(input.limit, maxPageSize, maxPageSize, "page limit"),
  };
}

function normalizeOwnership(input: OwnershipScope | undefined): Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope {
  if (!input || typeof input.tenantId !== "string" || input.tenantId.length === 0) throw inputError();
  if (input.accountId !== undefined && (typeof input.accountId !== "string" || input.accountId.length === 0)) throw inputError();
  if (input.userId !== undefined && (typeof input.userId !== "string" || input.userId.length === 0)) throw inputError();
  return {
    tenantId: input.tenantId,
    ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
    ...(input.userId === undefined ? {} : { userId: input.userId }),
  };
}

function parseRecord(data: Uint8Array): Omit<StoredRecord, "sequence"> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(data).toString("utf8"));
  } catch {
    throw inputError("Stored agent event is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw inputError();
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.sessionId !== "string" ||
    typeof record.runId !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.type !== "string" ||
    typeof record.timestamp !== "string" ||
    typeof record.redacted !== "boolean" ||
    !record.event ||
    typeof record.event !== "object"
  ) {
    throw inputError("Stored agent event is malformed");
  }
  return record as unknown as Omit<StoredRecord, "sequence">;
}

function validCursor(value: unknown): value is Cursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return (
    cursor.v === 1 &&
    typeof cursor.tenantId === "string" &&
    cursor.tenantId.length > 0 &&
    (cursor.accountId === undefined || (typeof cursor.accountId === "string" && cursor.accountId.length > 0)) &&
    (cursor.userId === undefined || (typeof cursor.userId === "string" && cursor.userId.length > 0)) &&
    typeof cursor.sessionId === "string" &&
    cursor.sessionId.length > 0 &&
    typeof cursor.runId === "string" &&
    cursor.runId.length > 0 &&
    Number.isSafeInteger(cursor.sequence) &&
    (cursor.sequence as number) > 0 &&
    typeof cursor.id === "string" &&
    cursor.id.length > 0
  );
}

function isTerminal(record: DurableAgentEventRecord): boolean {
  return (
    record.type === "agent_finished" || record.type === "agent_denied" || record.type === "run_limit_exceeded" || record.type === "error"
  );
}

function sameOwnership(left: OwnershipScope, right: OwnershipScope): boolean {
  return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
}

function samePayload(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function token(value: string, name: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw inputError(`${name} is not NATS subject-safe`);
  return value;
}

function durableName(read: NormalizedRead): string {
  const digest = createHmac("sha256", "prism-nats-consumer")
    .update(`${read.ownership.tenantId}|${read.sessionId}|${read.runId}`)
    .digest("hex")
    .slice(0, 16);
  return `prism_${digest}_${randomBytes(4).toString("hex")}`;
}

function ephemeralName(kind: "page" | "cleanup"): string {
  return `prism_${kind}_${randomBytes(6).toString("hex")}`;
}

function resolveLimits(input: AgentEventSourceOptions): Limits {
  return {
    maxEventBytes: bounded(input.maxEventBytes, DEFAULT_MAX_EVENT_BYTES, HARD_MAX_EVENT_BYTES, "maxEventBytes"),
    maxPageSize: bounded(input.maxPageSize, DEFAULT_MAX_PAGE_SIZE, HARD_MAX_PAGE_SIZE, "maxPageSize"),
    maxCursorBytes: bounded(input.maxCursorBytes, DEFAULT_MAX_CURSOR_BYTES, HARD_MAX_CURSOR_BYTES, "maxCursorBytes"),
    maxQueuedEvents: bounded(input.maxQueuedEvents, DEFAULT_MAX_QUEUED_EVENTS, HARD_MAX_QUEUED_EVENTS, "maxQueuedEvents"),
    maxSubscribers: bounded(input.maxSubscribers, DEFAULT_MAX_SUBSCRIBERS, HARD_MAX_SUBSCRIBERS, "maxSubscribers"),
    pollIntervalMs: bounded(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, HARD_POLL_INTERVAL_MS, "pollIntervalMs"),
    reconnectInitialMs: bounded(input.reconnectInitialMs, 100, HARD_RECONNECT_INITIAL_MS, "reconnectInitialMs"),
    reconnectMaxMs: bounded(input.reconnectMaxMs, 5000, HARD_RECONNECT_MAX_MS, "reconnectMaxMs"),
    maxRetainedEventsPerRun: bounded(
      input.maxRetainedEventsPerRun,
      DEFAULT_MAX_RETAINED_EVENTS_PER_RUN,
      HARD_MAX_RETAINED_EVENTS_PER_RUN,
      "maxRetainedEventsPerRun",
    ),
    maxRetentionAgeMs: bounded(input.maxRetentionAgeMs, 30 * 24 * 60 * 60 * 1000, 365 * 24 * 60 * 60 * 1000, "maxRetentionAgeMs"),
  };
}

function resolveCursorSecret(secret: string | Uint8Array | undefined): Buffer {
  if (secret === undefined) return randomBytes(32);
  if (typeof secret === "string") {
    if (secret.length === 0) throw inputError("cursorSecret must not be empty");
    return Buffer.from(secret, "utf8");
  }
  if (secret instanceof Uint8Array && secret.byteLength > 0) return Buffer.from(secret);
  throw inputError("cursorSecret must be a non-empty string or Uint8Array");
}

function clone<T>(value: T): T {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error();
    return JSON.parse(encoded) as T;
  } catch {
    throw inputError();
  }
}

function requiredText(value: unknown, name = "value"): string {
  if (typeof value !== "string" || value.length === 0) throw inputError(`${name} is required`);
  return value;
}

function parseTimestamp(value: unknown, kind: "input" | "cursor"): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw kind === "cursor" ? cursorError() : inputError();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw kind === "cursor" ? cursorError() : inputError();
  return parsed;
}

function bounded(value: number | undefined, fallback: number, hard: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hard) throw inputError(`${name} is outside its allowed range`);
  return resolved;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function inputError(message = "Invalid agent event source input"): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_INPUT", message);
}
function cursorError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR", "Invalid agent event source cursor");
}
function retentionError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION", "Agent event source cursor points at a retained event");
}
function overflowError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW", "Agent event source subscriber limit reached");
}
function closedError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED", "Agent event source is closed");
}
