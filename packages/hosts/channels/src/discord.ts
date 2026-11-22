// Plan 236 Task 5: native-fetch Discord adapter on the shared channel runtime. Importing and
// constructing are inert; the Gateway opens only in `start`, and the optional Interactions endpoint
// is host-mounted. Messages and component clicks feed one parser and await `admit`.
import { createPublicKey, type KeyObject, verify } from "node:crypto";
import type { Agent } from "@arnilo/prism";
import type { CheckpointStore, LeaseStore } from "./checkpoint-contract.js";
import { createDiscordGateway, DISCORD_GATEWAY_INTENTS, type DiscordGateway, type DiscordSocket } from "./discord-gateway.js";
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

export type { ChannelConnectionHandle, ChannelSecretSource, DiscordSocket };
export { DISCORD_GATEWAY_INTENTS };

const DEFAULT_API_ORIGIN = "https://discord.com";
const API_PATH = "/api/v10";
/** A message's `content` holds at most 2,000 characters. */
const DISCORD_TEXT_CODE_UNITS = 2_000;
/** Discord's replay window is not specified; signed interactions older than this are refused. */
const SIGNATURE_WINDOW_SECONDS = 300;
const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const MAX_SEND_ATTEMPTS = 5;
const MAX_RETRY_AFTER_SECONDS = 60;
const DEFAULT_DRAFT_INTERVAL_MS = 1_000;
const MAX_PREVIEWS = 256;
const MAX_CONTROLS = 8;
const BUTTONS_PER_ROW = 5;
/** `SUPPRESS_EMBEDS`: model text never unfurls links. */
const SUPPRESS_EMBEDS = 1 << 2;
const SNOWFLAKE = /^\d{1,20}$/;
/** No `..` segment, so a token can never walk the callback path. */
const INTERACTION_TOKEN = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_.-]{0,511}$/;
const MESSAGE_TYPES = new Set([0, 19]);
/** Commands the runtime understands; `!new` works where a client would open the slash-command picker. */
const BANG_COMMAND = /^!(help|status|new|cancel|approve|deny|answer)(?=\s|$)/i;
const INTERACTION_PING = 1;
const INTERACTION_COMPONENT = 3;
const CALLBACK_PONG = 1;
const CALLBACK_DEFERRED_UPDATE = 6;

export interface DiscordAdapterOptions {
  /** Stable host-selected connection id; it is never read from Discord input. */
  readonly connectionId: string;
  /** Bot token, resolved only for REST calls and the Gateway handshake; it never reaches events or errors. */
  readonly botToken: ChannelSecretSource;
  /** Application id; it is also the bot user id until READY reports one. */
  readonly applicationId: string;
  /** Admit messages from other bots and webhooks. The bot's own messages are always ignored. */
  readonly allowBots?: boolean;
  /** Opt-in preview message, edited at most once per `draftIntervalMs` and deleted after the reply. */
  readonly sendDrafts?: boolean;
  /** Minimum interval between preview writes (default 1,000 ms, 100–60,000). */
  readonly draftIntervalMs?: number;
  /** Bounds Interactions endpoint bodies and REST response bodies (default 128 KiB, hard 1 MiB). */
  readonly maxRequestBytes?: number;
  /** Bounds one Gateway frame (default 1 MiB, hard 8 MiB). */
  readonly maxFrameBytes?: number;
  /** Trusted exact HTTPS API origin; defaults to `https://discord.com`. */
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Socket factory for the Gateway; defaults to the global `WebSocket`. */
  readonly webSocket?: (url: string) => DiscordSocket;
  /** First Gateway reconnect delay (default 1,000 ms, doubling to 30 s). */
  readonly reconnectBaseMs?: number;
  /** Heartbeat jitter source in [0, 1); defaults to `Math.random`. */
  readonly random?: () => number;
}

