import type { Readable, Writable } from "node:stream";
import type { JsonValue } from "../../contracts.js";
import { type JsonlItem, readJsonl } from "./jsonl.js";
import { createStdinWriter } from "./stdin.js";

export interface JsonRpcPeerOptions {
  readonly readable: Readable;
  readonly writable: Writable;
  /** Answers a server→client request. A throw becomes a JSON-RPC error response. */
  readonly onRequest?: (method: string, params: JsonValue | undefined) => Promise<JsonValue> | JsonValue;
  readonly onNotification?: (method: string, params: JsonValue | undefined) => void;
  /** Called after a method-not-found response is written; the driver decides whether to fail the run. */
  readonly onUnhandled?: (method: string) => void;
  /** Invoked after an error response is written. */
  readonly onRequestError?: (method: string, error: unknown) => void;
  /** Malformed JSON or non-object frames, for capture accounting. */
  readonly onInvalid?: (item: JsonlItem) => void;
  /** Defaults to one; excess requests receive an error without blocking response reads. */
  readonly maxConcurrentRequests?: number;
  readonly maxLineBytes?: number;
}

export interface JsonRpcPeer {
  request(method: string, params?: JsonValue): Promise<JsonValue>;
  notify(method: string, params?: JsonValue): Promise<void>;
  /** Resolves when the readable ends; rejects pending requests. */
  readonly closed: Promise<void>;
}

export class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
  }
}

type Obj = Record<string, JsonValue>;
const isObj = (value: JsonValue | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON-RPC 2.0 over JSONL. Hand written; the kernel has no runtime dependency. */
export function createJsonRpcPeer(options: JsonRpcPeerOptions): JsonRpcPeer {
  const writer = createStdinWriter(options.writable);
  const pending = new Map<string | number, { resolve: (v: JsonValue) => void; reject: (e: Error) => void }>();
  let nextId = 1;
  let active = 0;
  const concurrency = options.maxConcurrentRequests ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("maxConcurrentRequests must be a positive integer");

  const respond = (id: JsonValue, body: Obj): Promise<void> => writer.write({ jsonrpc: "2.0", id, ...body });

  const handle = async (message: Obj): Promise<void> => {
    const method = message.method;
    if (typeof method === "string") {
      const params = message.params;
      if (message.id === undefined) {
        options.onNotification?.(method, params);
        return;
      }
      if (!options.onRequest) {
        await respond(message.id, { error: { code: -32601, message: "method not found" } });
        options.onUnhandled?.(method);
        return;
      }
      try {
        await respond(message.id, { result: await options.onRequest(method, params) });
      } catch (error) {
        await respond(message.id, {
          error: {
            code: error instanceof JsonRpcError ? error.code : -32603,
            message: error instanceof Error ? error.message : "internal error",
          },
        });
        if (error instanceof JsonRpcError && error.code === -32601) options.onUnhandled?.(method);
        options.onRequestError?.(method, error);
      }
      return;
    }
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") {
      options.onInvalid?.({ kind: "value", value: message });
      return;
    }
    const waiter = pending.get(id);
    if (!waiter) {
      options.onInvalid?.({ kind: "value", value: message });
      return;
    }
    pending.delete(id);
    if (isObj(message.error)) {
      const { code, message: text } = message.error;
      waiter.reject(new JsonRpcError(typeof code === "number" ? code : -32603, typeof text === "string" ? text : "error"));
    } else waiter.resolve(message.result ?? null);
  };

  const closed = (async () => {
    try {
      for await (const item of readJsonl(options.readable, { maxLineBytes: options.maxLineBytes ?? 1_048_576 })) {
        if (item.kind !== "value" || !isObj(item.value)) {
          options.onInvalid?.(item);
          continue;
        }
        const message = item.value;
        if (typeof message.method === "string" && message.id !== undefined && concurrency > 1) {
          if (active >= concurrency) {
            const error = new JsonRpcError(-32000, "too many concurrent requests");
            await respond(message.id, { error: { code: error.code, message: error.message } });
            options.onRequestError?.(message.method, error);
            continue;
          }
          active++;
          void handle(message)
            .catch((error) => options.onRequestError?.(String(message.method), error))
            .finally(() => active--);
        } else await handle(message);
      }
    } finally {
      for (const waiter of pending.values()) waiter.reject(new Error("json-rpc peer closed"));
      pending.clear();
    }
  })();
  closed.catch(() => undefined);

  return {
    closed,
    request(method, params) {
      const id = nextId++;
      const result = new Promise<JsonValue>((resolve, reject) => pending.set(id, { resolve, reject }));
      writer.write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }).catch((error: Error) => {
        const waiter = pending.get(id);
        pending.delete(id);
        waiter?.reject(error);
      });
      return result;
    },
    notify(method, params) {
      return writer.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    },
  };
}
