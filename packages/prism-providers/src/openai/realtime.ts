import { randomUUID } from "node:crypto";
import type {
  CredentialValueSource,
  ErrorInfo,
  ModelConfig,
  RealtimeCaps,
  RealtimeEvent,
  RealtimeSession,
  SecretRedactor,
} from "@arnilo/prism";
import { redactSecrets, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";

export interface RealtimeTransportOptions {
  /** Official Realtime WebSocket authentication headers. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface OpenAIRealtimeSessionOptions {
  /** Host-owned local session id. Generated when omitted. */
  readonly id?: string;
  /** Stable host ownership identifier, sent to OpenAI as its safety identifier. */
  readonly ownerId: string;
  readonly model: ModelConfig;
  readonly apiKey?: CredentialValueSource;
  readonly baseUrl?: string;
  /** Injectable transport factory for tests or a host WebSocket implementation. */
  readonly webSocket?: (url: string, options: RealtimeTransportOptions) => RealtimeTransport;
  readonly caps?: RealtimeCaps;
  readonly redactor?: SecretRedactor;
  readonly signal?: AbortSignal;
}

/** Minimal transport surface the session consumes. Matches the global WebSocket subset. */
export interface RealtimeTransport {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", handler: (event: { readonly data?: string }) => void): void;
  removeEventListener?(type: "open" | "message" | "close" | "error", handler: (event: { readonly data?: string }) => void): void;
}

const DEFAULT_CAPS: Required<RealtimeCaps> = {
  maxAudioEventsPerSecond: 256,
  maxBytesPerSecond: 1_048_576,
  maxWallMs: 600_000,
};
const OPEN = 1; // WebSocket.OPEN
// One active session per host ownership scope. Use a run-scoped ownerId when each run
// needs an independent session; no process-wide control plane is introduced.
const activeOwners = new Set<string>();

type QueuedEvent = { readonly event: RealtimeEvent; readonly bytes: number };

export function createOpenAIRealtimeSession(options: OpenAIRealtimeSessionOptions): RealtimeSession {
  const id = options.id ?? randomUUID();
  const ownerId = opaqueId(options.ownerId, "ownerId", 256);
  const caps = resolveCaps(options.caps);
  const providerId = "openai";
  const queue: QueuedEvent[] = [];
  const hostedCalls = new Set<string>();
  let queuedBytes = 0;
  let transport: RealtimeTransport | undefined;
  let opening: Promise<void> | undefined;
  let ownsOwnerSlot = false;
  let secret: string | undefined;
  let closed = false;
  let started = false;
  let serverSessionId: string | undefined;
  let resolveEvent: ((event: RealtimeEvent | undefined) => void) | undefined;
  let audioEventsThisSecond = 0;
  let bytesThisSecond = 0;
  let secondMarker = Date.now();
  let wallTimer: ReturnType<typeof setTimeout> | undefined;

  function redact(text: string): string {
    return options.redactor?.redact(redactSecrets(text, [secret])) ?? redactSecrets(text, [secret]);
  }

  function deliver(event: RealtimeEvent, bytes = 0): void {
    if (resolveEvent) {
      resolveEvent(event);
      resolveEvent = undefined;
      return;
    }
    queue.push({ event, bytes });
    queuedBytes += bytes;
  }

  function releaseOwnerSlot(): void {
    if (!ownsOwnerSlot) return;
    activeOwners.delete(ownerId);
    ownsOwnerSlot = false;
  }

  function closeTransport(reason?: string): void {
    if (wallTimer) clearTimeout(wallTimer);
    wallTimer = undefined;
    try {
      transport?.close(1000, reason);
    } catch {
      /* transport already gone */
    }
    releaseOwnerSlot();
  }

  function doClose(reason?: string): void {
    if (closed) return;
    closed = true;
    closeTransport(reason);
    deliver({ type: "session_closed", reason });
  }

  function failClosed(reason: string): void {
    if (closed) return;
    closed = true;
    closeTransport(reason);
    // Do not retain attacker-controlled backlog after a transport/budget failure.
    queue.length = 0;
    queuedBytes = 0;
    deliver({ type: "error", error: { name: "Error", message: redact(reason), code: "ERR_PRISM_REALTIME_LIMIT" } satisfies ErrorInfo });
    deliver({ type: "session_closed", reason: redact(reason) });
  }

  function push(event: RealtimeEvent, bytes = 0): void {
    if (closed) return;
    if (!resolveEvent && (queue.length >= caps.maxAudioEventsPerSecond || queuedBytes + bytes > caps.maxBytesPerSecond)) {
      failClosed("realtime event queue cap exceeded");
      return;
    }
    deliver(event, bytes);
  }

  function chargeAudio(bytes: number): boolean {
    const now = Date.now();
    if (now - secondMarker >= 1_000) {
      secondMarker = now;
      audioEventsThisSecond = 0;
      bytesThisSecond = 0;
    }
    if (audioEventsThisSecond + 1 > caps.maxAudioEventsPerSecond) {
      failClosed("audio event cap exceeded");
      return false;
    }
    if (bytesThisSecond + bytes > caps.maxBytesPerSecond) {
      failClosed("audio byte cap exceeded");
      return false;
    }
    audioEventsThisSecond += 1;
    bytesThisSecond += bytes;
    return true;
  }

  async function open(): Promise<void> {
    if (closed || transport) return;
    if (opening) return opening;
    const pending = openTransport();
    opening = pending;
    try {
      await pending;
    } finally {
      if (opening === pending) opening = undefined;
    }
  }

  async function openTransport(): Promise<void> {
    if (activeOwners.has(ownerId)) throw new Error("realtime session already active for ownerId");
    activeOwners.add(ownerId);
    ownsOwnerSlot = true;
    try {
      secret = await resolveCredentialValue(options.apiKey, { provider: providerId, name: "apiKey" });
      if (closed) {
        releaseOwnerSlot();
        return;
      }
      const base = trimTrailingSlashes(options.baseUrl ?? "wss://api.openai.com/v1");
      if (!base.startsWith("wss://")) throw new Error("OpenAI realtime baseUrl must use wss://");
      const url = `${base}/realtime?model=${encodeURIComponent(options.model.model)}`;
      const headers = {
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        "OpenAI-Safety-Identifier": ownerId,
      };
      transport = (options.webSocket ?? globalWebSocket)(url, { headers });
      transport.addEventListener("open", () => {
        /* session.created confirms the bound server session */
      });
      transport.addEventListener("message", (event) => {
        if (typeof event.data === "string") handleInbound(event.data);
      });
      transport.addEventListener("close", () => {
        if (!closed) doClose("transport closed");
      });
      transport.addEventListener("error", () => failClosed("realtime transport error"));
      wallTimer = setTimeout(() => failClosed("wall-time cap exceeded"), caps.maxWallMs);
      wallTimer.unref?.();
      if (options.signal) {
        if (options.signal.aborted) failClosed("aborted");
        else options.signal.addEventListener("abort", () => failClosed("aborted"), { once: true });
      }
    } catch (error) {
      releaseOwnerSlot();
      throw error;
    }
  }

  function emitHostedCall(name: string, callId: string): void {
    if (hostedCalls.has(callId)) return;
    hostedCalls.add(callId);
    push({ type: "tool_call", call: { type: "tool_call", id: callId, name, arguments: {}, authority: "provider-hosted" } });
  }

  function handleInbound(text: string): void {
    // Bound raw JSON before parse/base64 decode; neither is allowed to allocate unbounded input.
    if (Buffer.byteLength(text) > caps.maxBytesPerSecond * 2) {
      failClosed("realtime message byte cap exceeded");
      return;
    }
    let parsed: { readonly type?: string; readonly [key: string]: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const type = parsed.type ?? "";
    if (type === "session.created") {
      const session = parsed.session as { readonly id?: unknown } | undefined;
      if (typeof session?.id !== "string") return failClosed("realtime session id missing");
      const nextId = opaqueId(session.id, "server session id", 4 * 1024);
      if (serverSessionId && serverSessionId !== nextId) return failClosed("realtime session id changed");
      if (!serverSessionId) {
        serverSessionId = nextId;
        started = true;
        push({ type: "session_started", sessionId: serverSessionId });
      }
      return;
    }
    if (type === "response.output_audio.delta" && typeof parsed.delta === "string") {
      const estimatedBytes = Math.ceil((parsed.delta.length * 3) / 4);
      if (!chargeAudio(estimatedBytes)) return;
      push({ type: "audio_delta", audio: new Uint8Array(Buffer.from(parsed.delta, "base64")) }, estimatedBytes);
      return;
    }
    if (type === "response.output_audio_transcript.delta" && typeof parsed.delta === "string") {
      const transcript = redact(parsed.delta);
      push({ type: "transcript_delta", text: transcript, role: "assistant" }, Buffer.byteLength(transcript));
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed" && typeof parsed.transcript === "string") {
      const transcript = redact(parsed.transcript);
      push({ type: "transcript_delta", text: transcript, role: "user" }, Buffer.byteLength(transcript));
      return;
    }
    if (type === "response.output_item.added" && hostedToolItem(parsed.item)) {
      const item = parsed.item as { readonly id?: string; readonly type?: string };
      emitHostedCall(item.type!, item.id ?? `hosted:${hostedCalls.size}`);
      return;
    }
    const progress = /^response\.([a-z_]+_call)\.(?:in_progress|searching|completed)$/.exec(type);
    if (progress && typeof parsed.item_id === "string") emitHostedCall(progress[1]!, parsed.item_id);
    else if (type === "interruption" || type === "response.interrupted") push({ type: "interrupted" });
    else if (type === "error") failClosed("realtime server error");
  }

  return {
    id,
    provider: providerId,
    async sendAudio(chunk: Uint8Array, sendOptions?: { readonly signal?: AbortSignal }) {
      if (closed) throw new Error("realtime session closed");
      await open();
      if (closed || !transport || transport.readyState !== OPEN || !started) throw new Error("realtime session not started");
      if (!chargeAudio(chunk.byteLength)) throw new Error("realtime audio cap exceeded");
      transport.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.from(chunk).toString("base64") }));
      sendOptions?.signal?.throwIfAborted();
    },
    events() {
      return (async function* () {
        await open();
        for (;;) {
          const queued = queue.shift();
          if (queued) queuedBytes -= queued.bytes;
          const event =
            queued?.event ??
            (closed
              ? undefined
              : await new Promise<RealtimeEvent | undefined>((resolve) => {
                  resolveEvent = resolve;
                }));
          if (!event) break;
          yield event;
          if (event.type === "session_closed") break;
        }
      })();
    },
    async interrupt(interruptOptions?: { readonly signal?: AbortSignal }) {
      if (closed || !transport || transport.readyState !== OPEN || !started) return;
      transport.send(JSON.stringify({ type: "response.cancel" }));
      push({ type: "interrupted" });
      interruptOptions?.signal?.throwIfAborted();
    },
    async close(reason?: string, _closeOptions?: { readonly signal?: AbortSignal }) {
      doClose(reason);
    },
  };
}

