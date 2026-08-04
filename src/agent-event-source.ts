import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  AgentEventEnvelope,
  AgentEventRecord,
  AgentEventSource,
  AgentEventSourceCleanup,
  AgentEventSourceOptions,
  AgentEventSourcePage,
  AgentEventSourceRead,
  DurableAgentEventRecord,
  OwnershipScope,
} from "./contracts.js";

export type AgentEventSourceErrorCode =
  | "ERR_PRISM_AGENT_EVENT_SOURCE_INPUT"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW"
  | "ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED";

export class AgentEventSourceError extends Error {
  constructor(
    readonly code: AgentEventSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentEventSourceError";
  }
}

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
const DEFAULT_MAX_RETAINED_EVENTS_PER_RUN = 10_000;
const HARD_MAX_RETAINED_EVENTS_PER_RUN = 100_000;
const DEFAULT_MAX_RETENTION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HARD_MAX_RETENTION_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_BATCH = 100;
const HARD_CLEANUP_BATCH = 500;

type ResolvedOptions = Required<AgentEventSourceOptions>;
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
type Stream = {
  readonly ownership: Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  records: Map<number, DurableAgentEventRecord>;
  nextSequence: number;
};
type NormalizedRecord = Omit<DurableAgentEventRecord, "sequence"> & { readonly sequence?: number };

/**
 * In-process, non-production reference implementation. It has no cross-process
 * wakeup or persistence; use a database-backed source for distributed delivery.
 */
