import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AgentEventSourceError,
  type AgentEventEnvelope,
  type AgentEventRecord,
  type AgentEventSource,
  type AgentEventSourceOptions,
  type AgentEventSourcePage,
  type AgentEventSourceRead,
  type DurableAgentEventRecord,
  type OwnershipScope,
} from "@arnilo/prism";
import { createSessionRowMappers, type AgentEventRow } from "@arnilo/prism-session-store-codecs";
import type { Pool, PoolClient } from "pg";
import { qualifyTable } from "./identifiers.js";

const CHANNEL = "prism_agent_events";
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
const DEFAULT_MAX_RETENTION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const HARD_MAX_RETENTION_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_BATCH = 100;
const HARD_CLEANUP_BATCH = 500;

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
type Limits = Required<AgentEventSourceOptions>;
type NormalizedRecord = Omit<DurableAgentEventRecord, "sequence"> & { readonly sequence?: number };
type NormalizedRead = AgentEventSourceRead & {
  readonly ownership: Required<Pick<OwnershipScope, "tenantId">> & OwnershipScope;
  readonly limit: number;
};

export interface PostgresAgentEventSourceOptions {
  readonly pool: Pool;
  readonly schema: string;
  readonly limits?: AgentEventSourceOptions;
  /** Reuse this secret on every replica to make source cursors resumable across them. */
  readonly cursorSecret?: string | Uint8Array;
}

export interface ClosablePostgresAgentEventSource extends AgentEventSource {
  /** Compatibility path for legacy RunLedger records that were not redacted. */
  appendLedger(record: AgentEventRecord): Promise<void>;
  close(): Promise<void>;
}

const { agentEventRecordToRow, rowToAgentEventRecord } = createSessionRowMappers<boolean>({
  encode: (redacted) => redacted,
  decode: (redacted) => redacted,
});

