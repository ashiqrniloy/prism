// Plan 079 Task 5: native-fetch Telegram Bot API adapter. Importing and constructing are inert;
// `start` is the only polling lifecycle entry point and the webhook handler is host-mounted.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type CheckpointStore,
  type CredentialValueSource,
  type LeaseRecord,
  type LeaseStore,
  type OwnershipScope,
  resolveCredentialValue,
} from "@arnilo/prism";
import { retryableAdmission } from "./admission.js";
import { DEFAULT_CHANNEL_LIMITS, HARD_CHANNEL_LIMITS } from "./limits.js";
import { createChannelStateStore } from "./state.js";
import type {
  ChannelAdapter,
  ChannelAssistantDelta,
  ChannelAttachmentBytes,
  ChannelAttachmentRef,
  ChannelInboundEvent,
  ChannelReceive,
  ChannelReply,
  ChannelReplyControl,
} from "./types.js";

const DEFAULT_API_ORIGIN = "https://api.telegram.org";
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_LIMIT = 100;
const DEFAULT_LEASE_TTL_MS = 90_000;
const DEFAULT_MAX_REQUEST_BYTES = 128 * 1024;
const HARD_MAX_REQUEST_BYTES = 1024 * 1024;
const TELEGRAM_TEXT_CODE_UNITS = 3500;
const MAX_SEND_ATTEMPTS = 5;
/** One preview slot per chat: repeated updates with the same id replace that draft; a new id would create a second one. */
const DRAFT_ID = 1;
const RECEIVER_LEASE_NAMESPACE = "prism.channels.v1.telegram.receiver";
const RECEIVER_LEASE_KEY_PREFIX = "r1:";
/** One event references at most this many attachments (a photo album collapses to its largest size). */
const MAX_ATTACHMENT_REFS = 8;
const MAX_ATTACHMENT_META_BYTES = 256;
/** Bot API `sendVoice` accepts OGG/OPUS, MP3 and M4A; anything else stays text-only. */
const VOICE_FORMATS: ReadonlyMap<string, string> = new Map([
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
]);

export interface TelegramAdapterOptions {
  /** Stable host-selected connection id; it is never read from Telegram input. */
  readonly connectionId: string;
  /** Resolved only immediately before a Bot API request; the adapter never reads environment variables. */
  readonly botToken: CredentialValueSource;
  /** Durable service-owned polling cursor. Required: memory-only polling is not restart-safe. */
  readonly checkpoints: CheckpointStore;
  /** One receiver per connection. Required to fence concurrent pollers and webhook workers. */
  readonly leases: LeaseStore;
  /** Service ownership for the connection cursor/receiver lease, separate from user bindings. */
  readonly cursorOwnership: OwnershipScope;
  /**
   * Opt-in text admission from `group`/`supergroup` chats (forum topics keep their topic id as
   * `threadId`). Defaults to `false`, so only private text DMs are parsed. Host `authorize`
   * remains the only admission gate and is still deny-by-default per chat/thread/sender.
   */
  readonly allowGroups?: boolean;
  /**
   * Opt-in ephemeral previews of the answer being produced (Bot API `sendMessageDraft`), sent by
   * `TelegramAdapter.sendDraft`. Defaults to `false`, so nothing streams unless the host also wires
   * `MessagingRuntimeOptions.onAssistantDelta` to `sendDraft`. Previews are never journaled, never
   * carry controls, and are skipped for group chats (Bot API drafts are private-chat only).
   */
  readonly sendDrafts?: boolean;
  /**
   * Per-attachment byte ceiling for one `getFile` download (default 1 MiB, hard 4 MiB). Oversize
   * fails closed before the body is buffered; bytes are never journaled, logged or written to disk.
   */
  readonly maxAttachmentBytes?: number;
  /**
   * Host-wrapped `TranscriptionProvider.transcribe` for inbound voice notes. Only the current
   * event's file id is fetched (bounded by `maxAttachmentBytes`), the transcript becomes ordinary
   * turn text, and the audio is discarded. Without it a voice-only message is unsupported.
   */
  readonly transcribe?: (audio: Uint8Array, format: string | undefined, signal?: AbortSignal) => Promise<string>;
  /**
   * Host-wrapped `SpeechProvider` synthesis for outbound text. Runs only for `final` replies and
   * only alongside the text message (a voice failure never fails the reply). The destination is
   * always the bound chat/thread; a caller can never select a `file_id` or URL.
   */
  readonly synthesize?: (text: string, signal?: AbortSignal) => Promise<{ readonly audio: Uint8Array; readonly format: string }>;
  /**
   * Host-wrapped document-text extraction for inbound documents. Only with it does a document
   * become turn text; documents are never silently dumped into the model context.
   */
  readonly extractDocumentText?: (bytes: Uint8Array, mimeType: string | undefined, signal?: AbortSignal) => Promise<string>;
  /** Trusted exact HTTPS Bot API origin; defaults to the official API. */
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly pollTimeoutSeconds?: number;
  readonly pollLimit?: number;
  readonly leaseTtlMs?: number;
  /** Bounds webhook/admin response bodies read by the adapter. */
  readonly maxResponseBytes?: number;
}

