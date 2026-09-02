/**
 * @arnilo/prism-coding-tools/dev — loopback-only development inspector.
 *
 * Composition, not runtime (plan 040): every capability is an existing public
 * seam consumed verbatim. This module adds zero core primitives and imports
 * no core internals; it owns only the loopback bind policy, the small
 * node:http ⇄ Web Request bridge, and the data-defined inspector route table
 * (`server.ts`) adapting to the server seam. The served UI page lands with
 * Task 3 on the same routes.
 *
 * HTTP surface (Task 2):
 * - `POST /prompt` — runs the host agent through the server handler's direct
 *   run route; response is the handler's own run result JSON.
 * - `GET /events?runId=…` — durable SSE of normalized events with
 *   `Last-Event-ID` reconnect (handled by the server seam).
 * - `GET /runs/:id/replay?cursor=…` — paged replay of a stored run from the
 *   durable `AgentEventSource` without re-execution.
 * - `POST /runs/:runId/decisions/:decisionId` — resumes or denies one
 *   suspended approval; body `{ outcome, expectedVersion? }`. Validation is
 *   core's own fail-closed boundary (unknown discriminants rejected before
 *   any state write — 0.2.0 regression guard).
 *
 * Seams consumed (exact public exports):
 * - `@arnilo/prism-server`: `createPrismHandler` (direct + SSE agent routes,
 *   durable events, agent resume), `createPrismAgentEventReplay` (paged
 *   replay), `PrismAgentExposure` / `PrismAgentEventResolutionInput` /
 *   `PrismRequestHandler` / `PrismServerError` / limits types.
 * - `@arnilo/prism` (peer): `createAgentRunLifecycle` (durable status/resume
 *   capability over host checkpoints), `AgentEventSource` `page`/`subscribe`
 *   contract, `Agent`/`AgentRunRef`/`SecretRedactor`/`CheckpointStore` types,
 *   and the `isLoopbackAddress`/`isLoopbackHostname` bind guards.
 * - `@arnilo/prism-ag-ui/renderer`: event projection for the UI (Task 3; peer
 *   declared now so the export allow-list is stable).
 * - Run-ledger records (`RunRecord`/`AgentEventRecord`/`ToolCallRecord`/
 *   `UsageRecord`) reach the inspector only through the seams above — the
 *   package never touches a ledger directly.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  type Agent,
  type AgentEventSource,
  type AgentRunRef,
  type CheckpointStore,
  createAgentRunLifecycle,
  isLoopbackAddress,
  isLoopbackHostname,
  type SecretRedactor,
  trimTrailingSlashes,
} from "@arnilo/prism";
import {
  createPrismAgentEventReplay,
  createPrismHandler,
  type PrismAgentEventResolutionInput,
  type PrismAgentExposure,
  type PrismRequestHandler,
  type PrismServerAuthorization,
  type PrismServerAuthorizer,
  type PrismServerLimits,
} from "@arnilo/prism-core/runtime/server";
import { AGENT_CAPABILITY_ID, createDevRouter } from "./server.js";

/** Typed request body of the decision endpoint (re-exported for typed hosts). */
export type { DevDecisionOutcome, DevDecisionRequest } from "./server.js";

/** Error thrown when the inspector refuses its configuration (fail closed). */
export class DevInspectorError extends Error {
  constructor(
    message: string,
    readonly code = "ERR_PRISM_DEV_INSPECTOR",
  ) {
    super(message);
    this.name = "DevInspectorError";
  }
}

/** Host opt-in for a non-loopback bind; must resolve `true` or `listen()` refuses. */
export type DevInspectorRemoteAuthorize = () => boolean | Promise<boolean>;

