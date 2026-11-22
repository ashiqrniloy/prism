// Plan 236 Task 5: a minimal Discord Gateway v10 client. It is a small state machine over one
// WebSocket: Hello → jittered heartbeat → Identify or Resume → dispatches, with ACK-loss (zombie)
// detection, op 7 / op 9 handling, and reconnect with backoff. It knows nothing about the runtime.
import type { ChannelSecretSource } from "./secret-ref.js";

const DEFAULT_READY_TIMEOUT_MS = 30_000;

/** The subset of the WHATWG `WebSocket` the Gateway client uses. */
export interface DiscordSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: { readonly data?: unknown; readonly code?: number }) => void,
  ): void;
}

/** `GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT` (privileged: enable it in the developer portal). */
export const DISCORD_GATEWAY_INTENTS = (1 << 9) | (1 << 12) | (1 << 15);

/** Close codes after which reconnecting cannot succeed (bad token, shard or intents). */
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Close codes that invalidate the session: the next connection identifies afresh. */
const SESSION_CLOSE_CODES = new Set([4007, 4009]);
/** A non-1000/1001 code keeps the session resumable. */
const RESUME_CLOSE_CODE = 4000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SNOWFLAKE = /^\d{1,20}$/;

export interface DiscordGatewayOptions {
  readonly token: ChannelSecretSource;
  readonly intents: number;
  /** Returns the base `wss://` Gateway URL (`GET /gateway/bot`); called for every fresh Identify. */
  readonly gatewayUrl: () => Promise<string>;
  readonly webSocket: (url: string) => DiscordSocket;
  /** Receives every dispatch (op 0) after the client has updated its own state. */
  readonly onDispatch: (type: string, data: unknown) => unknown;
  readonly maxFrameBytes: number;
  /** Heartbeat jitter source in [0, 1); defaults to `Math.random`. */
  readonly random?: () => number;
  /** First reconnect delay, doubled per failed attempt up to 30 s (default 1,000 ms). */
  readonly reconnectBaseMs?: number;
  /** How long `start` waits for READY (default 30,000 ms). */
  readonly readyTimeoutMs?: number;
}

export interface DiscordGatewayState {
  readonly sessionId?: string;
  readonly sequence: number | null;
  readonly botUserId?: string;
  readonly resumeUrl?: string;
  readonly connected: boolean;
}

export interface DiscordGateway {
  /** Opens the first connection and resolves on READY; a fatal close or timeout rejects. */
  start(): Promise<void>;
  stop(): void;
  state(): DiscordGatewayState;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function gatewayEndpoint(base: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "wss:" || parsed.username || parsed.password) return undefined;
  return `${parsed.origin}/?v=10&encoding=json`;
}