export function createMemoryAgentEventSource(options: AgentEventSourceOptions = {}): AgentEventSource {
  const limits = resolveOptions(options);
  const streams = new Map<string, Stream>();
  const byId = new Map<string, DurableAgentEventRecord>();
  const subscribers = new Set<WakeSubscription>();
  const secret = randomBytes(32);
  let closed = false;

  const source: AgentEventSource & { close(): void } = {
    async append(input) {
      assertOpen();
      const record = normalizeRecord(input, limits.maxEventBytes);
      const existing = byId.get(record.id);
      if (existing) {
        if (sameRecord(existing, record)) return clone(existing);
        throw inputError();
      }

      const stream = getStream(record, true)!;
      const sequence = record.sequence ?? stream.nextSequence;
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence !== stream.nextSequence) throw inputError();
      const stored: DurableAgentEventRecord = { ...record, sequence };
      assertCursorFits(stored);
      stream.records.set(stored.sequence, stored);
      stream.nextSequence += 1;
      byId.set(stored.id, stored);
      while (stream.records.size > limits.maxRetainedEventsPerRun) drop(stream, stream.records.values().next().value!);
      for (const subscriber of subscribers) subscriber.notify();
      return clone(stored);
    },

    async page(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const read = normalizeRead(input, limits.maxPageSize);
      const stream = getStream({ ...read.ownership, sessionId: read.sessionId, runId: read.runId }, false);
      const records = orderedRecords(stream);
      const after = read.after === undefined ? undefined : decodeCursor(read.after, read, stream, records);
      const start = after === undefined ? 0 : positionAfter(records, after, stream);
      const selected = records.slice(start, start + read.limit);
      const hasMore = start + selected.length < records.length;
      return {
        items: selected.map((record) => ({ record: clone(record), cursor: encodeCursor(record) })),
        ...(hasMore && selected.length > 0 ? { nextCursor: encodeCursor(selected.at(-1)!) } : {}),
        terminal: !hasMore && terminalAt(records, after),
      };
    },

    subscribe(input) {
      return handoffAgentEvents(
        (after) => source.page({ ...input, ...(after === undefined ? {} : { after }) }),
        () => createWake(input.signal),
        input.after,
        limits.maxRetainedEventsPerRun,
      );
    },

    async cleanup(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const ownership = normalizeOwnership(input.ownership);
      const before = parseTimestamp(input.before, "input");
      const limit = bounded(input.limit, DEFAULT_CLEANUP_BATCH, HARD_CLEANUP_BATCH, "cleanup limit");
      const matches: Array<{ stream: Stream; record: DurableAgentEventRecord }> = [];
      for (const stream of streams.values()) {
        if (!sameOwnership(ownership, stream.ownership)) continue;
        for (const record of stream.records.values()) {
          if (Date.parse(record.timestamp) < before) matches.push({ stream, record });
        }
      }
      matches.sort(
        (a, b) =>
          a.record.timestamp.localeCompare(b.record.timestamp) ||
          a.record.sequence - b.record.sequence ||
          a.record.id.localeCompare(b.record.id),
      );
      for (const { stream, record } of matches.slice(0, limit)) drop(stream, record);
      return { deleted: Math.min(matches.length, limit) };
    },

    close() {
      if (closed) return;
      closed = true;
      for (const subscriber of subscribers) subscriber.fail(closedError());
      subscribers.clear();
    },
  };

  return source;

  function getStream(
    input: Pick<AgentEventRecord, "tenantId" | "accountId" | "userId" | "sessionId" | "runId">,
    create: boolean,
  ): Stream | undefined {
    const ownership = normalizeOwnership(input);
    const sessionId = requiredText(input.sessionId);
    const runId = requiredText(input.runId);
    const key = streamKey(ownership, sessionId, runId);
    let stream = streams.get(key);
    if (!stream && create) {
      stream = { ownership, sessionId, runId, records: new Map(), nextSequence: 1 };
      streams.set(key, stream);
    }
    return stream;
  }

  function encodeCursor(record: DurableAgentEventRecord): string {
    const payload: Cursor = {
      v: 1,
      tenantId: record.tenantId!,
      ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
      ...(record.userId === undefined ? {} : { userId: record.userId }),
      sessionId: record.sessionId,
      runId: record.runId,
      sequence: record.sequence,
      id: record.id,
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", secret).update(body).digest("base64url");
    const encoded = `${body}.${signature}`;
    if (Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) throw inputError();
    return encoded;
  }

  function decodeCursor(
    encoded: string,
    input: AgentEventSourceRead,
    stream: Stream | undefined,
    records: readonly DurableAgentEventRecord[],
  ): Cursor {
    if (typeof encoded !== "string" || encoded.length === 0 || Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) {
      throw cursorError();
    }
    const [body, signature, extra] = encoded.split(".");
    if (!body || !signature || extra !== undefined) throw cursorError();
    const expected = createHmac("sha256", secret).update(body).digest();
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
    const cursor = value;
    if (!sameOwnership(input.ownership, cursor) || cursor.sessionId !== input.sessionId || cursor.runId !== input.runId) {
      throw cursorError();
    }
    if (!stream || positionOf(records, cursor) < 0) throw retentionError();
    return cursor;
  }

  function assertCursorFits(record: DurableAgentEventRecord): void {
    void encodeCursor(record);
  }

  function createWake(signal?: AbortSignal): WakeSubscription {
    throwIfAborted(signal);
    if (subscribers.size >= limits.maxSubscribers) throw overflowError();
    const subscription = new WakeSubscription(limits.maxQueuedEvents, signal, () => subscribers.delete(subscription));
    subscribers.add(subscription);
    return subscription;
  }

  function drop(stream: Stream, record: DurableAgentEventRecord): void {
    if (stream.records.get(record.sequence) === record) stream.records.delete(record.sequence);
    if (byId.get(record.id) === record) byId.delete(record.id);
  }

  function assertOpen(): void {
    if (closed) throw closedError();
  }
}