export interface CreatePrismDevInspectorOptions {
  /** Host-built agent (mock or provider-backed). Never constructed here. */
  readonly agent: Agent;
  /**
   * Optional durable `AgentEventSource` for replay/reconnect. Wires the
   * server's durable agent-event routes (`GET …/events` with `Last-Event-ID`),
   * the paged replay endpoint, and requires `resolveRun`.
   */
  readonly eventSource?: AgentEventSource;
  /** Required with `eventSource`: resolves a public run selector to internal IDs. */
  readonly resolveRun?: (input: PrismAgentEventResolutionInput) => AgentRunRef | undefined | Promise<AgentRunRef | undefined>;
  /**
   * Host checkpoint store backing the agent's `runState`; wiring it enables
   * the durable status/resume capability (HITL decision endpoint). The store
   * is host-owned — the inspector only composes the core lifecycle seam over
   * the host's own agent, never its own.
   */
  readonly checkpoints?: CheckpointStore;
  /** Definition revision declared for the lifecycle resolve; default `"1"`. */
  readonly definitionRevision?: string;
  /**
   * Optional per-operation authorizer. Default: single local user bound to the
   * loopback bind; every operation is approved with local ownership. A
   * non-loopback bind must supply a real authorizer.
   */
  readonly authorize?: PrismServerAuthorizer;
  /** Bind host. Must be loopback unless `remoteAuthorize` resolves `true`. Default `127.0.0.1`. */
  readonly host?: string;
  /** Default `4311`; `0` picks an ephemeral port. */
  readonly port?: number;
  /** Explicit opt-in for a non-loopback bind; consulted once by `listen()`. */
  readonly remoteAuthorize?: DevInspectorRemoteAuthorize;
  /** Host redactor; forwarded to the server handler so rendered payloads stay redacted. */
  readonly redactor?: SecretRedactor;
  readonly limits?: PrismServerLimits;
  readonly basePath?: string;
}