export function createDiscordGateway(options: DiscordGatewayOptions): DiscordGateway {
  const random = options.random ?? Math.random;
  const reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  let socket: DiscordSocket | undefined;
  let sessionId: string | undefined;
  let resumeUrl: string | undefined;
  let sequence: number | null = null;
  let botUserId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInterval = 0;
  let awaitingAck = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;
  let started = false;
  let stopped = false;
  let ready = false;
  let pendingStart: { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;

  function settleStart(error?: Error): void {
    const pending = pendingStart;
    if (pending === undefined) return;
    pendingStart = undefined;
    clearTimeout(pending.timer);
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }

  function clearHeartbeat(): void {
    if (heartbeatTimer !== undefined) clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  }

  function send(current: DiscordSocket, payload: unknown): void {
    try {
      current.send(JSON.stringify(payload));
    } catch {
      // The socket closed under us; its close event drives the reconnect.
    }
  }

  /** Closes with a resumable code; the close listener schedules the reconnect. */
  function drop(current: DiscordSocket, resume: boolean): void {
    if (!resume) {
      sessionId = undefined;
      resumeUrl = undefined;
      sequence = null;
    }
    clearHeartbeat();
    try {
      current.close(RESUME_CLOSE_CODE, resume ? "resume" : "reidentify");
    } catch {
      // Already closed.
    }
  }

  function scheduleHeartbeat(current: DiscordSocket, wait: number): void {
    clearHeartbeat();
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = undefined;
      if (socket !== current || stopped) return;
      // No ACK since the last beat: the connection is a zombie. Drop it and resume.
      if (awaitingAck) return drop(current, true);
      awaitingAck = true;
      send(current, { op: 1, d: sequence });
      scheduleHeartbeat(current, heartbeatInterval);
    }, wait);
  }

  async function handshake(current: DiscordSocket): Promise<void> {
    let token: string;
    try {
      token = await options.token();
    } catch {
      return drop(current, true);
    }
    if (socket !== current || stopped) return;
    if (sessionId !== undefined && sequence !== null) {
      send(current, { op: 6, d: { token, session_id: sessionId, seq: sequence } });
    } else {
      send(current, {
        op: 2,
        d: { token, intents: options.intents, properties: { os: process.platform, browser: "prism", device: "prism" } },
      });
    }
  }

  function onFrame(current: DiscordSocket, data: unknown): void {
    if (socket !== current) return;
    const raw =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer || ArrayBuffer.isView(data)
          ? Buffer.from(data as ArrayBuffer).toString("utf8")
          : undefined;
    if (raw === undefined || Buffer.byteLength(raw, "utf8") > options.maxFrameBytes) return;
    let frame: Record<string, unknown> | undefined;
    try {
      frame = asRecord(JSON.parse(raw));
    } catch {
      return;
    }
    if (frame === undefined) return;
    switch (frame.op) {
      case 10: {
        const interval = asRecord(frame.d)?.heartbeat_interval;
        if (typeof interval !== "number" || !Number.isFinite(interval) || interval < 1 || interval > 600_000) return drop(current, true);
        heartbeatInterval = interval;
        awaitingAck = false;
        scheduleHeartbeat(current, Math.floor(interval * Math.min(Math.max(random(), 0), 1)));
        void handshake(current);
        return;
      }
      case 11:
        awaitingAck = false;
        return;
      case 1:
        send(current, { op: 1, d: sequence });
        return;
      case 7:
        return drop(current, true);
      case 9:
        return drop(current, frame.d === true);
      case 0:
        return onDispatch(frame);
      default:
        return;
    }
  }

  function onDispatch(frame: Record<string, unknown>): void {
    if (typeof frame.s === "number" && Number.isSafeInteger(frame.s) && frame.s >= 0) sequence = frame.s;
    const type = typeof frame.t === "string" ? frame.t : undefined;
    if (type === undefined) return;
    if (type === "READY") {
      const data = asRecord(frame.d);
      const id = data?.session_id;
      const url = typeof data?.resume_gateway_url === "string" ? gatewayEndpoint(data.resume_gateway_url) : undefined;
      if (typeof id === "string" && SESSION_ID_PATTERN.test(id)) sessionId = id;
      resumeUrl = url;
      const user = asRecord(data?.user)?.id;
      if (typeof user === "string" && SNOWFLAKE.test(user)) botUserId = user;
    }
    if (type === "READY" || type === "RESUMED") {
      reconnectAttempts = 0;
      ready = true;
      settleStart();
    }
    try {
      void Promise.resolve(options.onDispatch(type, frame.d)).catch(() => undefined);
    } catch {
      // A throwing dispatch handler never breaks the Gateway loop.
    }
  }

  function onClose(current: DiscordSocket, code: number | undefined): void {
    if (socket !== current) return;
    socket = undefined;
    clearHeartbeat();
    if (stopped) return;
    if (code !== undefined && FATAL_CLOSE_CODES.has(code)) {
      stopped = true;
      settleStart(new Error(`Discord Gateway refused the connection (close ${code})`));
      return;
    }
    if (code !== undefined && SESSION_CLOSE_CODES.has(code)) {
      sessionId = undefined;
      resumeUrl = undefined;
      sequence = null;
    }
    // A first connection that never reached READY reports its failure instead of retrying.
    if (!ready && pendingStart !== undefined) {
      settleStart(new Error("Discord Gateway connection failed"));
      return;
    }
    scheduleReconnect();
  }

  async function open(): Promise<void> {
    const resume = sessionId !== undefined && sequence !== null && resumeUrl !== undefined;
    let url: string | undefined;
    if (resume) {
      url = resumeUrl;
    } else {
      try {
        url = gatewayEndpoint(await options.gatewayUrl());
      } catch {
        url = undefined;
      }
    }
    if (url === undefined) throw new Error("Discord Gateway connection failed");
    if (stopped) return;
    const current = options.webSocket(url);
    socket = current;
    current.addEventListener("message", (event) => onFrame(current, event.data));
    current.addEventListener("close", (event) => onClose(current, typeof event.code === "number" ? event.code : undefined));
    current.addEventListener("error", () => {
      try {
        current.close(RESUME_CLOSE_CODE, "error");
      } catch {
        // The close event follows.
      }
    });
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== undefined) return;
    const wait = Math.min(MAX_RECONNECT_DELAY_MS, reconnectBaseMs * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open().catch(() => scheduleReconnect());
    }, wait);
  }

  return {
    async start() {
      if (stopped) throw new Error("Discord Gateway is stopped");
      if (started) throw new Error("Discord Gateway is already started");
      started = true;
      const readyPromise = new Promise<void>((resolve, reject) => {
        pendingStart = {
          resolve,
          reject,
          timer: setTimeout(() => {
            settleStart(new Error("Discord Gateway did not become ready"));
            if (socket !== undefined) drop(socket, true);
          }, readyTimeoutMs),
        };
      });
      try {
        await open();
      } catch (error) {
        settleStart(error instanceof Error ? error : new Error("Discord Gateway connection failed"));
      }
      try {
        await readyPromise;
      } catch (error) {
        stopped = true;
        clearHeartbeat();
        if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        const current = socket;
        socket = undefined;
        try {
          current?.close(1000, "start failed");
        } catch {
          // Already closed.
        }
        throw error;
      }
    },
    stop() {
      stopped = true;
      settleStart(new Error("Discord Gateway is stopped"));
      clearHeartbeat();
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      const current = socket;
      socket = undefined;
      try {
        current?.close(1000, "stopped");
      } catch {
        // Already closed.
      }
    },
    state() {
      return {
        ...(sessionId === undefined ? {} : { sessionId }),
        sequence,
        ...(botUserId === undefined ? {} : { botUserId }),
        ...(resumeUrl === undefined ? {} : { resumeUrl }),
        connected: socket !== undefined,
      };
    },
  };
}
