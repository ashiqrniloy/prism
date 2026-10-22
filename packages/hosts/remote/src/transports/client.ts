import type { JsonObject } from "@arnilo/prism";
import { createChannel } from "../channel.js";
import { RemoteError } from "../errors.js";
import { readBody } from "../http-gate.js";
import { type RemoteLimitOptions, resolveRemoteLimits } from "../limits.js";
import { readSseFrames } from "../sse.js";
import type { RemoteTransport } from "../transport.js";

export interface NetworkEndpoint {
  readonly kind: "websocket" | "http";
  readonly url: string;
  /** Client bearer value; the server accepts only secret refs in its configuration. */
  readonly token?: string;
}

export async function connectNetwork(endpoint: NetworkEndpoint, options?: RemoteLimitOptions): Promise<RemoteTransport> {
  const limits = resolveRemoteLimits(options);
  const queue = createChannel<string>(limits.maxQueuedEvents);
  const abort = new AbortController();
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let stopped = false;
  let shutdown = () => {};
  const close = async () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    shutdown();
    queue.end();
    finish();
  };
  const push = (text: string) => {
    if (Buffer.byteLength(text) > limits.maxFrameBytes) {
      void close();
      return;
    }
    queue.push(text);
    if (queue.ended) void close();
  };
  const headers: Record<string, string> = endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {};
  let send: (frame: JsonObject) => Promise<void>;
  try {
    const url = new URL(endpoint.url);
    if (url.username || url.password || url.search || url.hash) throw new Error();
    if (endpoint.kind === "websocket") {
      if (!["ws:", "wss:"].includes(url.protocol)) throw new Error();
      const HeaderWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
      const ws = new HeaderWebSocket(url.href, { headers });
      shutdown = () => ws.close();
      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          void close();
          return;
        }
        push(event.data);
      });
      ws.addEventListener("close", () => {
        void close();
      });
      ws.addEventListener("error", () => {
        void close();
      });
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error()), { once: true });
        ws.addEventListener("close", () => reject(new Error()), { once: true });
      });
      send = async (frame) => {
        if (stopped || ws.readyState !== WebSocket.OPEN) throw new RemoteError("disconnected", "connection closed");
        ws.send(JSON.stringify(frame));
      };
    } else {
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      const response = await fetch(new URL("/events", url), { headers, signal: abort.signal, redirect: "error" });
      const id = response.headers.get("x-prism-connection");
      if (!response.ok || !response.body || !id) throw new Error();
      const body = response.body;
      void (async () => {
        try {
          for await (const text of readSseFrames(body, limits.maxFrameBytes)) push(text);
        } catch {
        } finally {
          await close();
        }
      })();
      const rpc = new URL("/rpc", url);
      rpc.searchParams.set("connection", id);
      send = async (frame) => {
        // Do not await a request's POST response here: the dispatcher must keep reading SSE.
        void (async () => {
          try {
            const reply = await fetch(rpc, {
              method: "POST",
              headers,
              body: JSON.stringify(frame),
              signal: abort.signal,
              redirect: "error",
            });
            if (!reply.ok) throw new Error();
            if (reply.status !== 202) {
              push(await readBody(new Request("http://local", { method: "POST", body: reply.body }), limits.maxFrameBytes));
            }
          } catch {
            await close();
          }
        })();
      };
    }
  } catch {
    await close();
    throw new RemoteError("disconnected", "remote connection failed");
  }
  return {
    closed,
    close,
    frames: () => queue,
    async send(frame) {
      if (stopped) throw new RemoteError("disconnected", "connection closed");
      if (Buffer.byteLength(JSON.stringify(frame)) > limits.maxFrameBytes)
        throw new RemoteError("frame_too_large", "outbound frame exceeds limit");
      await send(frame);
    },
  };
}