/** Channel adapter with Discord's rate-bounded preview message and Interactions endpoint. */
export interface DiscordAdapter extends ChannelAdapter {
  /** Fire-and-forget preview of the answer being produced. No-op unless `sendDrafts` is on. */
  sendDraft(delta: ChannelAssistantDelta): void;
  /** One Gateway dispatch (`MESSAGE_CREATE`, `INTERACTION_CREATE`); the Gateway and scripted hosts call it. */
  handleDispatch(type: string, data: unknown, receive: ChannelReceive): Promise<unknown>;
  /** Verified Interactions endpoint. Without a public key it answers 401. */
  handleRequest(request: Request, receive: ChannelReceive, publicKey: KeyObject | undefined): Promise<Response>;
  /** The Gateway's view of the bot (`botUserId` falls back to `applicationId`). */
  gatewayState(): {
    readonly botUserId: string;
    readonly sessionId?: string;
    readonly sequence: number | null;
    readonly connected: boolean;
  };
}

class DiscordApiError extends Error {
  readonly status?: number;
  readonly retryAfter?: number;
  readonly kind: "api" | "credential" | "network" | "response";

  constructor(shape: { kind: DiscordApiError["kind"]; status?: number; retryAfter?: number }) {
    super("Discord API request failed");
    this.name = "DiscordApiError";
    this.kind = shape.kind;
    this.status = shape.status;
    this.retryAfter = shape.retryAfter;
  }
}

class DiscordDeliveryUnknownError extends Error {
  constructor() {
    super("Discord delivery outcome unknown");
    this.name = "DiscordDeliveryUnknownError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asSnowflake(value: unknown): string | undefined {
  return typeof value === "string" && SNOWFLAKE.test(value) ? value : undefined;
}

function apiOrigin(value: string | undefined): string {
  const raw = value ?? DEFAULT_API_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Discord apiOrigin must be an exact HTTPS origin");
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
    throw new TypeError("Discord apiOrigin must be an exact HTTPS origin");
  }
  return parsed.origin;
}

/** A host-set adapter limit, at least `min`. The host's value is the cap (plan 239 Task 5). */
function boundedInteger(value: number | undefined, fallback: number, min: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min) {
    throw new TypeError(`Discord ${name} must be an integer of at least ${min}`);
  }
  return resolved;
}

