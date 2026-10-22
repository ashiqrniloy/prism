import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type AddressInfo, createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ExternalActivity, ExternalAskSupport, ExternalToolRequest, JsonValue, RunController, RunEndResult } from "../index.js";
import { DriverError } from "./errors.js";
import { type JsonlItem, readJsonl } from "./process/jsonl.js";
import {
  isRelayAnswer,
  RELAY_DESCRIPTOR_FILE,
  RELAY_MAX_BODY_BYTES,
  RELAY_MAX_HEADER_BYTES,
  RELAY_SOCKET_FILE,
  type RelayAnswer,
  type RelayChannel,
  type RelayDescriptor,
  type RelayMcpFrame,
} from "./relay-protocol.js";

/** What the broker dispatches. `HookCodec.decode` produces it from the vendor's hook payload. */
export type HookEvent =
  | { readonly kind: "pre-tool"; readonly request: ExternalToolRequest }
  | { readonly kind: "stop"; readonly reason?: string }
  | { readonly kind: "observe"; readonly activity: ExternalActivity };

/** A gate answer. A deny carries a `message` the codec can print verbatim, so `approval_pending` never reads as a generic deny. */
export type HookDecision =
  | { readonly allow: true; readonly args?: JsonValue }
  | { readonly allow: false; readonly reason: string; readonly message: string }
  | { readonly respond: JsonValue };

/** What the broker hands `HookCodec.encode`. */
export type HookAnswer = HookDecision | { readonly end: RunEndResult } | { readonly observed: true };

/** The vendor's wire format for hooks. A throw from either side, or a malformed answer, fails closed. */
export interface HookCodec {
  decode(stdin: string): HookEvent;
  encode(answer: HookAnswer): RelayAnswer;
}

export interface CallbackBrokerOptions {
  /** The run directory. The broker writes `relay.json` and `relay.sock` into it. */
  readonly runDir: string;
  readonly hookCodec: HookCodec;
  /** Answered whenever the broker cannot answer: a throw, a timeout, a malformed answer, or a closed broker. */
  readonly failClosed: RelayAnswer;
  /** The bound on one callback. The relay enforces the same bound on its side. */
  readonly timeoutMs: number;
  /** What the vendor can accept back from `ask`. Both default to unsupported. */
  readonly askSupport?: ExternalAskSupport;
  /** Largest request body or MCP line. Default 1 MiB. */
  readonly maxBodyBytes?: number;
}

/** Serves MCP requests. Phase 14's `serveTools` plugs its web handler in here. */
export type McpRouteHandler = (request: Request) => Promise<Response>;

export interface CallbackBroker {
  /** Loopback HTTP base URL. `POST /hook` and `POST /mcp` take the bearer token. */
  readonly url: string;
  /**
   * Per-run bearer token for the HTTP listener. Hand it to the vendor through the driver's own config. It is
   * never written to the relay descriptor, events, `inspect()`, or errors.
   */
  readonly token: string;
  /** The per-run Unix socket `prism relay` connects to. */
  readonly socketPath: string;
  /** Registers the handler for a route, or removes it when `handler` is `undefined`. A later registration replaces the earlier one. */
  route(name: "mcp", handler: McpRouteHandler | undefined): void;
  /** Stops listening, drops open connections, and refuses later callbacks. Idempotent. */
  close(): Promise<void>;
}

/** `sun_path` is 108 bytes on Linux; keep room for the terminator. */
const UNIX_SOCKET_PATH_MAX = 103;