/** Shared replay/live loop. Its live iterator is started before every page, closing the query-to-wait race. */
function handoffAgentEvents(
  page: (after?: string) => Promise<AgentEventSourcePage>,
  createWake: () => AsyncIterator<void>,
  initialAfter: string | undefined,
  maxSeen: number,
): AsyncIterable<AgentEventEnvelope> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<AgentEventEnvelope> {
      const wake = createWake();
      const iterator = run(wake);
      return {
        next: () => iterator.next(),
        async return() {
          await wake.return?.();
          return (await iterator.return?.(undefined)) ?? { value: undefined, done: true };
        },
        async throw(error?: unknown) {
          await wake.return?.();
          if (iterator.throw) return iterator.throw(error);
          throw error;
        },
      };
    },
  };

  async function* run(wake: AsyncIterator<void>): AsyncGenerator<AgentEventEnvelope> {
    const seen = new Set<string>();
    let after = initialAfter;
    let waiting = nextWake(wake); // Register live delivery before replaying durable rows.
    try {
      while (true) {
        const replay = await page(after);
        for (const item of replay.items) {
          after = item.cursor;
          if (seen.has(item.record.id)) continue;
          seen.add(item.record.id);
          if (seen.size > maxSeen) seen.delete(seen.values().next().value!);
          yield item;
        }
        if (replay.terminal) return;
        const next = await waiting;
        if (next.done) return;
        waiting = nextWake(wake);
      }
    } finally {
      await wake.return?.();
    }
  }
}

function nextWake(wake: AsyncIterator<void>): Promise<IteratorResult<void>> {
  const next = wake.next();
  // A slow subscriber can overflow while replay items are yielded. Keep the
  // rejection observed until the generator reaches its next wait.
  void next.catch(() => undefined);
  return next;
}

class WakeSubscription implements AsyncIterator<void> {
  private queued = 0;
  private waiting: { resolve: (value: IteratorResult<void>) => void; reject: (reason?: unknown) => void } | undefined;
  private failure: unknown;
  private done = false;
  private readonly abort: () => void;

  constructor(
    private readonly maxQueuedEvents: number,
    signal: AbortSignal | undefined,
    private readonly onFinish: () => void,
  ) {
    this.abort = () => this.fail(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) this.abort();
    else signal?.addEventListener("abort", this.abort, { once: true });
  }

  notify(): void {
    if (this.done) return;
    if (this.waiting) {
      const { resolve } = this.waiting;
      this.waiting = undefined;
      resolve({ value: undefined, done: false });
      return;
    }
    if (this.queued >= this.maxQueuedEvents) {
      this.fail(overflowError());
      return;
    }
    this.queued += 1;
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.failure = error;
    this.finish();
  }