export interface PrismDevInspector {
  /** The composed server handler (direct + SSE agent routes, durable events when wired). */
  readonly handler: PrismRequestHandler;
  /** Base URL once listening (base path included). */
  readonly url: string;
  /** Host actually bound. */
  readonly host: string;
  /** Port actually bound. */
  readonly port: number;
  /** Opens the listener. The handler itself stays inert — no listener starts on import. */
  listen(): Promise<void>;
  /** Closes the listener. Owned in-flight work aborts via the server seam's own semantics. */
  close(): Promise<void>;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4311;

function isLoopbackHost(host: string): boolean {
  return isLoopbackHostname(host) || isLoopbackAddress(host);
}

// Single local user: the inspector serves exactly the host's own machine.
// Non-loopback binds cannot use this and must pass a real authorizer.
// tenantId is set so the durable event routes (SSE + replay) pass the source
// seam's ownership scoping with the default authorizer.
const LOCAL_USER = "local";

function defaultLoopbackAuthorize(): { ownership: { tenantId: string; userId: string } } {
  return { ownership: { tenantId: LOCAL_USER, userId: LOCAL_USER } };
}

/**
 * Composition-only: validate options, wire the host's agent into
 * `createPrismHandler`, and return a loopback-guarded listener exposing the
 * data-defined inspector routes over the same handler. No agent, session, or
 * provider is constructed here — the host owns its own agent.
 */
export function createPrismDevInspector(options: CreatePrismDevInspectorOptions): PrismDevInspector {
  const host = options.host ?? DEFAULT_HOST;
  if (!options.agent) throw new DevInspectorError("agent is required");
  if (options.eventSource && !options.resolveRun) {
    throw new DevInspectorError("eventSource requires resolveRun (public run id → internal session/run ids)");
  }
  if (!isLoopbackHost(host)) {
    if (!options.remoteAuthorize) {
      throw new DevInspectorError(
        `non-loopback host "${host}" refused; supply remoteAuthorize to opt in explicitly`,
        "ERR_PRISM_DEV_REMOTE_BIND",
      );
    }
    if (!options.authorize) {
      throw new DevInspectorError(
        `non-loopback host "${host}" requires a real authorize callback; the single-local-user default is loopback-only`,
        "ERR_PRISM_DEV_REMOTE_BIND",
      );
    }
  }
  const basePath = normalizeBasePath(options.basePath);
  const authorizer: PrismServerAuthorizer = options.authorize ?? defaultLoopbackAuthorize;

  // Capability id: the lifecycle seam asserts `state.agentId === capabilityId`,
  // so both exposure bags must key the host agent under its declared id/name.
  const capabilityId = options.agent.config.id ?? options.agent.config.name ?? AGENT_CAPABILITY_ID;
  // Same session construction the server performs for a bare `Agent` entry —
  // never a session the inspector invented.
  const exposure: PrismAgentExposure = {
    sessionFactory: (_authorization: PrismServerAuthorization) => options.agent.createSession(),
    ...(options.eventSource ? { events: options.eventSource, resolveRun: options.resolveRun } : {}),
  };
  // Durable status/resume capability: composed over the host's checkpoint
  // store and the host's agent — the inspector constructs no runtime.
  const agentRuns = options.checkpoints
    ? {
        [capabilityId]: {
          lifecycle: createAgentRunLifecycle({
            checkpoints: options.checkpoints,
            resolveAgent: () => ({ agent: options.agent, definitionRevision: options.definitionRevision ?? "1" }),
          }),
        },
      }
    : undefined;
  const prismHandler = createPrismHandler({
    agents: { [capabilityId]: exposure },
    ...(agentRuns ? { agentRuns } : {}),
    authorize: authorizer,
    redactor: options.redactor,
    limits: options.limits,
    basePath: options.basePath,
  });
  const replaySeams =
    options.eventSource && options.resolveRun
      ? {
          replay: createPrismAgentEventReplay(options.eventSource, {
            ...(options.limits?.maxReplayCursorBytes !== undefined
              ? { limits: { maxReplayCursorBytes: options.limits.maxReplayCursorBytes } }
              : {}),
          }),
          resolveRun: options.resolveRun,
          authorize: authorizer,
          capabilityId,
          ...(options.redactor ? { redactor: options.redactor } : {}),
        }
      : undefined;
  // Inspector surface: data-defined routes over the server seam (plan 040
  // Task 2). Everything not matched still reaches the raw server surface at
  // /{basePath}/*, so the SSE/status routes stay available on one listener.
  const handler = createDevRouter({ handler: prismHandler, basePath, agentCapabilityId: capabilityId, replay: replaySeams });

  let server: Server | undefined;

  return {
    handler,
    get url(): string {
      return `http://${normalizeDisplayHost(host)}:${boundPort(server)}${basePath}`;
    },
    get host(): string {
      return host;
    },
    get port(): number {
      return boundPort(server);
    },
    listen() {
      return (async () => {
        if (server?.listening) return;
        if (!isLoopbackHost(host)) {
          const authorized = await options.remoteAuthorize?.();
          if (authorized !== true) {
            throw new DevInspectorError(`non-loopback bind to "${host}" not authorized by remoteAuthorize`, "ERR_PRISM_DEV_REMOTE_BIND");
          }
        }
        const created = createServer((request, response) => {
          void nodeToWebRequest(host, request, response, handler);
        });
        await new Promise<void>((resolve, reject) => {
          created.once("error", reject);
          created.listen(options.port ?? DEFAULT_PORT, host, () => resolve());
        });
        created.removeAllListeners("error");
        server = created;
      })();
    },
    async close() {
      const current = server;
      if (!current) return;
      server = undefined;
      await new Promise<void>((resolve, reject) => {
        current.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function boundPort(server: Server | undefined): number {
  if (!server?.listening) throw new DevInspectorError("inspector is not listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new DevInspectorError("inspector has no tcp address");
  return address.port;
}

/** Same normalization the server seam applies to its own basePath. */
function normalizeBasePath(value: string | undefined): string {
  const raw = value ?? "/prism";
  if (!raw.startsWith("/") || raw.includes("?") || raw.includes("#")) {
    throw new DevInspectorError(`basePath must be an absolute URL path: "${raw}"`);
  }
  const normalized = raw.length > 1 ? `/${trimTrailingSlashes(raw.slice(1))}`.replace(/\/+$/, "") : raw;
  if (normalized === "/" || normalized.length === 0) throw new DevInspectorError("basePath cannot expose the URL root");
  return normalized;
}

function normalizeDisplayHost(host: string): string {
  return host === "localhost" || isLoopbackAddress(host) ? "127.0.0.1" : host;
}

async function nodeToWebRequest(
  host: string,
  request: IncomingMessage,
  response: ServerResponse,
  handler: PrismRequestHandler,
): Promise<void> {
  const url = `http://${host}:${request.socket.localPort ?? 80}${request.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, values] of Object.entries(request.headers)) {
    if (values === undefined) continue;
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
  }
  const method = request.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const webRequest = new Request(url, {
    method,
    headers,
    ...(hasBody ? { body: ReadableStreamFrom(request) as unknown as ReadableStream<Uint8Array>, duplex: "half" as never } : {}),
  });
  let webResponse: Response;
  try {
    webResponse = await handler(webRequest);
  } catch {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "ERR_PRISM_DEV_INSPECTOR", message: "Internal inspector error" } }));
    return;
  }
  response.writeHead(webResponse.status, webResponse.statusText, Object.fromEntries(webResponse.headers));
  if (webResponse.body) {
    for await (const chunk of webResponse.body) response.write(chunk);
  }
  response.end();
}

function ReadableStreamFrom(request: IncomingMessage): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      request.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      request.on("end", () => controller.close());
      request.on("error", (error) => controller.error(error));
    },
  });
}