/** Split on code points so no chunk exceeds `limit` and no surrogate pair is split. */
export function chunkDiscordText(text: string, limit: number = DISCORD_TEXT_CODE_UNITS): readonly string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const codePoint of text) {
    if (chunk.length > 0 && chunk.length + codePoint.length > limit) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += codePoint;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function draftText(text: string): string {
  let start = Math.max(0, text.length - DISCORD_TEXT_CODE_UNITS);
  const code = text.charCodeAt(start);
  if (start > 0 && code >= 0xdc00 && code <= 0xdfff) start += 1;
  return text.slice(start);
}

/** `<guild>:<channel>` or `dm:<channel>`; a thread is its own channel. Only the adapter builds it. */
function destination(conversationId: string): string | undefined {
  const [scope, channel, extra] = conversationId.split(":");
  if (extra !== undefined || (scope !== "dm" && asSnowflake(scope) === undefined)) return undefined;
  return asSnowflake(channel);
}

function conversationOf(guildId: string | undefined, channelId: string): string {
  return `${guildId ?? "dm"}:${channelId}`;
}

function commandText(text: string): string {
  const trimmed = text.replace(/^(?:\s*<@!?\d{1,20}>)+\s*/, "").trim();
  return BANG_COMMAND.test(trimmed) ? `/${trimmed.slice(1)}` : trimmed;
}

function mentions(data: Record<string, unknown>, botUserId: string): boolean {
  if (Array.isArray(data.mentions) && data.mentions.some((user) => asRecord(user)?.id === botUserId)) return true;
  return typeof data.content === "string" && (data.content.includes(`<@${botUserId}>`) || data.content.includes(`<@!${botUserId}>`));
}

/**
 * Parse one `MESSAGE_CREATE`. Guild messages are admitted only when they mention the bot; DMs always.
 * The bot's own messages are always ignored, and other bots and webhooks unless `allowBots`.
 */
export function parseDiscordMessage(
  connectionId: string,
  data: unknown,
  options: { readonly botUserId: string; readonly allowBots?: boolean },
): ChannelInboundEvent | undefined {
  const message = asRecord(data);
  const author = asRecord(message?.author);
  if (message === undefined || author === undefined) return undefined;
  const id = asSnowflake(message.id);
  const channelId = asSnowflake(message.channel_id);
  const authorId = asSnowflake(author.id);
  if (id === undefined || channelId === undefined || authorId === undefined || typeof message.content !== "string") return undefined;
  if (authorId === options.botUserId) return undefined;
  if ((author.bot === true || author.system === true || message.webhook_id !== undefined) && options.allowBots !== true) return undefined;
  if (typeof message.type === "number" && !MESSAGE_TYPES.has(message.type)) return undefined;
  const guildId = message.guild_id === undefined ? undefined : asSnowflake(message.guild_id);
  if (message.guild_id !== undefined && guildId === undefined) return undefined;
  if (guildId !== undefined && !mentions(message, options.botUserId)) return undefined;
  const text = commandText(message.content);
  if (text.length === 0) return undefined;
  return {
    connectionId,
    externalConversationId: conversationOf(guildId, channelId),
    externalActorId: authorId,
    eventId: `m:${id}`,
    text,
    receivedAt: new Date().toISOString(),
    claims: {
      platform: "discord",
      ...(guildId === undefined ? {} : { guildId }),
      channelType: guildId === undefined ? "dm" : "guild",
      eventType: "message",
    },
  };
}

/** Parse one component interaction whose `custom_id` is a server-issued approval or host-UI control. */
export function parseDiscordInteraction(
  connectionId: string,
  data: unknown,
): { readonly event?: ChannelInboundEvent; readonly id: string; readonly token: string } | undefined {
  const interaction = asRecord(data);
  const id = asSnowflake(interaction?.id);
  const token = typeof interaction?.token === "string" && INTERACTION_TOKEN.test(interaction.token) ? interaction.token : undefined;
  if (interaction === undefined || id === undefined || token === undefined || interaction.type !== INTERACTION_COMPONENT) return undefined;
  const ack = { id, token };
  const component = asRecord(interaction.data);
  const user = asRecord(asRecord(interaction.member)?.user) ?? asRecord(interaction.user);
  const userId = asSnowflake(user?.id);
  const channelId = asSnowflake(interaction.channel_id) ?? asSnowflake(asRecord(interaction.channel)?.id);
  const guildId = interaction.guild_id === undefined ? undefined : asSnowflake(interaction.guild_id);
  const value = component?.component_type === 2 && typeof component.custom_id === "string" ? component.custom_id : undefined;
  if (
    userId === undefined ||
    channelId === undefined ||
    value === undefined ||
    (interaction.guild_id !== undefined && guildId === undefined)
  )
    return ack;
  const uiMatch = /^q:([A-Za-z0-9_-]{43}):([0-7])$/.exec(value);
  const match = /^p:([ad]):([A-Za-z0-9_-]{32,64})$/.exec(value);
  if (uiMatch === null && match === null) return ack;
  return {
    ...ack,
    event: {
      connectionId,
      externalConversationId: conversationOf(guildId, channelId),
      externalActorId: userId,
      eventId: `i:${id}`,
      text: uiMatch ? `/answer ${uiMatch[1]} ${uiMatch[2]}` : "",
      ...(match
        ? { approval: { token: match[2] as string, outcome: match[1] === "a" ? ("allow_once" as const) : ("reject_once" as const) } }
        : {}),
      receivedAt: new Date().toISOString(),
      claims: {
        platform: "discord",
        ...(guildId === undefined ? {} : { guildId }),
        channelType: guildId === undefined ? "dm" : "guild",
        control: "approval",
      },
    },
  };
}

function actionRows(controls: readonly ChannelReplyControl[] | undefined): Record<string, unknown>[] | null | undefined {
  if (controls === undefined) return undefined;
  if (controls.length === 0 || controls.length > MAX_CONTROLS) return null;
  const rows: Array<{ type: 1; components: Record<string, unknown>[] }> = [];
  for (const [index, control] of controls.entries()) {
    if (
      typeof control?.label !== "string" ||
      typeof control.value !== "string" ||
      control.label.length === 0 ||
      control.label.length > 80 ||
      control.value.length > 100
    ) {
      return null;
    }
    if (index % BUTTONS_PER_ROW === 0) rows.push({ type: 1, components: [] });
    rows[rows.length - 1]?.components.push({ type: 2, style: index === 0 ? 1 : 2, label: control.label, custom_id: control.value });
  }
  return rows;
}

function knownSendFailure(error: DiscordApiError): string {
  if (error.status === 429) return "discord_rate_limited";
  if (error.kind === "credential" || error.status === 401) return "discord_unauthorized";
  if (error.status === 403 || error.status === 404) return "discord_forbidden";
  return "discord_api_error";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
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

function seconds(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, MAX_RETRY_AFTER_SECONDS) : undefined;
}

interface DiscordApi {
  call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal,
    options?: { readonly auth?: boolean },
  ): Promise<Record<string, unknown>>;
}

