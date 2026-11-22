// Plan 236 Task 4: native-fetch Slack adapter on the shared channel runtime. Importing and
// constructing are inert; Socket Mode opens only in `start`, and the Events API handler is
// host-mounted. Both transports feed one payload parser and await `admit` before acknowledging.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Agent } from "@arnilo/prism";
import type { CheckpointStore, LeaseStore } from "./checkpoint-contract.js";
import { bindChannelHostUi } from "./host-ui.js";
import { retryableAdmission } from "./admission.js";
import { type ChannelSecretSource, resolveChannelSecretRef, createChannelRedactor } from "./secret-ref.js";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "./memory-stores.js";
import { createChannelRuntime } from "./runtime.js";
import type {
  ChannelAdapter,
  ChannelAssistantDelta,
  ChannelAuthorizeInput,
  ChannelAuthorization,
  ChannelConnectionHandle,
  ChannelInboundEvent,
  ChannelLimits,
  ChannelReceive,
  ChannelReplyControl,
} from "./types.js";

export type { ChannelConnectionHandle, ChannelSecretSource };

const DEFAULT_API_ORIGIN = "https://slack.com";
/** `chat.postMessage` truncates `text` past 40,000 characters. */
const SLACK_TEXT_CODE_UNITS = 40_000;
/** A Block Kit `section` text object holds at most 3,000 characters. */
const SLACK_SECTION_CODE_UNITS = 3_000;
/** A preview shows the newest part of the answer; escaped it stays far below the text limit. */
const SLACK_DRAFT_CODE_UNITS = 4_000;
/** Slack's replay window for signed requests. */
const SIGNATURE_WINDOW_SECONDS = 300;
const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024;
const MAX_SEND_ATTEMPTS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;
const DEFAULT_DRAFT_INTERVAL_MS = 1_000;
const MAX_PREVIEWS = 256;
const SOCKET_OPEN_TIMEOUT_MS = 10_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TS_PATTERN = /^\d{1,12}\.\d{1,8}$/;
/** Commands the runtime understands; Slack intercepts a leading `/` as a slash command, so `!new` is accepted too. */
const BANG_COMMAND = /^!(help|status|new|cancel|approve|deny|answer)(?=\s|$)/i;

/** The subset of the WHATWG `WebSocket` the Socket Mode client uses. */
export interface SlackSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { readonly data?: unknown }) => void): void;
}

export interface SlackAdapterOptions {
  /** Stable host-selected connection id; it is never read from Slack input. */
  readonly connectionId: string;
  /** Bot token (`xoxb-`), resolved only for Web API calls; it never reaches events or errors. */
  readonly botToken: ChannelSecretSource;
  /** App-level token (`xapp-`, `connections:write`). Required for Socket Mode `start`. */
  readonly appToken?: ChannelSecretSource;
  /** Opt-in preview message, updated at most once per `draftIntervalMs` and deleted after the reply. */
  readonly sendDrafts?: boolean;
  /** Minimum interval between preview writes (default 1,000 ms, 100–60,000). */
  readonly draftIntervalMs?: number;
  /** Bounds Socket Mode frames and Web API response bodies (default 128 KiB, hard 1 MiB). */
  readonly maxRequestBytes?: number;
  /** Trusted exact HTTPS API origin; defaults to `https://slack.com`. */
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Socket factory for Socket Mode; defaults to the global `WebSocket`. */
  readonly webSocket?: (url: string) => SlackSocket;
}

/** Channel adapter with Slack's rate-bounded preview message. */
export interface SlackAdapter extends ChannelAdapter {
  /** Fire-and-forget preview of the answer being produced. No-op unless `sendDrafts` is on. */
  sendDraft(delta: ChannelAssistantDelta): void;
  /** Verified Events API / interactivity handler. Without a signing secret it answers 401. */
  handleRequest(request: Request, receive: ChannelReceive, signingSecret: ChannelSecretSource | undefined): Promise<Response>;
}