export interface TelegramWebhookHandlerOptions {
  readonly connectionId: string;
  readonly botToken: CredentialValueSource;
  readonly webhookSecret: string;
  readonly admit: ChannelReceive;
  readonly leases: LeaseStore;
  readonly cursorOwnership: OwnershipScope;
  /** Same contract as `TelegramAdapterOptions.allowGroups`; parsed updates match the poller exactly. */
  readonly allowGroups?: boolean;
  /** Same contract as `TelegramAdapterOptions.maxAttachmentBytes`. */
  readonly maxAttachmentBytes?: number;
  /** Same contract as `TelegramAdapterOptions.transcribe`; inbound voice text is resolved before `admit`. */
  readonly transcribe?: (audio: Uint8Array, format: string | undefined, signal?: AbortSignal) => Promise<string>;
  /** Same contract as `TelegramAdapterOptions.extractDocumentText`. */
  readonly extractDocumentText?: (bytes: Uint8Array, mimeType: string | undefined, signal?: AbortSignal) => Promise<string>;
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly leaseTtlMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
}

/** A separately mountable Web-standard Telegram webhook handler. */
export type TelegramWebhookHandler = (request: Request) => Promise<Response>;

/** Channel adapter with Telegram's ephemeral draft preview (Bot API `sendMessageDraft`). */
export interface TelegramAdapter extends ChannelAdapter {
  /**
   * Fire-and-forget preview of the answer being produced for one bound conversation. No-op unless
   * `sendDrafts` is enabled, the delta names this connection, and the chat is private. Previews are
   * coalesced (one request in flight, latest text wins), capped to the tail of the outbound budget,
   * and silently dropped on failure — the terminal `send` is unaffected.
   */
  sendDraft(delta: ChannelAssistantDelta): void;
  /**
   * Bounded bytes for one inbound attachment ref (Bot API `getFile` + file download), or `undefined`
   * when the ref is malformed, oversize, unavailable, or the adapter is stopped. Wire it as
   * `MessagingRuntimeOptions.fetchAttachment` so a model that declares `image` input can receive the
   * image; the runtime only ever passes refs of the event it is running, never model output.
   */
  fetchAttachment(ref: ChannelAttachmentRef): Promise<ChannelAttachmentBytes | undefined>;
}

interface TelegramApiErrorShape {
  readonly status?: number;
  readonly retryAfter?: number;
  readonly kind: "api" | "credential" | "network" | "response";
}

class TelegramApiError extends Error {
  readonly status?: number;
  readonly retryAfter?: number;
  readonly kind: TelegramApiErrorShape["kind"];

  constructor(shape: TelegramApiErrorShape) {
    super("Telegram API request failed");
    this.name = "TelegramApiError";
    this.status = shape.status;
    this.retryAfter = shape.retryAfter;
    this.kind = shape.kind;
  }
}

class TelegramDeliveryUnknownError extends Error {
  constructor() {
    super("Telegram delivery outcome unknown");
    this.name = "TelegramDeliveryUnknownError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Telegram `chat.id` is a signed int64: group/supergroup ids are negative, user ids are not. */
function asChatId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128) return value;
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : undefined;
}

