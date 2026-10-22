/**
 * `serveDevtools(agent, options)`: the developer inspector over one `Agent`.
 *
 * Served on `Bun.serve`. Every route reads through the public `Agent`: `inspect()`, `sessions`,
 * `session({ id }).entries()`, and `subscribe()`. This module builds no agent and reaches no kernel
 * internal. JSON bodies and SSE events pass the agent's redactor on the way out. A bearer token ref
 * guards every route, the page included, when one is set. A non-loopback bind requires one.
 */
import { type Agent, type AgentEvent, isLoopbackHostname, isSessionNotFound, type SecretRedactor } from "@arnilo/prism";
import { parseInspectorCompareBody } from "./compare.js";
import { DevtoolsError } from "./errors.js";
import { REPLAY_MAX_LIMIT, replayPage } from "./replay.js";
import { bearerMatches, type DevtoolsHostOriginOptions, hostOriginRejection, resolveDevtoolsToken } from "./security.js";
import { inspectorPageResponse, inspectorScriptResponse } from "./ui/assets.js";

export const DEVTOOLS_DEFAULT_PORT = 4311;
export const DEVTOOLS_DEFAULT_HOSTNAME = "127.0.0.1";
const SESSION_LIST_MAX_LIMIT = 200;

export interface DevtoolsOptions {
  /** Listen port. `0` picks a free one. Defaults to 4311. */
  readonly port?: number;
  /** Listen address. Defaults to `127.0.0.1`. A non-loopback address requires `token`. */
  readonly hostname?: string;
  /** Bearer token ref (`env:NAME`). Required for a non-loopback `hostname`. Checked on every route when set. */
  readonly token?: string;
  /** Allowed Host header values. Defaults to the bound loopback host:port pairs (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`). */
  readonly allowedHosts?: readonly string[];
  /** Allowed Origin header values. Defaults to the bound loopback origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`). */
  readonly allowedOrigins?: readonly string[];
}

export type ServeDevtoolsOptions = DevtoolsOptions;

export interface DevtoolsServer {
  /** The base URL the page is served from. */
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  /** Closes live event streams and the listener. */
  close(): Promise<void>;
}