/** Starts a per-run callback broker and writes the relay descriptor before it returns. */
export async function createCallbackBroker(run: RunController, options: CallbackBrokerOptions): Promise<CallbackBroker> {
  if (!isRelayAnswer(options.failClosed)) {
    throw new DriverError("driver_definition_invalid", "failClosed needs an integer exitCode from 0 to 255 and a string stdout");
  }
  const maxBytes = options.maxBodyBytes ?? RELAY_MAX_BODY_BYTES;
  const token = randomBytes(32).toString("hex");
  const socketPath = join(options.runDir, RELAY_SOCKET_FILE);
  if (Buffer.byteLength(socketPath) > UNIX_SOCKET_PATH_MAX) {
    throw new DriverError("broker_unavailable", "the run directory path is too long for a Unix socket");
  }
  await mkdir(options.runDir, { recursive: true, mode: 0o700 });

  const failClosed: RelayAnswer = { exitCode: options.failClosed.exitCode, stdout: options.failClosed.stdout };
  const routes = new Map<"mcp", McpRouteHandler>();
  const connections = new Set<Socket>();
  let closed = false;
  let closing: Promise<void> | undefined;

  const withTimeout = <T>(work: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("callback timed out")), options.timeoutMs);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });

  const dispatch = async (event: HookEvent): Promise<HookAnswer> => {
    if (event.kind === "stop") return { end: await run.end() };
    if (event.kind === "observe") {
      await run.observe(event.activity);
      return { observed: true };
    }
    const decision = await run.ask(event.request, options.askSupport);
    if ("allow" in decision && decision.allow === false) {
      // A pending approval suspends the run, so no further callback can be answered on this run.
      if (decision.reason === "approval_pending") closed = true;
      return { allow: false, reason: decision.reason, message: denyMessage(decision.reason) };
    }
    return decision;
  };

  /** Decode, dispatch, encode. Every failure answers the descriptor's fail-closed response. */
  const answerHook = async (stdin: string): Promise<RelayAnswer> => {
    if (closed) return failClosed;
    try {
      const answer = await withTimeout(dispatch(options.hookCodec.decode(stdin)));
      const encoded = options.hookCodec.encode(answer);
      return isRelayAnswer(encoded) ? encoded : failClosed;
    } catch {
      return failClosed;
    }
  };

  /** One MCP message through the route. A message with no `id` is a notification and gets no frame. */
  const answerMcp = async (item: JsonlItem): Promise<RelayMcpFrame | undefined> => {
    if (item.kind === "invalid") return { status: 400, body: rpcError(null, -32700, "Parse error") };
    const id = isRecord(item.value) && "id" in item.value ? (item.value.id as JsonValue) : undefined;
    const reply = (status: number, code: number, message: string): RelayMcpFrame | undefined =>
      id === undefined ? undefined : { status, body: rpcError(id, code, message) };
    const handler = routes.get("mcp");
    if (closed) return reply(503, -32000, "the broker is closed");
    if (handler === undefined) return reply(503, -32601, "no MCP route is registered");
    try {
      const response = await handler(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.value),
        }),
      );
      // JSON-RPC: a server never replies to a notification, whatever the handler returned.
      const body = await response.text();
      return id === undefined || body === "" ? undefined : { status: response.status, body };
    } catch {
      return reply(500, -32603, "internal error");
    }
  };

  const serveSocket = async (socket: Socket): Promise<void> => {
    // Read through a pass-through: iterating the socket itself destroys it when the request ends, and the answer
    // must still be written on it.
    const input = new PassThrough();
    socket.pipe(input);
    socket.once("error", () => input.destroy());
    try {
      const { channel, rest } = await splitHeader(input, RELAY_MAX_HEADER_BYTES);
      if (channel === "hook") {
        const stdin = await readAllText(rest, maxBytes);
        socket.end(`${JSON.stringify(stdin === undefined ? failClosed : await answerHook(stdin))}\n`);
        return;
      }
      const inflight = new Set<Promise<void>>();
      for await (const item of readJsonl(rest, { maxLineBytes: maxBytes })) {
        const task = answerMcp(item).then((frame) => {
          if (frame !== undefined && !socket.destroyed) socket.write(`${JSON.stringify(frame)}\n`);
        });
        inflight.add(task);
        void task.finally(() => inflight.delete(task));
      }
      await Promise.all(inflight);
      socket.end();
    } catch {
      socket.destroy();
    }
  };

  const serveHttp = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body = ""): void => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    };
    try {
      if (request.headers.origin !== undefined) return send(403);
      if (!bearerMatches(request.headers.authorization, token)) return send(401);
      if (closed) return send(503, rpcError(null, -32000, "the broker is closed"));
      if (request.method !== "POST") return send(405);
      const body = await readRequestText(request, maxBytes);
      if (body === undefined) return send(413);
      if (request.url === "/hook") return send(200, JSON.stringify(await answerHook(body)));
      if (request.url === "/mcp") {
        const frame = await answerMcp(parseLine(body));
        return frame === undefined ? send(202) : send(frame.status, frame.body);
      }
      send(404);
    } catch {
      send(500);
    }
  };

  const httpServer: HttpServer = createHttpServer((request, response) => void serveHttp(request, response));
  // Half-open: the relay closes its write side after the request, and the answer must still go out on it.
  const socketServer: NetServer = createNetServer({ allowHalfOpen: true }, (socket) => void serveSocket(socket));
  for (const server of [httpServer, socketServer]) {
    server.on("connection", (connection: Socket) => {
      connections.add(connection);
      connection.on("close", () => connections.delete(connection));
    });
  }

  await rm(socketPath, { force: true });
  try {
    await listenOn(socketServer, socketPath);
    await chmod(socketPath, 0o600);
    await listenOn(httpServer, 0, "127.0.0.1");
  } catch (error) {
    await Promise.all([closeServer(socketServer), closeServer(httpServer)]);
    throw new DriverError("broker_unavailable", `the callback broker could not listen: ${(error as Error).message}`);
  }
  const { port } = httpServer.address() as AddressInfo;

  const descriptor: RelayDescriptor = { version: 1, socket: socketPath, timeoutMs: options.timeoutMs, failClosed };
  await writeFile(join(options.runDir, RELAY_DESCRIPTOR_FILE), JSON.stringify(descriptor), { mode: 0o600 });

  const close = (): Promise<void> => {
    closing ??= (async () => {
      closed = true;
      for (const connection of connections) connection.destroy();
      await Promise.all([closeServer(httpServer), closeServer(socketServer)]);
      await rm(socketPath, { force: true });
    })();
    return closing;
  };
  run.signal.addEventListener("abort", () => void close(), { once: true });

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    socketPath,
    route(name, handler) {
      if (handler === undefined) routes.delete(name);
      else routes.set(name, handler);
    },
    close,
  };
}