class SlackApiError extends Error {
  readonly status?: number;
  readonly retryAfter?: number;
  readonly error?: string;
  readonly kind: "api" | "credential" | "network" | "response";

  constructor(shape: { kind: SlackApiError["kind"]; status?: number; retryAfter?: number; error?: string }) {
    super("Slack API request failed");
    this.name = "SlackApiError";
    this.kind = shape.kind;
    this.status = shape.status;
    this.retryAfter = shape.retryAfter;
    this.error = shape.error;
  }
}

class SlackDeliveryUnknownError extends Error {
  constructor() {
    super("Slack delivery outcome unknown");
    this.name = "SlackDeliveryUnknownError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : undefined;
}

function asTs(value: unknown): string | undefined {
  return typeof value === "string" && TS_PATTERN.test(value) ? value : undefined;
}

function apiOrigin(value: string | undefined): string {
  const raw = value ?? DEFAULT_API_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Slack apiOrigin must be an exact HTTPS origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== raw
  ) {
    throw new TypeError("Slack apiOrigin must be an exact HTTPS origin");
  }
  return parsed.origin;
}

/** A host-set adapter limit, at least `min`. The host's value is the cap (plan 239 Task 5). */
function boundedInteger(value: number | undefined, fallback: number, min: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min) {
    throw new TypeError(`Slack ${name} must be an integer of at least ${min}`);
  }
  return resolved;
}

function constantTimeEqual(expected: string, actual: string | null): boolean {
  if (actual === null) return false;
  return timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(actual).digest());
}

/** Slack `mrkdwn` control characters; escaping keeps model text from forming `<!channel>` or links. */
function escapeCodePoint(codePoint: string): string {
  return codePoint === "&" ? "&amp;" : codePoint === "<" ? "&lt;" : codePoint === ">" ? "&gt;" : codePoint;
}