/** Route key for bucket tracking: major parameters (channel id) stay, message ids collapse. */
function routeKey(method: string, path: string): string {
  if (path.startsWith("/interactions/")) return `${method} /interactions`;
  return `${method} ${path.replace(/\/messages\/\d+/, "/messages/:id")}`;
}

/**
 * REST client that honors Discord's per-route buckets: an exhausted bucket (`X-RateLimit-Remaining: 0`)
 * blocks its route until `X-RateLimit-Reset-After`, and a 429 blocks its route (or every route when
 * `global`) for `retry_after` seconds before the caller retries.
 */
function discordApi(options: {
  botToken: ChannelSecretSource;
  apiOrigin?: string;
  fetch?: typeof globalThis.fetch;
  maxResponseBytes: number;
}): DiscordApi {
  const origin = apiOrigin(options.apiOrigin);
  const fetcher = options.fetch ?? globalThis.fetch;
  const routes = new Map<string, string>();
  const blockedUntil = new Map<string, number>();
  let globalUntil = 0;

  function block(key: string, until: number): void {
    if (blockedUntil.size >= 1024 && !blockedUntil.has(key)) blockedUntil.clear();
    blockedUntil.set(key, Math.max(until, blockedUntil.get(key) ?? 0));
  }

  return {
    async call(method, path, body, signal, callOptions = {}) {
      const route = routeKey(method, path);
      const bucketOf = () => routes.get(route) ?? route;
      await delay(Math.max(globalUntil, blockedUntil.get(bucketOf()) ?? 0) - Date.now(), signal);
      const headers: Record<string, string> = {};
      if (callOptions.auth !== false) {
        let secret: string;
        try {
          secret = await options.botToken();
        } catch {
          throw new DiscordApiError({ kind: "credential" });
        }
        if (!secret || Buffer.byteLength(secret, "utf8") > 1024) throw new DiscordApiError({ kind: "credential" });
        headers.authorization = `Bot ${secret}`;
      }
      if (body !== undefined) headers["content-type"] = "application/json";
      let response: Response;
      try {
        response = await fetcher(`${origin}${API_PATH}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal,
        });
      } catch {
        throw new DiscordApiError({ kind: "network" });
      }
      const bucket = response.headers.get("x-ratelimit-bucket");
      if (bucket !== null && /^[A-Za-z0-9_-]{1,128}$/.test(bucket)) {
        if (routes.size >= 1024 && !routes.has(route)) routes.clear();
        routes.set(route, bucket);
      }
      const resetAfter = seconds(response.headers.get("x-ratelimit-reset-after"));
      if (response.headers.get("x-ratelimit-remaining") === "0" && resetAfter !== undefined)
        block(bucketOf(), Date.now() + resetAfter * 1000);
      let payload: Record<string, unknown> | undefined;
      let parsed = true;
      try {
        const raw = await readBody(response.body, options.maxResponseBytes);
        payload = raw.length === 0 ? {} : asRecord(JSON.parse(raw.toString("utf8")));
      } catch {
        parsed = false;
      }
      if (response.status === 429) {
        const retryAfter = seconds(payload?.retry_after) ?? seconds(response.headers.get("retry-after")) ?? 1;
        if (payload?.global === true || response.headers.get("x-ratelimit-global") === "true") globalUntil = Date.now() + retryAfter * 1000;
        else block(bucketOf(), Date.now() + retryAfter * 1000);
        throw new DiscordApiError({ kind: "api", status: 429, retryAfter });
      }
      if (!parsed || payload === undefined) throw new DiscordApiError({ kind: "response", status: response.status });
      if (!response.ok) throw new DiscordApiError({ kind: response.status >= 500 ? "response" : "api", status: response.status });
      return payload;
    },
  };
}

interface Preview {
  readonly channel: string;
  messageId?: string;
  text?: string;
  lastAt: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  closed: boolean;
}

/**
 * Creates the Discord adapter. `start` opens the Gateway (messages, and component interactions while no
 * Interactions endpoint is configured); `handleRequest` is the optional Interactions endpoint. Neither
 * holds a receiver lease: the runtime deduplicates by message and interaction id.
 */
export function createDiscordAdapter(options: DiscordAdapterOptions): DiscordAdapter {
  if (
    typeof options.connectionId !== "string" ||
    options.connectionId.length === 0 ||
    Buffer.byteLength(options.connectionId, "utf8") > 256
  ) {
    throw new TypeError("Discord connectionId must be a bounded non-empty string");
  }
  if (typeof options.botToken !== "function") throw new TypeError("Discord botToken must be a secret source, not a literal");
  const applicationId = asSnowflake(options.applicationId);
  if (applicationId === undefined) throw new TypeError("Discord applicationId must be a snowflake");
  const maxRequestBytes = boundedInteger(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, 1024, "maxRequestBytes");
  const maxFrameBytes = boundedInteger(options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES, 4096, "maxFrameBytes");
  const draftIntervalMs = boundedInteger(options.draftIntervalMs, DEFAULT_DRAFT_INTERVAL_MS, 100, "draftIntervalMs");
  const reconnectBaseMs = boundedInteger(options.reconnectBaseMs, 1_000, 1, "reconnectBaseMs");
  const api = discordApi({
    botToken: options.botToken,
    apiOrigin: options.apiOrigin,
    fetch: options.fetch,
    maxResponseBytes: maxRequestBytes,
  });
  const openSocket = options.webSocket ?? ((url: string) => new WebSocket(url) as unknown as DiscordSocket);
  const connectionId = options.connectionId;
  const sendDrafts = options.sendDrafts === true;
  const previews = new Map<string, Preview>();
  let controller: AbortController | undefined;
  let gateway: DiscordGateway | undefined;
  let started = false;
  let stopped = false;

  function signal(): AbortSignal {
    return controller?.signal ?? new AbortController().signal;
  }

  function botUserId(): string {
    return gateway?.state().botUserId ?? (applicationId as string);
  }

  /** Waits out a 429's `retry_after` and retries a send Discord refused before accepting it. */
  async function createMessage(channel: string, body: Record<string, unknown>, abort: AbortSignal): Promise<Record<string, unknown>> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await api.call("POST", `/channels/${channel}/messages`, body, abort);
      } catch (error) {
        if (!(error instanceof DiscordApiError) || error.status !== 429 || attempt >= MAX_SEND_ATTEMPTS || abort.aborted) throw error;
        // The bucket now blocks this route for `retry_after`; the next call waits for it.
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
        if (preview.messageId === undefined) {
          const result = await api.call(
            "POST",
            `/channels/${preview.channel}/messages`,
            { content: text, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS },
            signal(),
          );
          preview.messageId = asSnowflake(result.id);
        } else {
          await api.call(
            "PATCH",
            `/channels/${preview.channel}/messages/${preview.messageId}`,
            { content: text, allowed_mentions: { parse: [] } },
            signal(),
          );
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
    if (preview.messageId === undefined) return;
    try {
      await api.call("DELETE", `/channels/${preview.channel}/messages/${preview.messageId}`, undefined, signal());
    } catch {
      // Best effort: a preview that cannot be deleted stays as an earlier partial answer.
    }
  }

  async function acknowledge(id: string, token: string): Promise<void> {
    try {
      await api.call(
        "POST",
        `/interactions/${id}/${token}/callback`,
        { type: CALLBACK_DEFERRED_UPDATE },
        AbortSignal.any([signal(), AbortSignal.timeout(3_000)]),
        {
          auth: false,
        },
      );
    } catch {
      // A missed acknowledgement shows "interaction failed" to the user; the click itself was admitted.
    }
  }

  async function handleDispatch(type: string, data: unknown, receive: ChannelReceive): Promise<unknown> {
    if (type === "MESSAGE_CREATE") {
      const event = parseDiscordMessage(connectionId, data, { botUserId: botUserId(), allowBots: options.allowBots });
      return event === undefined ? undefined : await receive(event);
    }
    if (type === "INTERACTION_CREATE") {
      const parsed = parseDiscordInteraction(connectionId, data);
      if (parsed === undefined) return undefined;
      // The 3-second deadline runs alongside admission, which settles before the run starts.
      const [admission] = await Promise.all([
        parsed.event === undefined ? undefined : receive(parsed.event),
        acknowledge(parsed.id, parsed.token),
      ]);
      return admission;
    }
    return undefined;
  }

  return {
    connectionId,
    capabilities: { acknowledgement: "deadline", controls: "callback", maxTextCodeUnits: DISCORD_TEXT_CODE_UNITS },
    async start(receive) {
      if (stopped) throw new Error("Discord adapter is stopped");
      if (started) throw new Error("Discord adapter is already started");
      started = true;
      controller = new AbortController();
      gateway = createDiscordGateway({
        token: options.botToken,
        intents: DISCORD_GATEWAY_INTENTS,
        gatewayUrl: async () => {
          const result = await api.call("GET", "/gateway/bot", undefined, signal());
          if (typeof result.url !== "string") throw new Error("Discord Gateway URL missing");
          return result.url;
        },
        webSocket: openSocket,
        onDispatch: (type, data) => handleDispatch(type, data, receive),
        maxFrameBytes,
        reconnectBaseMs,
        ...(options.random === undefined ? {} : { random: options.random }),
      });
      try {
        await gateway.start();
      } catch (error) {
        started = false;
        gateway = undefined;
        throw error;
      }
    },
    async send(reply) {
      const channel =
        reply.connectionId === connectionId && reply.threadId === undefined ? destination(reply.externalConversationId) : undefined;
      if (channel === undefined) return { delivered: false, reason: "invalid_destination" };
      const components = actionRows(reply.controls);
      if (components === null) return { delivered: false, reason: "invalid_controls" };
      const chunks = chunkDiscordText(reply.text);
      if (chunks.length === 0) return { delivered: false, reason: "empty_reply" };
      const abort = signal();
      let messageId: string | undefined;
      let sent = false;
      try {
        for (const [index, content] of chunks.entries()) {
          const last = index + 1 === chunks.length;
          const result = await createMessage(
            channel,
            {
              content,
              allowed_mentions: { parse: [] },
              flags: SUPPRESS_EMBEDS,
              ...(last && components !== undefined ? { components } : {}),
            },
            abort,
          );
          messageId = asSnowflake(result.id) ?? messageId;
          sent = true;
        }
      } catch (error) {
        // A network or server error, or any failure after a chunk landed, cannot prove non-delivery.
        if (sent || !(error instanceof DiscordApiError) || error.kind === "network" || error.kind === "response")
          throw new DiscordDeliveryUnknownError();
        return { delivered: false, reason: knownSendFailure(error) };
      }
      await closePreview(reply.externalConversationId);
      return { delivered: true, ...(messageId === undefined ? {} : { messageId }) };
    },
    async stop() {
      stopped = true;
      gateway?.stop();
      for (const preview of previews.values()) {
        preview.closed = true;
        if (preview.timer !== undefined) clearTimeout(preview.timer);
      }
      previews.clear();
      controller?.abort(new Error("Discord adapter stopped"));
    },
    sendDraft(delta) {
      if (!sendDrafts || stopped || delta.connectionId !== connectionId || delta.threadId !== undefined) return;
      const channel = destination(delta.externalConversationId);
      if (channel === undefined) return;
      const text = draftText(delta.text);
      if (text.trim().length === 0) return;
      let preview = previews.get(delta.externalConversationId);
      if (preview === undefined) {
        if (previews.size >= MAX_PREVIEWS) return;
        preview = { channel, lastAt: 0, closed: false };
        previews.set(delta.externalConversationId, preview);
      }
      preview.text = text;
      schedulePreview(preview);
    },
    handleDispatch,
    async handleRequest(request, receive, publicKey) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      if (publicKey === undefined) return new Response("Unauthorized", { status: 401 });
      let raw: Buffer;
      try {
        raw = await readBody(request.body, maxRequestBytes);
      } catch (error) {
        return new Response(error instanceof RangeError ? "Payload too large" : "Malformed request", {
          status: error instanceof RangeError ? 413 : 400,
        });
      }
      // Verify before parsing anything: the signature covers the timestamp and the raw body.
      const timestamp = request.headers.get("x-signature-timestamp") ?? "";
      const signatureHex = request.headers.get("x-signature-ed25519") ?? "";
      if (
        !/^\d{1,12}$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_SECONDS ||
        !/^[0-9a-f]{128}$/i.test(signatureHex)
      ) {
        return new Response("Unauthorized", { status: 401 });
      }
      let valid = false;
      try {
        valid = verify(null, Buffer.concat([Buffer.from(timestamp, "utf8"), raw]), publicKey, Buffer.from(signatureHex, "hex"));
      } catch {
        valid = false;
      }
      if (!valid) return new Response("Unauthorized", { status: 401 });
      let body: Record<string, unknown> | undefined;
      try {
        body = asRecord(JSON.parse(raw.toString("utf8")));
      } catch {
        return new Response("Malformed request", { status: 400 });
      }
      if (body?.type === INTERACTION_PING) return Response.json({ type: CALLBACK_PONG });
      const parsed = parseDiscordInteraction(connectionId, body);
      if (parsed === undefined) return new Response("Unsupported interaction", { status: 400 });
      try {
        if (parsed.event !== undefined && retryableAdmission(await receive(parsed.event)))
          return new Response("Unavailable", { status: 503 });
      } catch {
        return new Response("Unavailable", { status: 503 });
      }
      // The HTTP response is the acknowledgement: no follow-up callback is sent.
      return Response.json({ type: CALLBACK_DEFERRED_UPDATE });
    },
    gatewayState() {
      const state = gateway?.state();
      return {
        botUserId: botUserId(),
        ...(state?.sessionId === undefined ? {} : { sessionId: state.sessionId }),
        sequence: state?.sequence ?? null,
        connected: state?.connected ?? false,
      };
    },
  };
}

/** Parses a hex Ed25519 application public key (it is public, not a secret). */
function parsePublicKey(hex: string): KeyObject {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new TypeError("Discord publicKey must be the application's 64-character hex Ed25519 key");
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(hex, "hex").toString("base64url") }, format: "jwk" });
}

export interface DiscordConnectOptions {
  /** Bot token reference (`env:` or `keyring:`). A literal fails with `ChannelTokenLiteralError`. */
  readonly token: string;
  /** The application id (a snowflake); the bot user id until READY reports one. */
  readonly applicationId: string;
  /**
   * Application public key (hex, or an `env:`/`keyring:` ref) for the Interactions endpoint. Needed only
   * when the host sets an Interactions Endpoint URL and mounts `handle(request)`; otherwise component
   * clicks arrive over the Gateway.
   */
  readonly publicKey?: string;
  /**
   * Maps a sender (`externalActorId` = the Discord user id, `claims.guildId`) to a verified grant.
   * Without it, every event is denied: Discord never falls back to the runtime's open default.
   */
  readonly authorize: (
    input: ChannelAuthorizeInput,
  ) => ChannelAuthorization | false | undefined | Promise<ChannelAuthorization | false | undefined>;
  /** Admit messages from other bots and webhooks (default false). */
  readonly allowBots?: boolean;
  readonly connectionId?: string;
  readonly checkpoints?: CheckpointStore;
  readonly leases?: LeaseStore;
  readonly limits?: ChannelLimits;
  readonly sendDrafts?: boolean;
  readonly draftIntervalMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxFrameBytes?: number;
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: (url: string) => DiscordSocket;
  readonly reconnectBaseMs?: number;
  readonly random?: () => number;
}

/** Binds one agent to a Discord application over the Gateway, with an optional Interactions endpoint. */
export async function connectDiscord(agent: Agent, options: DiscordConnectOptions): Promise<ChannelConnectionHandle> {
  const resolvedToken = await resolveChannelSecretRef(agent, options.token);
  const publicKeyText =
    options.publicKey === undefined
      ? undefined
      : /^(env|keyring):/.test(options.publicKey)
        ? await resolveChannelSecretRef(agent, options.publicKey)
        : options.publicKey;
  const publicKey = publicKeyText === undefined ? undefined : parsePublicKey(publicKeyText);
  const redactor = createChannelRedactor([resolvedToken], agent.config?.redactor);
  const connectionId = options.connectionId ?? "discord-default";
  const checkpoints = options.checkpoints ?? createMemoryCheckpointStore();
  const leases = options.leases ?? createMemoryLeaseStore();

  const adapter = createDiscordAdapter({
    connectionId,
    botToken: async () => resolvedToken,
    applicationId: options.applicationId,
    allowBots: options.allowBots,
    sendDrafts: options.sendDrafts,
    draftIntervalMs: options.draftIntervalMs,
    maxRequestBytes: options.maxRequestBytes,
    maxFrameBytes: options.maxFrameBytes,
    apiOrigin: options.apiOrigin,
    fetch: options.fetch,
    webSocket: options.webSocket,
    reconnectBaseMs: options.reconnectBaseMs,
    random: options.random,
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
      if (update instanceof Request) return await adapter.handleRequest(update, receive, publicKey);
      const record = asRecord(update);
      if (record === undefined) return undefined;
      if ("connectionId" in record && "externalActorId" in record && "eventId" in record)
        return await runtime.admit(record as unknown as ChannelInboundEvent);
      // A scripted Gateway dispatch: `{ t: "MESSAGE_CREATE" | "INTERACTION_CREATE", d }`.
      return typeof record.t === "string" ? await adapter.handleDispatch(record.t, record.d, receive) : undefined;
    },
    async start() {
      await adapter.start(receive);
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