function apiOrigin(value: string | undefined): string {
  const raw = value ?? DEFAULT_API_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError("Telegram apiOrigin must be an exact HTTPS origin");
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
    throw new TypeError("Telegram apiOrigin must be an exact HTTPS origin");
  }
  return parsed.origin;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`Telegram ${name} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function scope(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function receiverKey(connectionId: string): string {
  return `${RECEIVER_LEASE_KEY_PREFIX}${connectionId}`;
}

function constantTimeEqual(expected: string, actual: string | null): boolean {
  if (actual === null) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(actual).digest();
  return timingSafeEqual(expectedHash, actualHash);
}

function validWebhookSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function chunkText(text: string): readonly string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  let chunk = "";
  for (const codePoint of text) {
    if (chunk.length > 0 && chunk.length + codePoint.length > TELEGRAM_TEXT_CODE_UNITS) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += codePoint;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** A draft is one ephemeral preview: the newest part of the text, capped to the outbound budget. */
function draftText(text: string): string {
  if (text.length <= TELEGRAM_TEXT_CODE_UNITS) return text;
  let start = text.length - TELEGRAM_TEXT_CODE_UNITS;
  // Never start on a low surrogate: that would split a pair and render as a replacement character.
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start += 1;
  return text.slice(start);
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new TelegramApiError({ kind: "response" });
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new TelegramApiError({ kind: "response" });
  }
}

async function readRequestJson(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new TypeError("missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError("request too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function retryAfter(payload: Record<string, unknown>): number | undefined {
  const parameters = asRecord(payload.parameters);
  const seconds = parameters === undefined ? undefined : asPositiveInteger(parameters.retry_after);
  return seconds;
}

function updateId(update: Record<string, unknown>): number | undefined {
  const value = update.update_id;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Bounded binary read; `RangeError` marks an oversize body before it is fully buffered. */
async function readBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new RangeError("missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RangeError("attachment exceeds maxAttachmentBytes");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** Telegram `file_path` values are relative `segments/file_name`; anything else is refused. */
function safeFilePath(value: string): boolean {
  if (value.length === 0 || Buffer.byteLength(value, "utf8") > 256) return false;
  const segments = value.split("/");
  if (segments.length > 4) return false;
  return segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..");
}

function boundedMeta(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_ATTACHMENT_META_BYTES ? value : undefined;
}

type TelegramChatKind = "private" | "group" | "supergroup";

function chatKind(chat: Record<string, unknown> | undefined): TelegramChatKind | undefined {
  const type = chat?.type;
  return type === "private" || type === "group" || type === "supergroup" ? type : undefined;
}

/** Group text is opt-in; `sender_chat` (channel/anonymous admin) is rejected before this is used. */
function admittedChatKind(chat: Record<string, unknown> | undefined, allowGroups: boolean): TelegramChatKind | undefined {
  const kind = chatKind(chat);
  if (kind === undefined || (kind !== "private" && !allowGroups)) return undefined;
  return kind;
}

/** Forum topics and group reply threads are isolated by `message_thread_id`; it is never model-selected. */
function messageThreadId(message: Record<string, unknown>): string | undefined {
  return asPositiveInteger(message.message_thread_id)?.toString();
}

/** Modality refs for one message: identifiers only, bounded, largest photo size only. */
function attachmentRefs(message: Record<string, unknown>): ChannelAttachmentRef[] | undefined {
  const refs: ChannelAttachmentRef[] = [];
  const photo = message.photo;
  if (Array.isArray(photo)) {
    let best: { readonly id: string; readonly size?: number } | undefined;
    for (const raw of photo) {
      const size = asRecord(raw);
      const id = asId(size?.file_id);
      if (id === undefined) continue;
      const bytes = asPositiveInteger(size?.file_size);
      if (best === undefined || (bytes ?? 0) > (best.size ?? 0)) best = { id, ...(bytes === undefined ? {} : { size: bytes }) };
    }
    if (best !== undefined) {
      refs.push({ kind: "image", transportFileId: best.id, ...(best.size === undefined ? {} : { byteLength: best.size }) });
    }
  }
  const voice = asRecord(message.voice);
  const voiceId = asId(voice?.file_id);
  if (voiceId !== undefined) {
    const mimeType = boundedMeta(voice?.mime_type);
    const byteLength = asPositiveInteger(voice?.file_size);
    refs.push({
      kind: "voice",
      transportFileId: voiceId,
      ...(mimeType === undefined ? {} : { mimeType }),
      ...(byteLength === undefined ? {} : { byteLength }),
    });
  }
  const document = asRecord(message.document);
  const documentId = asId(document?.file_id);
  if (documentId !== undefined) {
    const mimeType = boundedMeta(document?.mime_type);
    const byteLength = asPositiveInteger(document?.file_size);
    const fileName = boundedMeta(document?.file_name);
    refs.push({
      kind: "document",
      transportFileId: documentId,
      ...(mimeType === undefined ? {} : { mimeType }),
      ...(byteLength === undefined ? {} : { byteLength }),
      ...(fileName === undefined ? {} : { fileName }),
    });
  }
  return refs.length === 0 ? undefined : refs.slice(0, MAX_ATTACHMENT_REFS);
}

function parseMessageUpdate(connectionId: string, update: Record<string, unknown>, allowGroups: boolean): ChannelInboundEvent | undefined {
  const id = updateId(update);
  const message = asRecord(update.message);
  if (id === undefined || message === undefined) return undefined;
  const chat = asRecord(message.chat);
  const from = asRecord(message.from);
  const kind = admittedChatKind(chat, allowGroups);
  if (kind === undefined || from === undefined || from.is_bot === true || asRecord(message.sender_chat) !== undefined) {
    return undefined;
  }
  const chatId = asChatId(chat?.id);
  const actorId = asId(from.id);
  if (chatId === undefined || actorId === undefined) return undefined;
  const text = typeof message.text === "string" ? message.text : typeof message.caption === "string" ? message.caption : "";
  const attachments = attachmentRefs(message);
  if (text.length === 0 && attachments === undefined) return undefined;
  const threadId = messageThreadId(message);
  const forwarded = message.forward_origin !== undefined || message.forward_date !== undefined;
  return {
    connectionId,
    externalConversationId: chatId,
    externalActorId: actorId,
    eventId: String(id),
    text,
    ...(attachments === undefined ? {} : { attachments }),
    ...(threadId === undefined ? {} : { threadId }),
    receivedAt: new Date().toISOString(),
    claims: {
      platform: "telegram",
      chatType: kind,
      ...(chat?.is_forum === true ? { isForum: true } : {}),
      ...(forwarded ? { forwarded: true } : {}),
    },
  };
}

function callbackId(update: Record<string, unknown>): string | undefined {
  const callback = asRecord(update.callback_query);
  if (callback === undefined || typeof callback.id !== "string" || callback.id.length === 0) return undefined;
  if (typeof callback.data === "string" && Buffer.byteLength(callback.data, "utf8") > 64) return undefined;
  return callback.id;
}

function parseCallbackUpdate(connectionId: string, update: Record<string, unknown>, allowGroups: boolean): ChannelInboundEvent | undefined {
  const id = updateId(update);
  const callback = asRecord(update.callback_query);
  const message = callback === undefined ? undefined : asRecord(callback.message);
  const chat = message === undefined ? undefined : asRecord(message.chat);
  const from = callback === undefined ? undefined : asRecord(callback.from);
  const data = callback?.data;
  const match = typeof data === "string" ? /^p:([ad]):([A-Za-z0-9_-]{32,64})$/.exec(data) : null;
  const kind = admittedChatKind(chat, allowGroups);
  if (id === undefined || callback === undefined || kind === undefined || from === undefined || from.is_bot === true || match === null) {
    return undefined;
  }
  const chatId = asChatId(chat?.id);
  const actorId = asId(from.id);
  const token = match[2];
  if (chatId === undefined || actorId === undefined || token === undefined) return undefined;
  const threadId = messageThreadId(message ?? {});
  return {
    connectionId,
    externalConversationId: chatId,
    externalActorId: actorId,
    eventId: String(id),
    text: "",
    approval: { token, outcome: match[1] === "a" ? "allow_once" : "reject_once" },
    ...(threadId === undefined ? {} : { threadId }),
    receivedAt: new Date().toISOString(),
    claims: { platform: "telegram", chatType: kind, control: "approval" },
  };
}

function inlineKeyboard(controls: readonly ChannelReplyControl[] | undefined) {
  if (controls === undefined) return undefined;
  if (controls.length === 0 || controls.length > 8) return null;
  const buttons: Array<{ text: string; callback_data: string }> = [];
  for (const control of controls) {
    if (
      typeof control?.label !== "string" ||
      typeof control.value !== "string" ||
      control.label.length === 0 ||
      Buffer.byteLength(control.label, "utf8") > 64 ||
      Buffer.byteLength(control.value, "utf8") > 64
    ) {
      return null;
    }
    buttons.push({ text: control.label, callback_data: control.value });
  }
  return { inline_keyboard: [buttons] };
}

function knownSendFailure(error: unknown): string {
  if (!(error instanceof TelegramApiError)) return "telegram_api_error";
  if (error.status === 401) return "telegram_unauthorized";
  if (error.status === 403) return "telegram_forbidden";
  if (error.status === 429) return "telegram_rate_limited";
  if (error.kind === "credential") return "telegram_credential";
  return "telegram_api_error";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    timer = setTimeout(done, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

interface TelegramApi {
  call<T>(method: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T>;
  upload<T>(method: string, form: FormData, signal: AbortSignal): Promise<T>;
  /** Bounded GET of `api.telegram.org/file/bot<token>/<path>`; the token never leaves this module. */
  download(filePath: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | undefined>;
}

function telegramApi(options: {
  readonly botToken: CredentialValueSource;
  readonly apiOrigin?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxResponseBytes: number;
}): TelegramApi {
  const origin = apiOrigin(options.apiOrigin);
  const fetcher = options.fetch ?? globalThis.fetch;

  async function credential(): Promise<string> {
    const token = await resolveCredentialValue(options.botToken, { provider: "telegram", name: "botToken" });
    if (!token || Buffer.byteLength(token, "utf8") > 1024) throw new TelegramApiError({ kind: "credential" });
    return token;
  }

  async function perform(method: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const token = await credential();
    let response: Response;
    try {
      response = await fetcher(`${origin}/bot${token}/${method}`, { ...init, redirect: "error", signal });
    } catch {
      throw new TelegramApiError({ kind: "network" });
    }
    const payload = asRecord(await readJson(response, options.maxResponseBytes));
    if (!response.ok || payload?.ok !== true) {
      throw new TelegramApiError({
        kind: "api",
        status: typeof payload?.error_code === "number" ? payload.error_code : response.status,
        ...(payload === undefined ? {} : { retryAfter: retryAfter(payload) }),
      });
    }
    return payload.result;
  }

  return {
    call<T>(method: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
      return perform(
        method,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        signal,
      ) as Promise<T>;
    },
    upload<T>(method: string, form: FormData, signal: AbortSignal): Promise<T> {
      return perform(method, { method: "POST", body: form }, signal) as Promise<T>;
    },
    async download(filePath, maxBytes, signal) {
      const token = await credential();
      let response: Response;
      try {
        response = await fetcher(`${origin}/file/bot${token}/${filePath}`, { method: "GET", redirect: "error", signal });
      } catch {
        return undefined;
      }
      if (!response.ok) return undefined;
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) return undefined;
      try {
        return await readBytes(response, maxBytes);
      } catch {
        return undefined;
      }
    },
  };
}

async function releaseReceiver(
  leases: LeaseStore,
  ownership: OwnershipScope,
  connectionId: string,
  ownerId: string,
  lease: LeaseRecord | undefined,
) {
  if (lease === undefined) return;
  try {
    await leases.releaseLease({
      namespace: RECEIVER_LEASE_NAMESPACE,
      key: receiverKey(connectionId),
      ...scope(ownership),
      ownerId,
      token: lease.token,
    });
  } catch {
    // A lease expiry/release failure cannot make this process the receiver again.
  }
}

interface TelegramInboundMediaConfig {
  readonly connectionId: string;
  readonly allowGroups: boolean;
  readonly api: TelegramApi;
  readonly maxAttachmentBytes: number;
  readonly transcribe?: TelegramAdapterOptions["transcribe"];
  readonly extractDocumentText?: TelegramAdapterOptions["extractDocumentText"];
  readonly isStopped?: () => boolean;
}

/**
 * Shared inbound media pipeline for both ingress paths (poller and mounted webhook): parse the
 * update, resolve voice/document text through host hooks, and download one bounded body per ref.
 * Bytes never leave this scope — they are not put on the event, journaled, logged or written to disk.
 */
function createInboundMedia(config: TelegramInboundMediaConfig) {
  function validAttachmentRef(ref: ChannelAttachmentRef | undefined): ref is ChannelAttachmentRef {
    if (ref === null || typeof ref !== "object") return false;
    if (ref.kind !== "image" && ref.kind !== "document" && ref.kind !== "voice") return false;
    if (typeof ref.transportFileId !== "string" || ref.transportFileId.length === 0) return false;
    if (Buffer.byteLength(ref.transportFileId, "utf8") > 256) return false;
    if (ref.mimeType !== undefined && boundedMeta(ref.mimeType) === undefined) return false;
    if (ref.fileName !== undefined && boundedMeta(ref.fileName) === undefined) return false;
    return ref.byteLength === undefined || (Number.isSafeInteger(ref.byteLength) && ref.byteLength >= 0);
  }

  /** One `getFile` plus one bounded download for a ref that came from a parsed update. */
  async function fetchAttachment(ref: ChannelAttachmentRef, signal: AbortSignal): Promise<Uint8Array | undefined> {
    if (config.isStopped?.() === true || !validAttachmentRef(ref)) return undefined;
    try {
      const file = asRecord(await config.api.call<unknown>("getFile", { file_id: ref.transportFileId }, signal));
      const path = typeof file?.file_path === "string" ? file.file_path : undefined;
      if (path === undefined || !safeFilePath(path)) return undefined;
      const declared = asPositiveInteger(file?.file_size) ?? ref.byteLength;
      if (declared !== undefined && declared > config.maxAttachmentBytes) return undefined;
      return await config.api.download(path, config.maxAttachmentBytes, signal);
    } catch {
      // Fail closed: oversize, network, credential and API failures all yield no bytes.
      return undefined;
    }
  }

  /** Voice/document become ordinary turn text; images stay refs for the runtime's model-input gate. */
  async function attachmentText(ref: ChannelAttachmentRef, signal: AbortSignal): Promise<string | undefined> {
    const hook = ref.kind === "voice" ? config.transcribe : ref.kind === "document" ? config.extractDocumentText : undefined;
    if (hook === undefined) return undefined;
    const bytes = await fetchAttachment(ref, signal);
    if (bytes === undefined) return undefined;
    try {
      const text = await hook(bytes, ref.mimeType, signal);
      return typeof text === "string" && text.trim().length > 0 ? text : undefined;
    } catch {
      return undefined;
    }
  }

  /** Parse one update and resolve its attachment text before admission; bytes never leave this scope. */
  async function prepareInboundEvent(update: Record<string, unknown>, signal: AbortSignal): Promise<ChannelInboundEvent | undefined> {
    const event =
      parseMessageUpdate(config.connectionId, update, config.allowGroups) ??
      parseCallbackUpdate(config.connectionId, update, config.allowGroups);
    const refs = event?.attachments;
    if (event === undefined || refs === undefined) return event;
    const parts = [event.text];
    for (const ref of refs) {
      const text = await attachmentText(ref, signal);
      if (text !== undefined) parts.push(text);
    }
    const text = parts.filter((part) => part.length > 0).join("\n\n");
    return text === event.text ? event : { ...event, text };
  }

  return { fetchAttachment, prepareInboundEvent };
}

/**
 * Creates an explicit long-polling adapter. It refuses to start when Telegram reports an active
 * webhook and holds a service-owned lease for its full receive loop.
 */
export function createTelegramAdapter(options: TelegramAdapterOptions): TelegramAdapter {
  if (
    typeof options.connectionId !== "string" ||
    options.connectionId.length === 0 ||
    Buffer.byteLength(options.connectionId, "utf8") > 256
  ) {
    throw new TypeError("Telegram connectionId must be a bounded non-empty string");
  }
  const pollTimeoutSeconds = boundedInteger(options.pollTimeoutSeconds, DEFAULT_POLL_TIMEOUT_SECONDS, 1, 50, "pollTimeoutSeconds");
  const pollLimit = boundedInteger(options.pollLimit, DEFAULT_POLL_LIMIT, 1, 100, "pollLimit");
  const leaseTtlMs = boundedInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, pollTimeoutSeconds * 1000 + 10_000, 300_000, "leaseTtlMs");
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1024,
    HARD_MAX_REQUEST_BYTES,
    "maxResponseBytes",
  );
  const maxAttachmentBytes = boundedInteger(
    options.maxAttachmentBytes,
    DEFAULT_CHANNEL_LIMITS.maxAttachmentBytes,
    1,
    HARD_CHANNEL_LIMITS.maxAttachmentBytes,
    "maxAttachmentBytes",
  );
  const api = telegramApi({ ...options, maxResponseBytes });
  const allowGroups = options.allowGroups === true;
  const sendDrafts = options.sendDrafts === true;
  const media = createInboundMedia({
    connectionId: options.connectionId,
    allowGroups,
    api,
    maxAttachmentBytes,
    ...(options.transcribe === undefined ? {} : { transcribe: options.transcribe }),
    ...(options.extractDocumentText === undefined ? {} : { extractDocumentText: options.extractDocumentText }),
    isStopped: () => stopped,
  });
  const state = createChannelStateStore({ checkpoints: options.checkpoints, maxJournalRecordBytes: 1024 });
  const ownerId = `telegram-poll-${randomUUID()}`;
  let controller: AbortController | undefined;
  let polling: Promise<void> | undefined;
  let lease: LeaseRecord | undefined;
  let stopped = false;
  let pendingDraft: { readonly chatId: string; readonly threadId?: string; readonly text: string } | undefined;
  let draftsInFlight: Promise<void> | undefined;

  /** One request in flight, latest partial wins: a token stream never floods the Bot API. */
  function flushDrafts(): void {
    if (draftsInFlight !== undefined) return;
    draftsInFlight = (async () => {
      try {
        for (;;) {
          const draft = pendingDraft;
          if (draft === undefined || stopped) return;
          pendingDraft = undefined;
          try {
            await api.call<Record<string, unknown>>(
              "sendMessageDraft",
              {
                chat_id: draft.chatId,
                draft_id: DRAFT_ID,
                text: draft.text,
                ...(draft.threadId === undefined ? {} : { message_thread_id: draft.threadId }),
              },
              controller?.signal ?? new AbortController().signal,
            );
          } catch {
            // Ephemeral preview only: a failed draft never affects the turn or its terminal send.
          }
        }
      } finally {
        draftsInFlight = undefined;
      }
    })();
  }

  async function renew(signal: AbortSignal): Promise<boolean> {
    if (lease === undefined) return false;
    try {
      const renewed = await options.leases.renewLease({
        namespace: RECEIVER_LEASE_NAMESPACE,
        key: receiverKey(options.connectionId),
        ...scope(options.cursorOwnership),
        ownerId,
        token: lease.token,
        ttlMs: leaseTtlMs,
        signal,
      });
      if (renewed === null) return false;
      lease = renewed;
      return true;
    } catch {
      return false;
    }
  }

  async function sendCall(body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    let last: TelegramApiError | undefined;
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      try {
        return await api.call<Record<string, unknown>>("sendMessage", body, signal);
      } catch (error) {
        if (!(error instanceof TelegramApiError)) throw error;
        last = error;
        if (error.retryAfter === undefined || attempt + 1 === MAX_SEND_ATTEMPTS) throw error;
        await delay(error.retryAfter * 1000, signal);
      }
    }
    throw last ?? new TelegramApiError({ kind: "api" });
  }

  /**
   * Optional host synthesis for `final` replies: a voice note next to the text, never instead of
   * it. Best effort — synthesis or upload failures are swallowed so an already-delivered text
   * message is never reported as failed, and nothing here can be steered by model output.
   */
  async function sendVoice(reply: ChannelReply, signal: AbortSignal): Promise<void> {
    const synthesize = options.synthesize;
    if (synthesize === undefined || reply.kind !== "final" || stopped) return;
    const text = reply.text.trim();
    if (text.length === 0) return;
    try {
      const audio = await synthesize(text, signal);
      const format =
        typeof audio?.format === "string"
          ? audio.format
              .toLowerCase()
              .replace(/^audio\//, "")
              .replace(/^\./, "")
          : "";
      const mimeType = VOICE_FORMATS.get(format);
      if (mimeType === undefined || !(audio?.audio instanceof Uint8Array) || audio.audio.byteLength === 0) return;
      const copy = new Uint8Array(audio.audio.byteLength);
      copy.set(audio.audio);
      const form = new FormData();
      form.append("chat_id", reply.externalConversationId);
      if (typeof reply.threadId === "string" && reply.threadId.length > 0) form.append("message_thread_id", reply.threadId);
      form.append("voice", new Blob([copy], { type: mimeType }), `reply.${format === "oga" ? "ogg" : format}`);
      await api.upload<Record<string, unknown>>("sendVoice", form, signal);
    } catch {
      // Voice is additive: the text reply already settled.
    }
  }

  async function answerCallbackQuery(id: string, signal: AbortSignal): Promise<void> {
    try {
      await api.call<boolean>("answerCallbackQuery", { callback_query_id: id }, signal);
    } catch (error) {
      if (error instanceof TelegramApiError && error.retryAfter !== undefined) {
        try {
          await delay(error.retryAfter * 1000, signal);
          await api.call<boolean>("answerCallbackQuery", { callback_query_id: id }, signal);
        } catch {
          // Telegram requires a callback acknowledgement even when control handling later fails closed.
        }
      }
    }
  }

  async function poll(receive: ChannelReceive, signal: AbortSignal): Promise<void> {
    const cursor = await state.loadCursor({ ownership: options.cursorOwnership, connectionId: options.connectionId });
    let offset = cursor?.record.lastEventId === undefined ? undefined : Number(cursor.record.lastEventId) + 1;
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) offset = undefined;
    for (;;) {
      if (signal.aborted) return;
      let updates: unknown;
      try {
        updates = await api.call<unknown>(
          "getUpdates",
          {
            ...(offset === undefined ? {} : { offset }),
            timeout: pollTimeoutSeconds,
            limit: pollLimit,
            allowed_updates: ["message", "callback_query"],
          },
          signal,
        );
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof TelegramApiError && error.retryAfter !== undefined) {
          await delay(error.retryAfter * 1000, signal);
        } else if (error instanceof TelegramApiError && (error.status === 401 || error.status === 403 || error.kind === "credential")) {
          return;
        } else {
          await delay(1000, signal);
        }
        continue;
      }
      if (!(await renew(signal))) return;
      if (!Array.isArray(updates)) {
        await delay(1000, signal);
        continue;
      }
      const ordered: Array<{ update: Record<string, unknown>; id: number }> = [];
      for (const raw of updates) {
        const update = asRecord(raw);
        const id = update === undefined ? undefined : updateId(update);
        if (update !== undefined && id !== undefined) ordered.push({ update, id });
      }
      ordered.sort((a, b) => a.id - b.id);
      try {
        for (const { update, id } of ordered) {
          if (offset !== undefined && id < offset) continue;
          const callback = callbackId(update);
          if (callback !== undefined) await answerCallbackQuery(callback, signal);
          const event = await media.prepareInboundEvent(update, signal);
          if (event !== undefined) {
            const admission = await receive(event);
            if (retryableAdmission(admission)) throw new TelegramApiError({ kind: "api" });
          }
          // A non-text/unsupported update is a final disposition. Advancing only happens after
          // its callback acknowledgement or `receive` durable admission has settled.
          await state.advanceCursor({ ownership: options.cursorOwnership, connectionId: options.connectionId }, String(id));
          offset = id + 1;
        }
      } catch {
        if (!signal.aborted) await delay(1000, signal);
      }
    }
  }

  return {
    connectionId: options.connectionId,
    capabilities: { acknowledgement: "telegram_offset", controls: "callback", maxTextCodeUnits: TELEGRAM_TEXT_CODE_UNITS },
    async start(receive) {
      if (stopped) throw new Error("Telegram adapter is stopped");
      if (polling !== undefined) throw new Error("Telegram adapter is already started");
      controller = new AbortController();
      try {
        const acquired = await options.leases.tryAcquireLease({
          namespace: RECEIVER_LEASE_NAMESPACE,
          key: receiverKey(options.connectionId),
          ...scope(options.cursorOwnership),
          ownerId,
          ttlMs: leaseTtlMs,
          signal: controller.signal,
        });
        if (acquired === null) throw new Error("Telegram receiver is already active");
        lease = acquired;
        await api.call<Record<string, unknown>>("getMe", {}, controller.signal);
        const webhook = asRecord(await api.call<unknown>("getWebhookInfo", {}, controller.signal));
        if (typeof webhook?.url === "string" && webhook.url.length > 0) throw new Error("Telegram webhook is active; polling is refused");
        polling = poll(receive, controller.signal)
          .catch(() => undefined)
          .finally(async () => {
            await releaseReceiver(options.leases, options.cursorOwnership, options.connectionId, ownerId, lease);
            lease = undefined;
          });
      } catch (error) {
        await releaseReceiver(options.leases, options.cursorOwnership, options.connectionId, ownerId, lease);
        lease = undefined;
        controller = undefined;
        throw error instanceof TelegramApiError ? new Error("Telegram adapter start failed") : error;
      }
    },
    async send(reply) {
      if (
        reply.connectionId !== options.connectionId ||
        typeof reply.externalConversationId !== "string" ||
        reply.externalConversationId.length === 0
      ) {
        return { delivered: false, reason: "invalid_destination" };
      }
      const chunks = chunkText(reply.text);
      if (chunks.length === 0) return { delivered: false, reason: "empty_reply" };
      const keyboard = inlineKeyboard(reply.controls);
      if (keyboard === null) return { delivered: false, reason: "invalid_controls" };
      const signal = controller?.signal ?? new AbortController().signal;
      let messageId: string | undefined;
      let sent = false;
      try {
        for (const [index, text] of chunks.entries()) {
          const result = await sendCall(
            {
              chat_id: reply.externalConversationId,
              text,
              ...(typeof reply.threadId === "string" && reply.threadId.length > 0 ? { message_thread_id: reply.threadId } : {}),
              ...(index + 1 === chunks.length && keyboard !== undefined ? { reply_markup: keyboard } : {}),
            },
            signal,
          );
          const id = asId(asRecord(result)?.message_id);
          if (id !== undefined) messageId = id;
          sent = true;
        }
        await sendVoice(reply, signal);
        return { delivered: true, ...(messageId === undefined ? {} : { messageId }) };
      } catch (error) {
        // A network error after any chunk (or before its response) cannot prove non-delivery.
        if (sent || !(error instanceof TelegramApiError) || error.kind === "network") throw new TelegramDeliveryUnknownError();
        return { delivered: false, reason: knownSendFailure(error) };
      }
    },
    async stop() {
      stopped = true;
      controller?.abort(new Error("Telegram adapter stopped"));
      await polling;
      await releaseReceiver(options.leases, options.cursorOwnership, options.connectionId, ownerId, lease);
      lease = undefined;
    },
    sendDraft(delta) {
      if (!sendDrafts || stopped) return;
      if (delta.connectionId !== options.connectionId) return;
      // Bot API has no group drafts: group/supergroup chat ids are negative, private ids are not.
      if (delta.externalConversationId.startsWith("-")) return;
      const text = draftText(delta.text);
      if (text.length === 0) return;
      pendingDraft = {
        chatId: delta.externalConversationId,
        ...(delta.threadId === undefined ? {} : { threadId: delta.threadId }),
        text,
      };
      flushDrafts();
    },
    fetchAttachment(ref) {
      return media.fetchAttachment(ref, controller?.signal ?? new AbortController().signal).then((bytes) =>
        bytes === undefined
          ? undefined
          : {
              bytes,
              ...(ref.mimeType === undefined ? {} : { mimeType: ref.mimeType }),
              ...(ref.fileName === undefined ? {} : { fileName: ref.fileName }),
            },
      );
    },
  };
}

/**
 * Creates a host-mounted Web Request/Response handler. It neither configures a webhook nor
 * starts a listener; operators deliberately call Telegram's `setWebhook` themselves.
 */
export function createTelegramWebhookHandler(options: TelegramWebhookHandlerOptions): TelegramWebhookHandler {
  if (
    typeof options.connectionId !== "string" ||
    options.connectionId.length === 0 ||
    Buffer.byteLength(options.connectionId, "utf8") > 256
  ) {
    throw new TypeError("Telegram connectionId must be a bounded non-empty string");
  }
  if (!validWebhookSecret(options.webhookSecret)) throw new TypeError("Telegram webhookSecret must be 1-256 URL-safe characters");
  const leaseTtlMs = boundedInteger(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, 5_000, 300_000, "leaseTtlMs");
  const maxRequestBytes = boundedInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1024,
    HARD_MAX_REQUEST_BYTES,
    "maxRequestBytes",
  );
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    1024,
    HARD_MAX_REQUEST_BYTES,
    "maxResponseBytes",
  );
  const api = telegramApi({ ...options, maxResponseBytes });
  const allowGroups = options.allowGroups === true;
  const maxAttachmentBytes = boundedInteger(
    options.maxAttachmentBytes,
    DEFAULT_CHANNEL_LIMITS.maxAttachmentBytes,
    1,
    HARD_CHANNEL_LIMITS.maxAttachmentBytes,
    "maxAttachmentBytes",
  );
  const media = createInboundMedia({
    connectionId: options.connectionId,
    allowGroups,
    api,
    maxAttachmentBytes,
    ...(options.transcribe === undefined ? {} : { transcribe: options.transcribe }),
    ...(options.extractDocumentText === undefined ? {} : { extractDocumentText: options.extractDocumentText }),
  });

  return async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return new Response("Unsupported media type", { status: 415 });
    }
    if (!constantTimeEqual(options.webhookSecret, request.headers.get("x-telegram-bot-api-secret-token"))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const ownerId = `telegram-webhook-${randomUUID()}`;
    let lease: LeaseRecord | null = null;
    try {
      lease = await options.leases.tryAcquireLease({
        namespace: RECEIVER_LEASE_NAMESPACE,
        key: receiverKey(options.connectionId),
        ...scope(options.cursorOwnership),
        ownerId,
        ttlMs: leaseTtlMs,
        signal: request.signal,
      });
      if (lease === null) return new Response("Unavailable", { status: 503 });
      let update: Record<string, unknown> | undefined;
      try {
        update = asRecord(await readRequestJson(request, maxRequestBytes));
      } catch (error) {
        return new Response(error instanceof RangeError ? "Payload too large" : "Malformed request", {
          status: error instanceof RangeError ? 413 : 400,
        });
      }
      if (update === undefined || updateId(update) === undefined) return new Response("Malformed request", { status: 400 });
      const callback = callbackId(update);
      if (callback !== undefined) {
        try {
          await api.call<boolean>("answerCallbackQuery", { callback_query_id: callback }, request.signal);
        } catch {
          return new Response("Unavailable", { status: 503 });
        }
      }
      const event = await media.prepareInboundEvent(update, request.signal);
      if (event === undefined) return new Response(null, { status: 204 });
      const admission = await options.admit(event);
      if (retryableAdmission(admission)) return new Response("Unavailable", { status: 503 });
      return new Response(null, { status: 204 });
    } catch {
      return new Response("Unavailable", { status: 503 });
    } finally {
      await releaseReceiver(options.leases, options.cursorOwnership, options.connectionId, ownerId, lease ?? undefined);
    }
  };
}
