import { type JsonObject, type Principal } from "@arnilo/prism";
import { isLoopbackHostname } from "@arnilo/prism/net";
import { serve } from "bun";
import { bearerMatches, resolveToken } from "../auth.js";
import { createChannel } from "../channel.js";
import { RemoteError } from "../errors.js";
import { hostOriginRejection, readBody, rejection } from "../http-gate.js";
import { type ServedAgent, type ServerState, serveConnection } from "../serve.js";
import type { RemoteTransport } from "../transport.js";

export interface NetworkTransport {
  readonly kind: "websocket" | "http";
  readonly hostname?: string;
  readonly port?: number;
  readonly allowedHosts?: readonly string[];
  readonly allowedOrigins?: readonly string[];
  readonly maxRequestBytes?: number;
  readonly token?: string;
}
export type Authenticate = (request: Request) => { principal: Principal } | undefined | Promise<{ principal: Principal } | undefined>;

export function serveNetwork(state: ServerState, options: NetworkTransport, authenticate?: Authenticate): ServedAgent {
  const hostname = options.hostname ?? "127.0.0.1";
  if (!isLoopbackHostname(hostname) && !authenticate)
    throw new RemoteError("unauthenticated_bind", "unauthenticated_bind: public binds require authenticate");
  const cap = options.maxRequestBytes ?? state.limits.maxFrameBytes;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > state.limits.maxFrameBytes) throw new RemoteError("limit", "invalid maxRequestBytes");
  const resolved = authenticate ? undefined : resolveToken(options.token);
  let token: string | undefined = typeof resolved === "string" ? resolved : undefined;
  const ready = Promise.resolve(resolved).then((value) => {
    token = value;
    if (!server && !stopped) server = start();
  });
  // Keyring resolution finishes before the listener is created.
  void ready.catch(() => {});
  type Connection = {
    transport: RemoteTransport;
    push(text: string): void;
    principal?: Principal;
    pending: Map<string | number, (response: Response) => void>;
  };
  const connections = new Map<string, Connection>();
  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let stopped = false;
  const make = (send: (frame: JsonObject) => void, shutdown: () => void, principal?: Principal): Connection => {
    let end!: () => void;
    const gone = new Promise<void>((resolve) => {
      end = resolve;
    });
    const queue = createChannel<string>(state.limits.maxQueuedEvents);
    let ended = false;
    const pending = new Map<string | number, (response: Response) => void>();
    const transport: RemoteTransport = {
      closed: gone,
      frames: () => queue,
      async send(frame) {
        if (ended) throw new RemoteError("disconnected", "connection closed");
        if ("id" in frame && !("method" in frame) && (typeof frame.id === "string" || typeof frame.id === "number")) {
          const reply = pending.get(frame.id);
          if (reply) {
            pending.delete(frame.id);
            reply(Response.json(frame));
            return;
          }
        }
        send(frame);
      },
      async close() {
        if (ended) return;
        ended = true;
        queue.end();
        for (const reply of pending.values()) reply(rejection(410, "disconnected"));
        pending.clear();
        shutdown();
        end();
      },
    };
    return {
      transport,
      pending,
      ...(principal ? { principal } : {}),
      push(text) {
        queue.push(text);
        if (queue.ended) void transport.close();
      },
    };
  };
  const attach = (id: string, connection: Connection) => {
    connections.set(id, connection);
    serveConnection(state, connection.transport, { ...(connection.principal ? { principal: connection.principal } : {}) });
    void connection.transport.closed.then(() => connections.delete(id));
  };
  let upgrades = 0;
  const start = () =>
    serve({
      hostname,
      port: options.port ?? 0,
      maxRequestBodySize: 16 * 1024 * 1024,
      async fetch(request, server) {
        const denied = hostOriginRejection(request, {
          allowedHosts: options.allowedHosts ?? [`127.0.0.1:${server.port}`, `localhost:${server.port}`, `[::1]:${server.port}`],
          allowedOrigins: options.allowedOrigins ?? [
            `http://127.0.0.1:${server.port}`,
            `http://localhost:${server.port}`,
            `http://[::1]:${server.port}`,
          ],
        });
        if (denied) return denied;
        let identity: { principal: Principal } | undefined;
        try {
          await ready;
          if (authenticate) {
            identity = await authenticate(request);
            if (
              !identity?.principal ||
              typeof identity.principal.id !== "string" ||
              !identity.principal.id ||
              typeof identity.principal.kind !== "string" ||
              !identity.principal.kind
            )
              return rejection(401, "unauthorized");
          } else if (!token || !bearerMatches(request, token)) return rejection(401, "unauthorized");
        } catch {
          return rejection(401, "unauthorized");
        }
        if (stopped) return rejection(503, "disconnected");
        const url = new URL(request.url);
        if (options.kind === "websocket") {
          if (connections.size + upgrades >= state.limits.maxConnections) return rejection(503, "busy");
          const id = crypto.randomUUID();
          upgrades++;
          if (server.upgrade(request, { data: { id, principal: identity?.principal } })) return;
          upgrades--;
          return rejection(400, "invalid_frame");
        }
        if (request.method === "GET" && url.pathname === "/events") {
          if (connections.size >= state.limits.maxConnections) return rejection(503, "busy");
          const id = crypto.randomUUID();
          let timer: ReturnType<typeof setInterval>;
          let connection: Connection;
          const body = new ReadableStream<Uint8Array>(
            {
              start(controller) {
                const write = (text: string) => {
                  if ((controller.desiredSize ?? 0) <= 0) {
                    void connection.transport.close();
                    return;
                  }
                  controller.enqueue(new TextEncoder().encode(text));
                };
                connection = make(
                  (frame) => write(`data: ${JSON.stringify(frame)}\n\n`),
                  () => {
                    clearInterval(timer);
                    try {
                      controller.close();
                    } catch {}
                  },
                  identity?.principal,
                );
                attach(id, connection);
                write(": connected\n\n");
                timer = setInterval(() => write(": keep-alive\n\n"), state.limits.keepAliveMs);
                request.signal.addEventListener(
                  "abort",
                  () => {
                    void connection.transport.close();
                  },
                  { once: true },
                );
              },
              cancel() {
                return connection.transport.close();
              },
            },
            { highWaterMark: state.limits.maxQueuedEvents },
          );
          return new Response(body, {
            headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-prism-connection": id },
          });
        }
        if (request.method === "POST" && url.pathname === "/rpc") {
          let text: string;
          try {
            text = await readBody(request, cap);
          } catch {
            return rejection(413, "body_too_large");
          }
          const connection = connections.get(url.searchParams.get("connection") ?? "");
          if (!connection) return rejection(404, "disconnected");
          // A connection id is not authentication: every POST must have the same principal.
          if (connection.principal?.id !== identity?.principal.id || connection.principal?.kind !== identity?.principal.kind)
            return rejection(401, "unauthorized");
          let frame: JsonObject;
          try {
            frame = JSON.parse(text);
          } catch {
            connection.push(text);
            return new Response(null, { status: 202 });
          }
          if (
            frame &&
            typeof frame === "object" &&
            !Array.isArray(frame) &&
            "method" in frame &&
            (typeof frame.id === "string" || typeof frame.id === "number")
          ) {
            if (connection.pending.has(frame.id) || connection.pending.size >= state.limits.maxPendingRequests)
              return rejection(409, "busy");
            return new Promise<Response>((resolve) => {
              connection.pending.set(frame.id as string | number, resolve);
              connection.push(text);
            });
          }
          connection.push(text);
          return new Response(null, { status: 202 });
        }
        return rejection(404, "not_found");
      },
      websocket: {
        data: {} as { id: string; principal: Principal | undefined },
        maxPayloadLength: state.limits.maxFrameBytes,
        backpressureLimit: state.limits.maxFrameBytes,
        closeOnBackpressureLimit: true,
        idleTimeout: Math.max(1, Math.ceil(state.limits.keepAliveMs / 1000)),
        open(ws) {
          upgrades--;
          const connection = make(
            (frame) => {
              if (ws.send(JSON.stringify(frame)) <= 0) void connection.transport.close();
            },
            () => ws.close(),
            ws.data.principal,
          );
          attach(ws.data.id, connection);
        },
        message(ws, message) {
          connections.get(ws.data.id)?.push(typeof message === "string" ? message : message.toString());
        },
        close(ws) {
          void connections.get(ws.data.id)?.transport.close();
        },
      },
    });
  let server: ReturnType<typeof start> | undefined = resolved instanceof Promise ? undefined : start();
  return {
    endpointId: state.endpointId,
    closed,
    ready,
    get token() {
      return token;
    },
    get url() {
      return server
        ? `${options.kind === "websocket" ? "ws" : "http"}://${hostname.includes(":") ? `[${hostname}]` : hostname}:${server.port}`
        : undefined;
    },
    async close() {
      stopped = true;
      await Promise.all([...connections.values()].map((c) => c.transport.close()));
      await server?.stop(true);
      finish();
    },
  };
}