function resolveCaps(overrides: RealtimeCaps | undefined): Required<RealtimeCaps> {
  const caps = { ...DEFAULT_CAPS, ...overrides };
  for (const [name, value] of Object.entries(caps) as Array<[keyof RealtimeCaps, number]>) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_CAPS[name]) {
      throw new TypeError(`${name} must be a positive safe integer at most ${DEFAULT_CAPS[name]}`);
    }
  }
  return caps;
}

function opaqueId(value: string, name: string, maxBytes: number): string {
  if (!value || Buffer.byteLength(value) > maxBytes) throw new Error(`${name} must be a non-empty string at most ${maxBytes} bytes`);
  return value;
}

function hostedToolItem(value: unknown): value is { readonly id?: string; readonly type?: string } {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: string }).type;
  return typeof type === "string" && type.endsWith("_call") && type !== "function_call";
}

function globalWebSocket(url: string, options: RealtimeTransportOptions): RealtimeTransport {
  // Node 24's WebSocketInit accepts headers; Node 22 hosts can inject `webSocket`
  // until their global implementation supports the same documented header shape.
  const HeaderWebSocket = WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> },
  ) => WebSocket;
  const ws = new HeaderWebSocket(url, { headers: options.headers });
  return {
    get readyState() {
      return ws.readyState;
    },
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    addEventListener: (type, handler) => ws.addEventListener(type, handler as EventListener),
    removeEventListener: (type, handler) => ws.removeEventListener(type, handler as EventListener),
  };
}
