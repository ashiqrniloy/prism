import type { JsonObject, JsonValue } from "@arnilo/prism";
import { isRemoteErrorCode, jsonRpcCodeOf, RemoteError, type RemoteErrorCode } from "./errors.js";
import { type RemoteLimitOptions, resolveRemoteLimits } from "./limits.js";
import {
  type InitializeParams,
  type InitializeResult,
  isSupportedProtocol,
  knownCapabilities,
  REMOTE_PROTOCOL,
  type RemoteCapabilities,
} from "./protocol.js";
import type { RemoteTransport } from "./transport.js";

export type RemoteHandler = (params: JsonObject, context: DispatcherContext) => Promise<JsonValue | undefined> | JsonValue | undefined;

export type RemoteNotificationHandler = (params: JsonObject) => void;

export interface DispatcherContext {
  /** Capabilities both sides declared and this protocol knows. Empty before `initialize`. */
  readonly capabilities: RemoteCapabilities;
}

export interface DispatcherOptions {
  readonly transport: RemoteTransport;
  /** A server refuses every request except `initialize` until one succeeds. */
  readonly role: "client" | "server";
  /** Capabilities this side offers. */
  readonly capabilities?: RemoteCapabilities;
  readonly limits?: RemoteLimitOptions;
  /** Server only: builds the `initialize` result (the dispatcher adds `protocol` and `capabilities`). */
  readonly onInitialize?: (
    params: InitializeParams,
    negotiated: RemoteCapabilities,
  ) => Promise<Omit<InitializeResult, "protocol" | "capabilities">> | Omit<InitializeResult, "protocol" | "capabilities">;
  readonly requests?: Readonly<Record<string, RemoteHandler>>;
  readonly notifications?: Readonly<Record<string, RemoteNotificationHandler>>;
}

export interface Dispatcher {
  /** Sends a request and resolves with its result. Rejects with `RemoteError`. */
  request(method: string, params?: JsonObject): Promise<JsonValue>;
  notify(method: string, params?: JsonObject): Promise<void>;
  /** Client side: negotiates `prism.remote/1` and returns the server's result. */
  initialize(): Promise<InitializeResult>;
  readonly capabilities: RemoteCapabilities;
  readonly initialized: boolean;
  close(reason?: string): Promise<void>;
  readonly closed: Promise<void>;
}

interface Pending {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
}