/** PostgreSQL durable source. Notifications only wake indexed durable reads. */
export function createPostgresAgentEventSource(options: PostgresAgentEventSourceOptions): ClosablePostgresAgentEventSource {
  const limits = resolveLimits(options.limits ?? {});
  const events = qualifyTable(options.schema, "prism_agent_events");
  const streams = qualifyTable(options.schema, "prism_agent_event_streams");
  const sessions = qualifyTable(options.schema, "prism_sessions");
  const cursorSecret = resolveCursorSecret(options.cursorSecret);
  const hub = new ListenerHub(options.pool, limits);
  let closed = false;

  const source: ClosablePostgresAgentEventSource = {
    async append(input) {
      assertOpen();
      const record = normalizeRecord(input, limits.maxEventBytes);
      assertCursorFits(record);
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await selectEvent(client, events, record.id, true);
        if (existing) {
          if (!sameRecord(existing, record)) throw inputError();
          await client.query("COMMIT");
          return existing;
        }
        await client.query(
          `INSERT INTO ${sessions} (id, created_at, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
          [record.sessionId, record.timestamp, record.timestamp],
        );
        const sequenceResult = await client.query(
          `INSERT INTO ${streams} (session_id, run_id, next_sequence, updated_at)
           VALUES ($1, $2, 2, $3)
           ON CONFLICT(session_id, run_id) DO UPDATE SET
             next_sequence = ${streams}.next_sequence + 1,
             updated_at = EXCLUDED.updated_at
           RETURNING next_sequence - 1 AS sequence`,
          [record.sessionId, record.runId, record.timestamp],
        );
        const sequence = Number(sequenceResult.rows[0]?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw inputError("Invalid allocated agent event sequence");
        if (record.sequence !== undefined && record.sequence !== sequence) throw inputError("Agent event sequence mismatch");
        const row = agentEventRecordToRow(record, sequence);
        await client.query(
          `INSERT INTO ${events} (
            id, session_id, run_id, entry_id, sequence, type, timestamp, event,
            redacted, tenant_id, account_id, user_id, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            row.id,
            row.session_id,
            row.run_id,
            row.entry_id,
            row.sequence,
            row.type,
            row.timestamp,
            row.event,
            row.redacted,
            row.tenant_id,
            row.account_id,
            row.user_id,
            row.metadata,
          ],
        );
        await client.query("SELECT pg_notify($1, $2)", [CHANNEL, "wake"]);
        await client.query("COMMIT");
        return { ...record, sequence };
      } catch (error) {
        await rollback(client);
        if (postgresCode(error) === "23505") {
          const existing = await selectEvent(options.pool, events, record.id, false);
          if (existing && sameRecord(existing, record)) return existing;
          if (existing) throw inputError();
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async appendLedger(record) {
      if (record.redacted) {
        await source.append(record);
        return;
      }
      const client = await options.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO ${sessions} (id, created_at, updated_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
          [record.sessionId, record.timestamp, record.timestamp],
        );
        const sequenceResult = await client.query(
          `INSERT INTO ${streams} (session_id, run_id, next_sequence, updated_at)
           VALUES ($1, $2, 2, $3)
           ON CONFLICT(session_id, run_id) DO UPDATE SET
             next_sequence = ${streams}.next_sequence + 1,
             updated_at = EXCLUDED.updated_at
           RETURNING next_sequence - 1 AS sequence`,
          [record.sessionId, record.runId ?? "", record.timestamp],
        );
        const sequence = Number(sequenceResult.rows[0]?.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw inputError("Invalid allocated agent event sequence");
        const row = agentEventRecordToRow(record, sequence);
        await client.query(
          `INSERT INTO ${events} (
            id, session_id, run_id, entry_id, sequence, type, timestamp, event,
            redacted, tenant_id, account_id, user_id, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            row.id,
            row.session_id,
            row.run_id,
            row.entry_id,
            row.sequence,
            row.type,
            row.timestamp,
            row.event,
            row.redacted,
            row.tenant_id,
            row.account_id,
            row.user_id,
            row.metadata,
          ],
        );
        await client.query("SELECT pg_notify($1, $2)", [CHANNEL, "wake"]);
        await client.query("COMMIT");
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async page(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const read = normalizeRead(input, limits.maxPageSize);
      const after = read.after === undefined ? undefined : await readCursor(read.after, read);
      const params: unknown[] = [
        read.sessionId,
        read.runId,
        read.ownership.tenantId,
        read.ownership.accountId ?? null,
        read.ownership.userId ?? null,
      ];
      const where = [
        "session_id = $1",
        "run_id = $2",
        "tenant_id = $3",
        "account_id IS NOT DISTINCT FROM $4",
        "user_id IS NOT DISTINCT FROM $5",
        "redacted = TRUE",
      ];
      if (after) {
        params.push(after.sequence, after.id);
        where.push(`(sequence > $${params.length - 1} OR (sequence = $${params.length - 1} AND id > $${params.length}))`);
      }
      params.push(read.limit + 1);
      const result = await options.pool.query(
        `SELECT * FROM ${events} WHERE ${where.join(" AND ")}
         ORDER BY sequence ASC, id ASC
         LIMIT $${params.length}`,
        params,
      );
      const rows = result.rows.map(mapEventRow);
      const hasMore = rows.length > read.limit;
      const selected = hasMore ? rows.slice(0, read.limit) : rows;
      const last = selected.at(-1) ?? after;
      return {
        items: selected.map((record) => ({ record, cursor: encodeCursor(record) })),
        ...(hasMore && selected.length > 0 ? { nextCursor: encodeCursor(selected.at(-1)!) } : {}),
        terminal: !hasMore && last !== undefined && isTerminal(last),
      } satisfies AgentEventSourcePage;
    },

    subscribe(input) {
      return {
        [Symbol.asyncIterator](): AsyncIterator<AgentEventEnvelope> {
          return subscribe(input);
        },
      };
    },

    async cleanup(input) {
      assertOpen();
      throwIfAborted(input.signal);
      const ownership = normalizeOwnership(input.ownership);
      const before = parseTimestamp(input.before, "input");
      const limit = bounded(input.limit, DEFAULT_CLEANUP_BATCH, HARD_CLEANUP_BATCH, "cleanup limit");
      const params: unknown[] = [ownership.tenantId];
      const where = ["tenant_id = $1"];
      if (ownership.accountId === undefined) where.push("account_id IS NULL");
      else {
        params.push(ownership.accountId);
        where.push(`account_id = $${params.length}`);
      }
      if (ownership.userId === undefined) where.push("user_id IS NULL");
      else {
        params.push(ownership.userId);
        where.push(`user_id = $${params.length}`);
      }
      params.push(new Date(before).toISOString(), limit);
      const result = await options.pool.query(
        `WITH doomed AS (
           SELECT id FROM ${events}
           WHERE ${where.join(" AND ")} AND timestamp < $${params.length - 1} AND redacted = TRUE
           ORDER BY timestamp ASC, sequence ASC, id ASC
           LIMIT $${params.length}
         )
         DELETE FROM ${events} event USING doomed
         WHERE event.id = doomed.id`,
        params,
      );
      return { deleted: result.rowCount ?? 0 };
    },

    async close() {
      if (closed) return;
      closed = true;
      await hub.close();
    },
  };

  return source;

  async function* subscribe(input: AgentEventSourceRead): AsyncGenerator<AgentEventEnvelope> {
    assertOpen();
    const read = normalizeRead(input, limits.maxPageSize);
    const wake = await hub.open(read.signal);
    const seen = new Set<string>();
    let after = read.after;
    try {
      while (true) {
        let replay: AgentEventSourcePage;
        try {
          replay = await source.page({ ...read, ...(after === undefined ? {} : { after }) });
        } catch (error) {
          if (error instanceof AgentEventSourceError) throw error;
          await waitForWake(wake, limits.pollIntervalMs);
          continue;
        }
        for (const item of replay.items) {
          after = item.cursor;
          if (seen.has(item.record.id)) continue;
          seen.add(item.record.id);
          if (seen.size > limits.maxRetainedEventsPerRun) seen.delete(seen.values().next().value!);
          yield item;
        }
        if (replay.terminal) return;
        await waitForWake(wake, limits.pollIntervalMs);
      }
    } finally {
      await wake.return();
    }
  }

  function assertOpen(): void {
    if (closed) throw closedError();
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
    const signature = createHmac("sha256", cursorSecret).update(body).digest("base64url");
    const encoded = `${body}.${signature}`;
    if (Buffer.byteLength(encoded, "utf8") > limits.maxCursorBytes) throw inputError();
    return encoded;
  }

  async function readCursor(encoded: string, input: NormalizedRead): Promise<DurableAgentEventRecord> {
    const cursor = decodeCursor(encoded, input);
    const result = await options.pool.query(
      `SELECT * FROM ${events}
       WHERE id = $1 AND session_id = $2 AND run_id = $3 AND sequence = $4
         AND tenant_id = $5 AND account_id IS NOT DISTINCT FROM $6 AND user_id IS NOT DISTINCT FROM $7
         AND redacted = TRUE
       LIMIT 1`,
      [
        cursor.id,
        input.sessionId,
        input.runId,
        cursor.sequence,
        input.ownership.tenantId,
        input.ownership.accountId ?? null,
        input.ownership.userId ?? null,
      ],
    );
    if (!result.rows[0]) throw retentionError();
    return mapEventRow(result.rows[0]);
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

  function assertCursorFits(record: NormalizedRecord): void {
    encodeCursor({ ...record, sequence: record.sequence ?? 1 });
  }
}

class ListenerHub {
  private readonly subscribers = new Set<WakeSubscription>();
  private listener: PoolClient | undefined;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelay: number;
  private closed = false;

  constructor(
    private readonly pool: Pool,
    private readonly limits: Limits,
  ) {
    this.reconnectDelay = limits.reconnectInitialMs;
  }

  async open(signal?: AbortSignal): Promise<WakeSubscription> {
    if (this.closed) throw closedError();
    throwIfAborted(signal);
    if (this.subscribers.size >= this.limits.maxSubscribers) throw overflowError();
    const subscription = new WakeSubscription(this.limits.maxQueuedEvents, signal, () => this.remove(subscription));
    this.subscribers.add(subscription);
    await this.ensureListening();
    return subscription;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    for (const subscriber of this.subscribers) subscriber.fail(closedError());
    this.subscribers.clear();
    await this.stopListener();
    await this.starting;
  }

  private remove(subscription: WakeSubscription): void {
    this.subscribers.delete(subscription);
    if (this.subscribers.size !== 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    void this.stopListener();
  }

  private async ensureListening(): Promise<void> {
    if (this.closed || this.subscribers.size === 0 || this.listener) return;
    if (this.stopping) await this.stopping;
    if (this.closed || this.subscribers.size === 0 || this.listener) return;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = undefined;
      });
    }
    await this.starting;
  }

  private async start(): Promise<void> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      client.on("notification", this.onNotification);
      client.on("error", this.onFailure);
      client.on("end", this.onFailure);
      await client.query(`LISTEN ${CHANNEL}`);
      if (this.closed || this.subscribers.size === 0) {
        detachListener(client, this.onNotification, this.onFailure);
        await releaseListener(client, false);
        return;
      }
      this.listener = client;
      this.reconnectDelay = this.limits.reconnectInitialMs;
      this.wakeAll();
    } catch {
      if (client) {
        detachListener(client, this.onNotification, this.onFailure);
        await releaseListener(client, true);
      }
      this.wakeAll();
      this.scheduleReconnect();
    }
  }

  private readonly onNotification = (notification: { channel: string }) => {
    if (notification.channel === CHANNEL) this.wakeAll();
  };

  private readonly onFailure = () => {
    void this.loseListener();
  };

  private async loseListener(): Promise<void> {
    if (!this.listener) return;
    const client = this.listener;
    this.listener = undefined;
    detachListener(client, this.onNotification, this.onFailure);
    client.release(true);
    this.wakeAll();
    this.scheduleReconnect();
  }

  private async stopListener(): Promise<void> {
    if (this.stopping) return this.stopping;
    const client = this.listener;
    if (!client) return;
    this.listener = undefined;
    detachListener(client, this.onNotification, this.onFailure);
    this.stopping = releaseListener(client, false).finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  private scheduleReconnect(): void {
    if (this.closed || this.subscribers.size === 0 || this.listener || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.limits.reconnectMaxMs, this.reconnectDelay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureListening();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private wakeAll(): void {
    for (const subscriber of this.subscribers) subscriber.notify();
  }
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
      const waiting = this.waiting;
      this.waiting = undefined;
      waiting.resolve({ value: undefined, done: false });
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
    if (this.failure === undefined) waiting?.resolve({ value: undefined, done: true });
    else waiting?.reject(this.failure);
  }
}

async function waitForWake(wake: WakeSubscription, delay: number): Promise<void> {
  const timer = setTimeout(() => wake.notify(), delay);
  timer.unref?.();
  try {
    const result = await wake.next();
    if (result.done) throw closedError();
  } finally {
    clearTimeout(timer);
  }
}

async function selectEvent(
  source: Pick<Pool, "query"> | PoolClient,
  events: string,
  id: string,
  lock: boolean,
): Promise<DurableAgentEventRecord | undefined> {
  const result = await source.query(`SELECT * FROM ${events} WHERE id = $1 LIMIT 1${lock ? " FOR UPDATE" : ""}`, [id]);
  return result.rows[0] ? mapEventRow(result.rows[0]) : undefined;
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Original error is more useful and no transaction survives a released client.
  }
}

async function releaseListener(client: PoolClient, destroy: boolean): Promise<void> {
  if (destroy) {
    client.release(true);
    return;
  }
  try {
    await client.query(`UNLISTEN ${CHANNEL}`);
  } catch {
    client.release(true);
    return;
  }
  client.release();
}

function detachListener(client: PoolClient, notification: (notification: { channel: string }) => void, failure: () => void): void {
  client.removeListener("notification", notification);
  client.removeListener("error", failure);
  client.removeListener("end", failure);
}

function mapEventRow(row: Record<string, unknown>): DurableAgentEventRecord {
  try {
    const record = rowToAgentEventRecord(row as unknown as AgentEventRow<boolean>);
    const sequence = record.sequence;
    if (!record.runId || typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1 || !isValidStoredRecord(record)) {
      throw new Error();
    }
    return { ...record, runId: record.runId, sequence };
  } catch {
    throw inputError("Invalid stored agent event");
  }
}

function resolveLimits(options: AgentEventSourceOptions): Limits {
  const limits = {
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
  if (limits.reconnectInitialMs > limits.reconnectMaxMs) throw inputError("reconnectInitialMs must not exceed reconnectMaxMs");
  return limits;
}

function resolveCursorSecret(value: string | Uint8Array | undefined): Buffer {
  const secret = value === undefined ? randomBytes(32) : Buffer.from(value);
  if (secret.length === 0 || secret.length > 4096) throw inputError("Invalid event cursor secret");
  return secret;
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

function isValidStoredRecord(record: AgentEventRecord): boolean {
  try {
    normalizeRecord(record, HARD_MAX_EVENT_BYTES);
    return true;
  } catch {
    return false;
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
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
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

function sameOwnership(left: OwnershipScope, right: OwnershipScope): boolean {
  return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

function postgresCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
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