/** Escape, then split on code points so no chunk exceeds `limit` and no entity or pair is split. */
export function chunkSlackText(text: string, limit: number): readonly string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const codePoint of text) {
    const piece = escapeCodePoint(codePoint);
    if (chunk.length > 0 && chunk.length + piece.length > limit) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += piece;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function draftText(text: string): string {
  let start = Math.max(0, text.length - SLACK_DRAFT_CODE_UNITS);
  const code = text.charCodeAt(start);
  if (start > 0 && code >= 0xdc00 && code <= 0xdfff) start += 1;
  return chunkSlackText(text.slice(start), Number.MAX_SAFE_INTEGER)[0] ?? "";
}

/** `<team>:<channel>` is the bound conversation; only the adapter ever builds it. */
function destination(conversationId: string): { readonly teamId: string; readonly channel: string } | undefined {
  const [teamId, channel, extra] = conversationId.split(":");
  if (extra !== undefined || asId(teamId) === undefined || asId(channel) === undefined) return undefined;
  return { teamId: teamId as string, channel: channel as string };
}

function commandText(text: string): string {
  const trimmed = text.replace(/^(?:\s*<@[A-Z0-9]+>)+\s*/, "").trim();
  return BANG_COMMAND.test(trimmed) ? `/${trimmed.slice(1)}` : trimmed;
}

/** Parse one `event_callback` body (HTTP or a Socket Mode `events_api` payload). */
export function parseSlackEventCallback(connectionId: string, body: unknown): ChannelInboundEvent | undefined {
  const envelope = asRecord(body);
  const event = asRecord(envelope?.event);
  if (envelope?.type !== "event_callback" || event === undefined) return undefined;
  const eventId = asId(envelope.event_id);
  const teamId = asId(envelope.team_id) ?? asId(event.team);
  // The bot's own messages and every edit, join, or file share carry `bot_id` or a `subtype`.
  if (eventId === undefined || teamId === undefined || event.bot_id !== undefined || event.subtype !== undefined) return undefined;
  const isMention = event.type === "app_mention";
  const isDirect = event.type === "message" && event.channel_type === "im";
  if (!isMention && !isDirect) return undefined;
  const user = asId(event.user);
  const channel = asId(event.channel);
  const ts = asTs(event.ts);
  if (user === undefined || channel === undefined || ts === undefined || typeof event.text !== "string") return undefined;
  const text = commandText(event.text);
  if (text.length === 0) return undefined;
  // A mention starts (or continues) a thread on the mentioning message; a DM threads only when the user did.
  const threadId = isMention ? (asTs(event.thread_ts) ?? ts) : asTs(event.thread_ts);
  return {
    connectionId,
    externalConversationId: `${teamId}:${channel}`,
    externalActorId: `${teamId}:${user}`,
    eventId,
    text,
    ...(threadId === undefined ? {} : { threadId }),
    receivedAt: new Date().toISOString(),
    claims: { platform: "slack", teamId, channelType: isDirect ? "im" : "channel", eventType: String(event.type) },
  };
}

/** Parse one `block_actions` payload whose value is a server-issued approval or host-UI control. */
export function parseSlackBlockActions(connectionId: string, body: unknown): ChannelInboundEvent | undefined {
  const payload = asRecord(body);
  if (payload?.type !== "block_actions") return undefined;
  const user = asRecord(payload.user);
  const container = asRecord(payload.container);
  const message = asRecord(payload.message);
  const action = Array.isArray(payload.actions) && payload.actions.length === 1 ? asRecord(payload.actions[0]) : undefined;
  const userId = asId(user?.id);
  const teamId = asId(asRecord(payload.team)?.id) ?? asId(user?.team_id);
  const channel = asId(asRecord(payload.channel)?.id) ?? asId(container?.channel_id);
  const messageTs = asTs(container?.message_ts);
  const actionTs = asTs(action?.action_ts);
  const value = typeof action?.value === "string" ? action.value : undefined;
  if (
    userId === undefined ||
    teamId === undefined ||
    channel === undefined ||
    messageTs === undefined ||
    actionTs === undefined ||
    value === undefined
  ) {
    return undefined;
  }
  const uiMatch = /^q:([A-Za-z0-9_-]{43}):([0-7])$/.exec(value);
  const match = /^p:([ad]):([A-Za-z0-9_-]{32,64})$/.exec(value);
  if (uiMatch === null && match === null) return undefined;
  const parent = asTs(container?.thread_ts) ?? asTs(message?.thread_ts);
  // A thread parent reports its own ts as `thread_ts`; only a reply belongs to a thread.
  const threadId = parent !== undefined && parent !== messageTs ? parent : undefined;
  return {
    connectionId,
    externalConversationId: `${teamId}:${channel}`,
    externalActorId: `${teamId}:${userId}`,
    eventId: `${messageTs}:${actionTs}:${userId}`,
    text: uiMatch ? `/answer ${uiMatch[1]} ${uiMatch[2]}` : "",
    ...(match
      ? { approval: { token: match[2] as string, outcome: match[1] === "a" ? ("allow_once" as const) : ("reject_once" as const) } }
      : {}),
    ...(threadId === undefined ? {} : { threadId }),
    receivedAt: new Date().toISOString(),
    claims: { platform: "slack", teamId, control: "approval" },
  };
}

function parsePayload(connectionId: string, body: unknown): ChannelInboundEvent | undefined {
  return parseSlackEventCallback(connectionId, body) ?? parseSlackBlockActions(connectionId, body);
}

function actionsBlock(controls: readonly ChannelReplyControl[] | undefined): Record<string, unknown> | null | undefined {
  if (controls === undefined) return undefined;
  if (controls.length === 0 || controls.length > 8) return null;
  const elements: Record<string, unknown>[] = [];
  for (const [index, control] of controls.entries()) {
    if (
      typeof control?.label !== "string" ||
      typeof control.value !== "string" ||
      control.label.length === 0 ||
      control.label.length > 75 ||
      control.value.length > 2000
    ) {
      return null;
    }
    elements.push({
      type: "button",
      action_id: `prism_${index}`,
      text: { type: "plain_text", text: control.label, emoji: false },
      value: control.value,
    });
  }
  return { type: "actions", elements };
}

function knownSendFailure(error: SlackApiError): string {
  if (error.status === 429 || error.error === "ratelimited") return "slack_rate_limited";
  if (error.kind === "credential" || ["invalid_auth", "not_authed", "token_revoked", "account_inactive"].includes(error.error ?? ""))
    return "slack_unauthorized";
  if (["not_in_channel", "channel_not_found", "is_archived", "restricted_action"].includes(error.error ?? "")) return "slack_forbidden";
  return "slack_api_error";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function readBody(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  const reader = body?.getReader();
  if (reader === undefined) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError("body too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

interface SlackApi {
  call(method: string, body: Record<string, unknown>, signal: AbortSignal, token?: ChannelSecretSource): Promise<Record<string, unknown>>;
}

function slackApi(options: {
  botToken: ChannelSecretSource;
  apiOrigin?: string;
  fetch?: typeof globalThis.fetch;
  maxResponseBytes: number;
}): SlackApi {
  const origin = apiOrigin(options.apiOrigin);
  const fetcher = options.fetch ?? globalThis.fetch;
  return {
    async call(method, body, signal, token = options.botToken) {
      let secret: string;
      try {
        secret = await token();
      } catch {
        throw new SlackApiError({ kind: "credential" });
      }
      if (!secret || Buffer.byteLength(secret, "utf8") > 1024) throw new SlackApiError({ kind: "credential" });
      let response: Response;
      try {
        response = await fetcher(`${origin}/api/${method}`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        });
      } catch {
        throw new SlackApiError({ kind: "network" });
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        await response.body?.cancel().catch(() => undefined);
        throw new SlackApiError({
          kind: "api",
          status: 429,
          retryAfter: Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, MAX_RETRY_AFTER_SECONDS) : 1,
        });
      }
      let payload: Record<string, unknown> | undefined;
      try {
        payload = asRecord(JSON.parse((await readBody(response.body, options.maxResponseBytes)).toString("utf8")));
      } catch {
        throw new SlackApiError({ kind: "response", status: response.status });
      }
      if (!response.ok || payload?.ok !== true) {
        const error = typeof payload?.error === "string" && /^[a-z_]{1,64}$/.test(payload.error) ? payload.error : undefined;
        throw new SlackApiError({ kind: "api", status: response.status, ...(error === undefined ? {} : { error }) });
      }
      return payload;
    },
  };
}

interface Preview {
  readonly channel: string;
  readonly threadTs?: string;
  ts?: string;
  text?: string;
  lastAt: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  closed: boolean;
}

function previewKey(conversationId: string, threadId: string | undefined): string {
  return `${conversationId}\u0000${threadId ?? ""}`;
}

/**
 * Creates the Slack adapter. `start` opens Socket Mode (it needs `appToken`); the Events API path is
 * `handleRequest`, which the host mounts. Neither path holds a receiver lease: Slack fans one event
 * to one acknowledged receiver, and the runtime deduplicates by event id.
 */
export function createSlackAdapter(options: SlackAdapterOptions): SlackAdapter {
  if (
    typeof options.connectionId !== "string" ||
    options.connectionId.length === 0 ||
    Buffer.byteLength(options.connectionId, "utf8") > 256
  ) {
    throw new TypeError("Slack connectionId must be a bounded non-empty string");
  }
  if (typeof options.botToken !== "function") throw new TypeError("Slack botToken must be a secret source, not a literal");
  if (options.appToken !== undefined && typeof options.appToken !== "function")
    throw new TypeError("Slack appToken must be a secret source, not a literal");
  const maxRequestBytes = boundedInteger(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 1024, "maxRequestBytes");
  const draftIntervalMs = boundedInteger(options.draftIntervalMs, DEFAULT_DRAFT_INTERVAL_MS, 100, "draftIntervalMs");
  const api = slackApi({
    botToken: options.botToken,
    apiOrigin: options.apiOrigin,
    fetch: options.fetch,
    maxResponseBytes: maxRequestBytes,
  });
  const openSocket = options.webSocket ?? ((url: string) => new WebSocket(url) as unknown as SlackSocket);
  const connectionId = options.connectionId;
  const sendDrafts = options.sendDrafts === true;
  const previews = new Map<string, Preview>();
  let controller: AbortController | undefined;
  let socket: SlackSocket | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let started = false;
  let stopped = false;

  function signal(): AbortSignal {
    return controller?.signal ?? new AbortController().signal;
  }

  /** Waits out `Retry-After` and retries a send Slack refused before accepting it. */
  async function postMessage(body: Record<string, unknown>, abort: AbortSignal): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await api.call("chat.postMessage", body, abort);
      } catch (error) {
        if (!(error instanceof SlackApiError) || error.retryAfter === undefined || attempt >= MAX_SEND_ATTEMPTS || abort.aborted)
          throw error;
        await delay(error.retryAfter * 1000, abort);
      }
    }
  }

  function schedulePreview(preview: Preview): void {
    if (preview.timer !== undefined || preview.inFlight !== undefined || preview.closed || preview.text === undefined) return;
    const wait = Math.max(0, preview.lastAt + draftIntervalMs - Date.now());
    preview.timer = setTimeout(() => {
      preview.timer = undefined;
      flushPreview(preview);
    }, wait);
  }

  function flushPreview(preview: Preview): void {
    const text = preview.text;
    if (preview.closed || stopped || text === undefined) return;
    preview.text = undefined;
    preview.lastAt = Date.now();
    preview.inFlight = (async () => {
      try {
        if (preview.ts === undefined) {
          const result = await api.call(
            "chat.postMessage",
            {
              channel: preview.channel,
              text,
              unfurl_links: false,
              unfurl_media: false,
              ...(preview.threadTs === undefined ? {} : { thread_ts: preview.threadTs }),
            },
            signal(),
          );
          preview.ts = asTs(result.ts);
        } else {
          await api.call("chat.update", { channel: preview.channel, ts: preview.ts, text }, signal());
        }
      } catch {
        // A preview is best effort: a refused or rate-limited write is dropped, never retried.
      }
    })().finally(() => {
      preview.inFlight = undefined;
      schedulePreview(preview);
    });
  }

  /** Stops one conversation's preview and deletes its message once the reply has landed. */
  async function closePreview(key: string): Promise<void> {
    const preview = previews.get(key);
    if (preview === undefined) return;
    previews.delete(key);
    preview.closed = true;
    if (preview.timer !== undefined) clearTimeout(preview.timer);
    await preview.inFlight;
    if (preview.ts === undefined) return;
    try {
      await api.call("chat.delete", { channel: preview.channel, ts: preview.ts }, signal());
    } catch {
      // Best effort: a preview that cannot be deleted stays as an earlier partial answer.
    }
  }

  async function dispatch(receive: ChannelReceive, body: unknown): Promise<"ack" | "retry"> {
    const event = parsePayload(connectionId, body);
    if (event === undefined) return "ack";
    return retryableAdmission(await receive(event)) ? "retry" : "ack";
  }

  async function onSocketFrame(current: SlackSocket, receive: ChannelReceive, data: unknown): Promise<void> {
    const raw =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
          ? Buffer.from(data as ArrayBuffer).toString("utf8")
          : undefined;
    if (raw === undefined || Buffer.byteLength(raw, "utf8") > maxRequestBytes) return;
    let frame: Record<string, unknown> | undefined;
    try {
      frame = asRecord(JSON.parse(raw));
    } catch {
      return;
    }
    if (frame?.type === "hello") {
      reconnectAttempts = 0;
      return;
    }
    if (frame?.type === "disconnect") {
      current.close(4000, "disconnect requested");
      return;
    }
    const envelopeId = typeof frame?.envelope_id === "string" && frame.envelope_id.length <= 128 ? frame.envelope_id : undefined;
    if (envelopeId === undefined) return;
    let outcome: "ack" | "retry" = "ack";
    try {
      if (frame?.type === "events_api" || frame?.type === "interactive") outcome = await dispatch(receive, frame.payload);
    } catch {
      outcome = "retry";
    }
    // An unacknowledged envelope is redelivered by Slack, so a retryable admission stays unacked.
    if (outcome === "ack" && !stopped) {
      try {
        current.send(JSON.stringify({ envelope_id: envelopeId }));
      } catch {
        // The socket closed under us; Slack redelivers the envelope on the next connection.
      }
    }
  }

  async function connectSocket(receive: ChannelReceive): Promise<void> {
    const appToken = options.appToken;
    if (appToken === undefined) throw new Error("Slack Socket Mode needs an appToken");
    let url: string;
    try {
      const opened = await api.call("apps.connections.open", {}, signal(), appToken);
      url = typeof opened.url === "string" ? opened.url : "";
    } catch {
      throw new Error("Slack Socket Mode connection failed");
    }
    if (!url.startsWith("wss://")) throw new Error("Slack Socket Mode connection failed");
    const current = openSocket(url);
    socket = current;
    let opened = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Slack Socket Mode connection failed"));
        if (!opened) current.close(4000, "open timeout");
      }, SOCKET_OPEN_TIMEOUT_MS);
      current.addEventListener("open", () => {
        clearTimeout(timer);
        opened = true;
        resolve();
      });
      current.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Slack Socket Mode connection failed"));
      });
      current.addEventListener("message", (event) => {
        void onSocketFrame(current, receive, event.data);
      });
      current.addEventListener("close", () => {
        clearTimeout(timer);
        reject(new Error("Slack Socket Mode connection failed"));
        if (socket === current) socket = undefined;
        // Only a connection that opened reconnects; a failed first `start` reports its error instead.
        if (opened && !stopped && socket === undefined) scheduleReconnect(receive);
      });
    });
  }

  function scheduleReconnect(receive: ChannelReceive): void {
    if (stopped || reconnectTimer !== undefined) return;
    const wait = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connectSocket(receive).catch(() => scheduleReconnect(receive));
    }, wait);
  }

  return {
    connectionId,
    capabilities: { acknowledgement: "deadline", controls: "callback", maxTextCodeUnits: SLACK_TEXT_CODE_UNITS },
    async start(receive) {
      if (stopped) throw new Error("Slack adapter is stopped");
      if (started) throw new Error("Slack adapter is already started");
      started = true;
      controller = new AbortController();
      try {
        await connectSocket(receive);
      } catch (error) {
        started = false;
        throw error;
      }
    },
    async send(reply) {
      const target = reply.connectionId === connectionId ? destination(reply.externalConversationId) : undefined;
      if (target === undefined) return { delivered: false, reason: "invalid_destination" };
      const threadTs = reply.threadId === undefined ? undefined : asTs(reply.threadId);
      if (reply.threadId !== undefined && threadTs === undefined) return { delivered: false, reason: "invalid_destination" };
      const actions = actionsBlock(reply.controls);
      if (actions === null) return { delivered: false, reason: "invalid_controls" };
      const chunks = chunkSlackText(reply.text, actions === undefined ? SLACK_TEXT_CODE_UNITS : SLACK_SECTION_CODE_UNITS);
      if (chunks.length === 0) return { delivered: false, reason: "empty_reply" };
      const abort = signal();
      let messageId: string | undefined;
      let sent = false;
      try {
        for (const [index, text] of chunks.entries()) {
          const last = index + 1 === chunks.length;
          const result = await postMessage(
            {
              channel: target.channel,
              text,
              unfurl_links: false,
              unfurl_media: false,
              ...(threadTs === undefined ? {} : { thread_ts: threadTs }),
              ...(last && actions !== undefined ? { blocks: [{ type: "section", text: { type: "mrkdwn", text } }, actions] } : {}),
            },
            abort,
          );
          messageId = asTs(result.ts) ?? messageId;
          sent = true;
        }
      } catch (error) {
        // A network error, or any failure after a chunk landed, cannot prove non-delivery.
        if (sent || !(error instanceof SlackApiError) || error.kind === "network" || error.kind === "response")
          throw new SlackDeliveryUnknownError();
        return { delivered: false, reason: knownSendFailure(error) };
      }
      await closePreview(previewKey(reply.externalConversationId, reply.threadId));
      return { delivered: true, ...(messageId === undefined ? {} : { messageId }) };
    },
    async stop() {
      stopped = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const current = socket;
      socket = undefined;
      try {
        current?.close(1000, "stopped");
      } catch {
        // Already closed.
      }
      for (const preview of previews.values()) {
        preview.closed = true;
        if (preview.timer !== undefined) clearTimeout(preview.timer);
      }
      previews.clear();
      controller?.abort(new Error("Slack adapter stopped"));
    },
    sendDraft(delta) {
      if (!sendDrafts || stopped || delta.connectionId !== connectionId) return;
      const target = destination(delta.externalConversationId);
      const threadTs = delta.threadId === undefined ? undefined : asTs(delta.threadId);
      if (target === undefined || (delta.threadId !== undefined && threadTs === undefined)) return;
      const text = draftText(delta.text);
      if (text.trim().length === 0) return;
      const key = previewKey(delta.externalConversationId, delta.threadId);
      let preview = previews.get(key);
      if (preview === undefined) {
        if (previews.size >= MAX_PREVIEWS) return;
        preview = { channel: target.channel, ...(threadTs === undefined ? {} : { threadTs }), lastAt: 0, closed: false };
        previews.set(key, preview);
      }
      preview.text = text;
      schedulePreview(preview);
    },
    async handleRequest(request, receive, signingSecret) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (signingSecret === undefined) return new Response("Unauthorized", { status: 401 });
      let raw: Buffer;
      try {
        raw = await readBody(request.body, maxRequestBytes);
      } catch (error) {
        return new Response(error instanceof RangeError ? "Payload too large" : "Malformed request", {
          status: error instanceof RangeError ? 413 : 400,
        });
      }
      // Verify before parsing anything: the signature covers the timestamp and the raw body.
      const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
      if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS) {
        return new Response("Unauthorized", { status: 401 });
      }
      let secret: string;
      try {
        secret = await signingSecret();
      } catch {
        return new Response("Unavailable", { status: 503 });
      }
      const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(raw).digest("hex")}`;
      if (!constantTimeEqual(expected, request.headers.get("x-slack-signature"))) return new Response("Unauthorized", { status: 401 });
      let body: unknown;
      try {
        const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType.startsWith("application/x-www-form-urlencoded")) {
          const payload = new URLSearchParams(raw.toString("utf8")).get("payload");
          body = payload === null ? undefined : JSON.parse(payload);
        } else if (contentType.startsWith("application/json")) {
          body = JSON.parse(raw.toString("utf8"));
        } else {
          return new Response("Unsupported media type", { status: 415 });
        }
      } catch {
        return new Response("Malformed request", { status: 400 });
      }
      const record = asRecord(body);
      if (record?.type === "url_verification") {
        const challenge = typeof record.challenge === "string" && record.challenge.length <= 256 ? record.challenge : undefined;
        return challenge === undefined ? new Response("Malformed request", { status: 400 }) : Response.json({ challenge });
      }
      try {
        return (await dispatch(receive, body)) === "retry"
          ? new Response("Unavailable", { status: 503 })
          : new Response(null, { status: 200 });
      } catch {
        return new Response("Unavailable", { status: 503 });
      }
    },
  };
}

export interface SlackConnectOptions {
  /** Bot token reference (`env:` or `keyring:`). A literal fails with `ChannelTokenLiteralError`. */
  readonly token: string;
  /** Signing secret reference for the Events API over HTTP (`handle(request)`). */
  readonly signingSecret?: string;
  /** App-level token reference for Socket Mode (`start()`). */
  readonly appToken?: string;
  /**
   * Maps a sender (`externalActorId` = `<team>:<user>`, `claims.teamId`) to a verified grant. Without it,
   * every event is denied: Slack never falls back to the runtime's open default.
   */
  readonly authorize: (
    input: ChannelAuthorizeInput,
  ) => ChannelAuthorization | false | undefined | Promise<ChannelAuthorization | false | undefined>;
  readonly connectionId?: string;
  readonly checkpoints?: CheckpointStore;
  readonly leases?: LeaseStore;
  readonly limits?: ChannelLimits;
  readonly sendDrafts?: boolean;
  readonly draftIntervalMs?: number;
  readonly maxRequestBytes?: number;
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: (url: string) => SlackSocket;
}

/** Binds one agent to a Slack app over the Events API, Socket Mode, or both. */
export async function connectSlack(agent: Agent, options: SlackConnectOptions): Promise<ChannelConnectionHandle> {
  if (options.signingSecret === undefined && options.appToken === undefined) {
    throw new TypeError("connectSlack needs signingSecret (Events API) or appToken (Socket Mode)");
  }
  const resolvedToken = await resolveChannelSecretRef(agent, options.token);
  const resolvedSigning = options.signingSecret === undefined ? undefined : await resolveChannelSecretRef(agent, options.signingSecret);
  const resolvedApp = options.appToken === undefined ? undefined : await resolveChannelSecretRef(agent, options.appToken);
  const secrets = [resolvedToken, resolvedSigning, resolvedApp].filter((value): value is string => value !== undefined);
  const redactor = createChannelRedactor(secrets, agent.config?.redactor);
  const connectionId = options.connectionId ?? "slack-default";
  const checkpoints = options.checkpoints ?? createMemoryCheckpointStore();
  const leases = options.leases ?? createMemoryLeaseStore();
  const signingSecret: ChannelSecretSource | undefined = resolvedSigning === undefined ? undefined : async () => resolvedSigning;

  const adapter = createSlackAdapter({
    connectionId,
    botToken: async () => resolvedToken,
    ...(resolvedApp === undefined ? {} : { appToken: async () => resolvedApp }),
    sendDrafts: options.sendDrafts,
    draftIntervalMs: options.draftIntervalMs,
    maxRequestBytes: options.maxRequestBytes,
    apiOrigin: options.apiOrigin,
    fetch: options.fetch,
    webSocket: options.webSocket,
  });
  const authorize = typeof options.authorize === "function" ? options.authorize : () => false as const;
  const runtime = createChannelRuntime(agent, {
    deliver: (reply) => adapter.send(reply),
    checkpoints,
    leases,
    redactor,
    authorize,
    limits: options.limits,
    onAssistantDelta: options.sendDrafts ? (delta) => adapter.sendDraft(delta) : undefined,
  });
  const receive: ChannelReceive = (event) => runtime.admit(event);

  const handle: ChannelConnectionHandle = {
    async handle(update: unknown): Promise<unknown> {
      if (update instanceof Request) return await adapter.handleRequest(update, receive, signingSecret);
      if (typeof update !== "object" || update === null) return undefined;
      if ("connectionId" in update && "externalActorId" in update && "eventId" in update)
        return await runtime.admit(update as ChannelInboundEvent);
      const event = parsePayload(connectionId, update);
      return event === undefined ? undefined : await runtime.admit(event);
    },
    async start() {
      if (resolvedApp !== undefined) await adapter.start(receive);
    },
    async close() {
      const stopping = runtime.stop();
      try {
        await adapter.stop();
      } finally {
        await stopping;
      }
    },
    async stop() {
      await handle.close();
    },
    async drain(opts) {
      return await runtime.drain(opts);
    },
  };
  bindChannelHostUi(handle, runtime, connectionId);
  return handle;
}