export function createDispatcher(options: DispatcherOptions): Dispatcher {
  const { transport, role } = options;
  const limits = resolveRemoteLimits(options.limits);
  const offered = knownCapabilities(options.capabilities);
  const requests = options.requests ?? {};
  const notifications = options.notifications ?? {};
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let inFlight = 0;
  let negotiated: RemoteCapabilities = {};
  let initialized = false;
  let ended = false;

  const failPending = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };

  const send = async (frame: JsonObject): Promise<void> => {
    try {
      await transport.send(frame);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      throw new RemoteError("disconnected", "transport send failed");
    }
  };

  const sendError = async (id: JsonValue, code: RemoteErrorCode, message: string, data?: JsonObject) => {
    await send({ jsonrpc: "2.0", id, error: { code: jsonRpcCodeOf(code), message, data: { code, ...data } } });
  };

  const context = (): DispatcherContext => ({ capabilities: negotiated });

  async function handleRequest(id: JsonValue, method: string, params: JsonObject): Promise<void> {
    if (inFlight >= limits.maxConcurrentRequests) {
      await sendError(id, "busy", `more than ${limits.maxConcurrentRequests} concurrent requests`).catch(() => {});
      return;
    }
    inFlight++;
    try {
      if (method === "initialize" && role === "server") {
        await handleInitialize(id, params);
        return;
      }
      if (role === "server" && !initialized) {
        await sendError(id, "not_initialized", "initialize must succeed before other calls");
        return;
      }
      const handler = Object.hasOwn(requests, method) ? requests[method] : undefined;
      if (!handler) {
        await sendError(id, "method_not_found", "unknown method");
        return;
      }
      const result = await handler(params, context());
      await send({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (error) {
      await respondError(id, error);
    } finally {
      inFlight--;
    }
  }

  async function handleInitialize(id: JsonValue, params: JsonObject): Promise<void> {
    if (!isSupportedProtocol(params.protocol)) {
      await sendError(id, "protocol_unsupported", `supported protocol: ${REMOTE_PROTOCOL}`, { supported: REMOTE_PROTOCOL });
      return;
    }
    const peer = knownCapabilities(params.capabilities);
    const agreed: Record<string, boolean> = {};
    for (const name of Object.keys(peer)) if ((offered as Record<string, boolean | undefined>)[name]) agreed[name] = true;
    const body = await options.onInitialize?.(params as unknown as InitializeParams, agreed as RemoteCapabilities);
    negotiated = agreed as RemoteCapabilities;
    initialized = true;
    await send({
      jsonrpc: "2.0",
      id,
      result: { ...(body as unknown as JsonObject | undefined), protocol: REMOTE_PROTOCOL, capabilities: agreed },
    });
  }

  async function respondError(id: JsonValue, error: unknown): Promise<void> {
    try {
      if (error instanceof RemoteError) await sendError(id, error.code, error.message);
      else {
        const message = error instanceof Error ? error.message.slice(0, 500) : "request failed";
        const code = (error as { code?: unknown } | null)?.code;
        await sendError(id, "internal_error", message, typeof code === "string" ? { cause: code.slice(0, 100) } : undefined);
      }
    } catch {
      // The transport is gone; the peer sees the disconnect.
    }
  }

  function handleResponse(frame: JsonObject): void {
    const id = frame.id;
    if (typeof id !== "number") return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    const failure = frame.error;
    if (failure !== undefined && failure !== null && typeof failure === "object" && !Array.isArray(failure)) {
      const body = failure as JsonObject;
      const data = body.data;
      const code = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as JsonObject).code : undefined;
      entry.reject(
        new RemoteError(
          isRemoteErrorCode(code) ? code : "internal_error",
          typeof body.message === "string" ? body.message : "remote error",
        ),
      );
      return;
    }
    entry.resolve((frame.result ?? null) as JsonValue);
  }

  const reject = (id: JsonValue, code: RemoteErrorCode, message: string, data?: JsonObject) =>
    sendError(id, code, message, data).catch(() => {});

  async function onFrame(text: string): Promise<void> {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > limits.maxFrameBytes) {
      await reject(null, "frame_too_large", `frame exceeds ${limits.maxFrameBytes} bytes`, { bytes });
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      await send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error", data: { code: "invalid_frame", bytes } },
      }).catch(() => {});
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value) || (value as JsonObject).jsonrpc !== "2.0") {
      await reject(null, "invalid_frame", "frame is not a JSON-RPC 2.0 object", { bytes });
      return;
    }
    const frame = value as JsonObject;
    const params = frame.params;
    const isObject = params !== null && typeof params === "object" && !Array.isArray(params);
    const object: JsonObject = isObject ? (params as JsonObject) : {};
    if (typeof frame.method === "string") {
      if (frame.id === undefined || frame.id === null) {
        if ((params === undefined || isObject) && Object.hasOwn(notifications, frame.method)) notifications[frame.method]?.(object);
        return;
      }
      if (typeof frame.id !== "string" && typeof frame.id !== "number") {
        await reject(null, "invalid_frame", "request id must be a string or number");
        return;
      }
      if (params !== undefined && !isObject) {
        await reject(frame.id, "invalid_params", "params must be an object");
        return;
      }
      // Handlers run concurrently; the read loop never waits on one.
      void handleRequest(frame.id, frame.method, object);
      return;
    }
    if (frame.result !== undefined || frame.error !== undefined) {
      handleResponse(frame);
      return;
    }
    await reject(null, "invalid_frame", "frame has no method, result, or error", { bytes });
  }

  async function loop(): Promise<void> {
    try {
      for await (const item of transport.frames()) {
        if (typeof item === "string") await onFrame(item);
        else await reject(null, "frame_too_large", `frame exceeds ${limits.maxFrameBytes} bytes`);
      }
    } catch {
      // A broken transport ends the loop like a clean close.
    } finally {
      ended = true;
      failPending(new RemoteError("disconnected", "connection closed"));
      await transport.close().catch(() => {});
    }
  }
  void loop();

  const request = async (method: string, params: JsonObject = {}): Promise<JsonValue> => {
    if (ended) throw new RemoteError("disconnected", "connection closed");
    if (pending.size >= limits.maxPendingRequests) throw new RemoteError("busy", `more than ${limits.maxPendingRequests} pending requests`);
    const id = nextId++;
    const result = new Promise<JsonValue>((resolve, rejectPending) => pending.set(id, { resolve, reject: rejectPending }));
    try {
      await send({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      pending.delete(id);
      throw error;
    }
    return result;
  };

  return {
    request,
    async notify(method, params = {}) {
      if (ended) throw new RemoteError("disconnected", "connection closed");
      await send({ jsonrpc: "2.0", method, params });
    },
    async initialize() {
      const result = (await request("initialize", {
        protocol: REMOTE_PROTOCOL,
        capabilities: offered as JsonObject,
      })) as unknown as InitializeResult;
      if (!isSupportedProtocol(result?.protocol)) throw new RemoteError("protocol_unsupported", `supported protocol: ${REMOTE_PROTOCOL}`);
      negotiated = knownCapabilities(result.capabilities);
      initialized = true;
      return result;
    },
    get capabilities() {
      return negotiated;
    },
    get initialized() {
      return initialized;
    },
    async close(reason) {
      ended = true;
      failPending(new RemoteError("disconnected", "connection closed"));
      await transport.close(reason);
    },
    closed: transport.closed,
  };
}