interface RouteContext {
  readonly agent: Agent;
  readonly redactor: SecretRedactor | undefined;
  /** Closers for open SSE feeds, so `close()` ends them without waiting for a client. */
  readonly feeds: Set<() => void>;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

export function serveDevtools(agent: Agent, options: DevtoolsOptions = {}): DevtoolsServer {
  const hostname = options.hostname ?? DEVTOOLS_DEFAULT_HOSTNAME;
  const loopback = isLoopbackHostname(hostname);
  if (!loopback && options.token === undefined) {
    throw new DevtoolsError(
      `non-loopback hostname "${hostname}" requires a token ref (for example token: "env:PRISM_DEVTOOLS_TOKEN")`,
      "ERR_PRISM_DEVTOOLS_REMOTE_BIND",
    );
  }
  // Resolved before the listener exists, so an unset token ref fails without a socket.
  const token = resolveDevtoolsToken(options.token);
  const context: RouteContext = { agent, redactor: agent.config.redactor, feeds: new Set() };
  let gate: DevtoolsHostOriginOptions;
  const server = Bun.serve({
    hostname,
    port: options.port ?? DEVTOOLS_DEFAULT_PORT,
    fetch: (request) => handle(request, context, token, gate),
  });
  // A unix-socket server reports no hostname/port; fall back to the requested values.
  const boundHostname = server.hostname ?? hostname;
  const boundPort = server.port ?? options.port ?? DEVTOOLS_DEFAULT_PORT;
  gate = {
    allowedHosts: options.allowedHosts ?? [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`],
    allowedOrigins: options.allowedOrigins ?? [
      `http://127.0.0.1:${boundPort}`,
      `http://localhost:${boundPort}`,
      `http://[::1]:${boundPort}`,
    ],
  };
  const displayHost = boundHostname.includes(":") ? `[${boundHostname}]` : boundHostname;
  return {
    url: `http://${displayHost}:${boundPort}`,
    hostname: boundHostname,
    port: boundPort,
    async close() {
      for (const closeFeed of [...context.feeds]) closeFeed();
      context.feeds.clear();
      await server.stop(true);
    },
  };
}

async function handle(
  request: Request,
  context: RouteContext,
  token: string | undefined,
  gate: DevtoolsHostOriginOptions,
): Promise<Response> {
  const denied = hostOriginRejection(request, gate);
  if (denied) return denied;
  if (token !== undefined && !bearerMatches(request, token)) {
    return errorResponse(401, "ERR_PRISM_DEVTOOLS_UNAUTHORIZED", "Unauthorized", { "www-authenticate": 'Bearer realm="prism-devtools"' });
  }
  try {
    return await route(request, new URL(request.url), context);
  } catch (error) {
    if (isSessionNotFound(error)) return errorResponse(404, "ERR_PRISM_DEVTOOLS_NOT_FOUND", "Session not found");
    if (error instanceof DevtoolsError) return errorResponse(error.status, error.code, error.message);
    return errorResponse(500, "ERR_PRISM_DEVTOOLS", "Devtools request failed");
  }
}

async function route(request: Request, url: URL, context: RouteContext): Promise<Response> {
  const { method } = request;
  const path = url.pathname;
  if (method === "GET" && path === "/") return inspectorPageResponse();
  if (method === "GET" && path === "/assets/inspector.js") return inspectorScriptResponse();
  if (method === "GET" && path === "/api/inspect") return json(context, context.agent.inspect());
  if (method === "GET" && path === "/api/sessions") {
    return json(context, await context.agent.sessions.list(listQuery(url)));
  }
  if (method === "GET" && path === "/api/replay") {
    const session = await context.agent.session({ id: requiredParam(url, "session") });
    const cursor = url.searchParams.get("cursor") ?? undefined;
    return json(context, replayPage(await session.entries(), { cursor, limit: limitParam(url, REPLAY_MAX_LIMIT) }));
  }
  if (method === "POST" && path === "/api/compare") {
    return json(context, parseInspectorCompareBody(await request.text()));
  }
  if (method === "GET" && path === "/api/events") {
    return eventStream(context, url.searchParams.get("session"));
  }
  const match = /^\/api\/sessions\/([^/]+)(\/entries)?$/.exec(path);
  if (method === "GET" && match) {
    const id = decodeSegment(match[1]!);
    if (match[2]) {
      const opened = await context.agent.session({ id });
      return json(context, { sessionId: id, entries: await opened.entries() });
    }
    const summary = await context.agent.sessions.get(id);
    if (summary === undefined) return errorResponse(404, "ERR_PRISM_DEVTOOLS_NOT_FOUND", "Session not found");
    return json(context, summary);
  }
  return errorResponse(404, "ERR_PRISM_DEVTOOLS_NOT_FOUND", "Not found");
}

/** Every JSON body passes the agent's redactor, so no route can return a secret the agent holds. */
function json(context: RouteContext, body: unknown, status = 200): Response {
  const safe = context.redactor ? context.redactor.redact(body) : body;
  return new Response(JSON.stringify(safe), { status, headers: JSON_HEADERS });
}

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/**
 * Server-sent events: `agent` for `agent.subscribe()`, and `session` for the `?session=` session's
 * `subscribe()`. Both subscriptions open when the request arrives. A client disconnect or `close()`
 * ends them, and a failing source ends only its own feed.
 */
async function eventStream(context: RouteContext, sessionId: string | null): Promise<Response> {
  // Opens the session first, so an unknown id fails before any agent subscription exists.
  const session = sessionId === null ? undefined : await context.agent.session({ id: sessionId });
  const sources: Array<{ name: string; events: AsyncIterable<AgentEvent> }> = [{ name: "agent", events: context.agent.subscribe() }];
  // A Session's subscribers belong to that Session object. This feed sees runs started through the object
  // the route opened, and `acrossRuns` keeps it open across them. Runs on another instance of the same id are
  // not visible through the public API; the agent feed still carries `session.opened` / `session.closed`.
  if (session) sources.push({ name: "session", events: session.subscribe({ acrossRuns: true }) });
  const encoder = new TextEncoder();
  const feeds = context.feeds;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      let live = sources.length;
      const iterators = sources.map(({ name, events }) => ({ name, iterator: events[Symbol.asyncIterator]() }));
      const close = (): void => {
        if (!open) return;
        open = false;
        feeds.delete(close);
        for (const { iterator } of iterators) void iterator.return?.();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      feeds.add(close);
      controller.enqueue(encoder.encode(": connected\n\n"));
      for (const { name, iterator } of iterators) {
        void (async () => {
          try {
            for (;;) {
              const next = await iterator.next();
              if (next.done || !open) break;
              const event = context.redactor ? context.redactor.redact(next.value) : next.value;
              controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`));
            }
          } catch {
            // A failed source ends its own feed; the others keep streaming.
          } finally {
            live -= 1;
            if (live === 0) close();
          }
        })();
      }
    },
    cancel() {
      for (const closeFeed of [...feeds]) closeFeed();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

function listQuery(url: URL): { cursor?: string; limit?: number } {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = limitParam(url, SESSION_LIST_MAX_LIMIT);
  return { ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }) };
}

function limitParam(url: URL, max: number): number | undefined {
  const raw = url.searchParams.get("limit");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new DevtoolsError(`limit must be an integer from 1 to ${max}`, "ERR_PRISM_DEVTOOLS_QUERY");
  }
  return value;
}

function requiredParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new DevtoolsError(`${name} query parameter is required`, "ERR_PRISM_DEVTOOLS_QUERY");
  return value;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new DevtoolsError("malformed path segment", "ERR_PRISM_DEVTOOLS_QUERY");
  }
}