  async next(): Promise<IteratorResult<void>> {
    if (this.failure !== undefined) throw this.failure;
    if (this.done) return { value: undefined, done: true };
    if (this.queued > 0) {
      this.queued -= 1;
      return { value: undefined, done: false };
    }
    return new Promise<IteratorResult<void>>((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  async return(): Promise<IteratorResult<void>> {
    this.finish();
    return { value: undefined, done: true };
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.onFinish();
    const waiting = this.waiting;
    this.waiting = undefined;
    if (this.failure !== undefined) waiting?.reject(this.failure);
    else waiting?.resolve({ value: undefined, done: true });
  }
}

function resolveOptions(options: AgentEventSourceOptions): ResolvedOptions {
  const resolved = {
    maxEventBytes: bounded(options.maxEventBytes, DEFAULT_MAX_EVENT_BYTES, HARD_MAX_EVENT_BYTES, "maxEventBytes"),
    maxPageSize: bounded(options.maxPageSize, DEFAULT_MAX_PAGE_SIZE, HARD_MAX_PAGE_SIZE, "maxPageSize"),
    maxCursorBytes: bounded(options.maxCursorBytes, DEFAULT_MAX_CURSOR_BYTES, HARD_MAX_CURSOR_BYTES, "maxCursorBytes"),
    maxQueuedEvents: bounded(options.maxQueuedEvents, DEFAULT_MAX_QUEUED_EVENTS, HARD_MAX_QUEUED_EVENTS, "maxQueuedEvents"),
    maxSubscribers: bounded(options.maxSubscribers, DEFAULT_MAX_SUBSCRIBERS, HARD_MAX_SUBSCRIBERS, "maxSubscribers"),
    pollIntervalMs: bounded(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, HARD_POLL_INTERVAL_MS, "pollIntervalMs"),
    reconnectInitialMs: bounded(options.reconnectInitialMs, DEFAULT_RECONNECT_INITIAL_MS, HARD_RECONNECT_INITIAL_MS, "reconnectInitialMs"),
    reconnectMaxMs: bounded(options.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS, HARD_RECONNECT_MAX_MS, "reconnectMaxMs"),
    maxRetainedEventsPerRun: bounded(
      options.maxRetainedEventsPerRun,
      DEFAULT_MAX_RETAINED_EVENTS_PER_RUN,
      HARD_MAX_RETAINED_EVENTS_PER_RUN,
      "maxRetainedEventsPerRun",
    ),
    maxRetentionAgeMs: bounded(options.maxRetentionAgeMs, DEFAULT_MAX_RETENTION_AGE_MS, HARD_MAX_RETENTION_AGE_MS, "maxRetentionAgeMs"),
  };
  if (resolved.reconnectInitialMs > resolved.reconnectMaxMs) {
    throw new RangeError("reconnectInitialMs must not exceed reconnectMaxMs");
  }
  return resolved;
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
    record.event.sessionId !== sessionId ||
    record.event.runId !== runId
  ) {
    throw inputError();
  }
  parseTimestamp(record.timestamp, "input");
  if (record.sequence !== undefined && (!Number.isSafeInteger(record.sequence) || record.sequence < 1)) throw inputError();
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > maxEventBytes) throw inputError();
  return {
    ...record,
    ...ownership,
    id,
    sessionId,
    runId,
    ...(record.sequence === undefined ? {} : { sequence: record.sequence }),
  };
}

function normalizeRead(input: AgentEventSourceRead, maxPageSize: number): AgentEventSourceRead & { readonly limit: number } {
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

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw inputError();
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

function sameOwnership(a: OwnershipScope, b: OwnershipScope): boolean {
  return a.tenantId === b.tenantId && a.accountId === b.accountId && a.userId === b.userId;
}

function streamKey(ownership: OwnershipScope, sessionId: string, runId: string): string {
  return JSON.stringify([ownership.tenantId, ownership.accountId, ownership.userId, sessionId, runId]);
}

function orderedRecords(stream: Stream | undefined): DurableAgentEventRecord[] {
  return stream ? [...stream.records.values()] : [];
}

function positionOf(records: readonly DurableAgentEventRecord[], cursor: Cursor): number {
  return records.findIndex((record) => record.sequence === cursor.sequence && record.id === cursor.id);
}

function positionAfter(records: readonly DurableAgentEventRecord[], cursor: Cursor, stream: Stream | undefined): number {
  const position = positionOf(records, cursor);
  if (position >= 0) return position + 1;
  if (!stream || cursor.sequence < stream.nextSequence) throw retentionError();
  throw cursorError();
}

function terminalAt(records: readonly DurableAgentEventRecord[], after: Cursor | undefined): boolean {
  const last = records.at(-1);
  if (!last || !isTerminal(last)) return false;
  return after === undefined || after.sequence <= last.sequence;
}

function isTerminal(record: DurableAgentEventRecord): boolean {
  return (
    record.type === "agent_finished" || record.type === "agent_denied" || record.type === "run_limit_exceeded" || record.type === "error"
  );
}

function sameRecord(existing: DurableAgentEventRecord, input: NormalizedRecord): boolean {
  const { sequence: _existingSequence, ...existingWithoutSequence } = existing;
  const { sequence: _inputSequence, ...inputWithoutSequence } = input;
  return stableJson(existingWithoutSequence) === stableJson(inputWithoutSequence);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function clone<T>(value: T): T {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("not JSON serializable");
    return JSON.parse(encoded) as T;
  } catch {
    throw inputError();
  }
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function inputError(message = "Invalid agent event source input"): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_INPUT", message);
}

function cursorError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR", "Invalid agent event cursor");
}

function retentionError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_RETENTION", "Agent event history is unavailable");
}

function overflowError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_OVERFLOW", "Agent event subscription overflow");
}

function closedError(): AgentEventSourceError {
  return new AgentEventSourceError("ERR_PRISM_AGENT_EVENT_SOURCE_CLOSED", "Agent event source is closed");
}