const DENY_MESSAGES: Readonly<Record<string, string>> = {
  approval_pending: "approval is pending; the run is suspended until a decision is recorded, so do not retry this call",
  non_interactive: "no interactive approver is available; the call was denied",
};

function denyMessage(reason: string): string {
  return DENY_MESSAGES[reason] ?? `the call was denied (${reason})`;
}

function rpcError(id: JsonValue | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function parseLine(text: string): JsonlItem {
  try {
    return { kind: "value", value: JSON.parse(text) as JsonValue };
  } catch {
    return { kind: "invalid", raw: text.slice(0, 256) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bearerMatches(header: string | undefined, token: string): boolean {
  if (header === undefined) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Reads the first line as the channel header; the rest of the stream is handed back untouched. */
async function splitHeader(
  source: AsyncIterable<Buffer>,
  maxBytes: number,
): Promise<{ channel: RelayChannel; rest: AsyncIterable<Buffer> }> {
  const iterator = source[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error("no channel header");
    head = Buffer.concat([head, next.value]);
    const newline = head.indexOf(0x0a);
    if (newline !== -1) {
      const header: unknown = JSON.parse(head.subarray(0, newline).toString("utf8"));
      const channel = isRecord(header) ? header.channel : undefined;
      if (channel !== "hook" && channel !== "mcp") throw new Error("unknown channel");
      return { channel, rest: prepend(head.subarray(newline + 1), iterator) };
    }
    if (head.length > maxBytes) throw new Error("channel header too long");
  }
}

async function* prepend(first: Buffer, iterator: AsyncIterator<Buffer>): AsyncGenerator<Buffer> {
  if (first.length > 0) yield first;
  for (;;) {
    const next = await iterator.next();
    if (next.done) return;
    yield next.value;
  }
}

/** The whole stream as text, or `undefined` when it runs past `maxBytes`. */
async function readAllText(source: AsyncIterable<Buffer>, maxBytes: number): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    total += chunk.length;
    if (total > maxBytes) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readRequestText(request: IncomingMessage, maxBytes: number): Promise<string | undefined> {
  return readAllText(request as AsyncIterable<Buffer>, maxBytes);
}

function listenOn(server: NetServer | HttpServer, ...target: [string] | [number, string]): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    const ready = (): void => {
      server.off("error", onError);
      resolve();
    };
    if (target.length === 1) (server as NetServer).listen(target[0], ready);
    else (server as NetServer).listen(target[0], target[1], ready);
  });
}

function closeServer(server: NetServer | HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
