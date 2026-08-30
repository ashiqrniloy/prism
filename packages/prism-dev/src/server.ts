/**
 * Inspector route composition (plan 040 Task 2): a tiny data-defined route
 * table over the existing server seam. Every inspector route either adapts to
 * the already conformance-tested `PrismRequestHandler` (URL rewrite +
 * forward) or pages the durable event source through `replayRunPage` — no
 * route logic is re-implemented here:
 *
 * - `POST /prompt` → server handler direct run (`POST {base}/agents/{id}/runs`).
 * - `GET /events?runId=…` → server handler durable SSE
 *   (`GET {base}/agents/{id}/runs/{runId}/events`); `Last-Event-ID` reconnect
 *   and `?cursor=` are handled by the server seam itself.
 * - `GET /runs/:id/replay?cursor=…` → `replayRunPage`: paged replay of a run
 *   from the durable `AgentEventSource` without re-execution.
 * - `POST /runs/:runId/decisions/:decisionId` → server handler resume
 *   (`POST {base}/agents/{id}/runs/{runId}/resume`) with a single-entry
 *   decision batch; unknown outcome discriminants fail closed in the core
 *   boundary before any state write (0.2.0 regression guard).
 * - `GET /` + `GET /assets/inspector.js` + `GET /config` → the static
 *   inspector UI (Task 3) served with a strict CSP, no external fetches.
 *
 * Anything else forwards unchanged, so the raw `/{basePath}/*` server surface
 * stays reachable from the same listener.
 */

import type { PrismRequestHandler } from "@arnilo/prism-server";
import { type DevReplaySeams, replayRunPage } from "./replay.js";
import { inspectorConfigResponse, inspectorPageResponse, inspectorScriptResponse } from "./ui/assets.js";

/** Fallback capability id when the host agent declares neither id nor name. */
export const AGENT_CAPABILITY_ID = "default";

export type DevDecisionOutcome = "allow_once" | "allow_always" | "deny";

/** Typed request body of `POST /runs/:runId/decisions/:decisionId`. */
export interface DevDecisionRequest {
  readonly outcome: DevDecisionOutcome;
  /** Optimistic concurrency against the suspended run's version, as core requires. */
  readonly expectedVersion?: number;
}

export interface DevRouteContext {
  /** The composed server handler every route adapts to or forwards to. */
  readonly handler: PrismRequestHandler;
  /** Normalized base path of the underlying server routes (e.g. `/prism`). */
  readonly basePath: string;
  /** Capability id the agent is exposed under (host agent id/name; "default" otherwise). */
  readonly agentCapabilityId: string;
  /** Replay seams; absent unless the host wired an event source + resolveRun. */
  readonly replay?: DevReplaySeams;
}

/** One data row of the inspectors route table. */
interface DevRoute {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly handle: (match: RegExpMatchArray, request: Request, url: URL) => Promise<Response> | Response;
}

export function createDevRouter(ctx: DevRouteContext): PrismRequestHandler {
  // Data-defined route table (plan 040 Task 2): each row adapts to the server
  // seam below; ordering is fixed and anchored at the listener root.
  const routes: readonly DevRoute[] = [
    {
      method: "GET",
      // Inspector UI (plan 040 Task 3): one static page, strict CSP, no store.
      pattern: /^\/$/,
      handle: () => inspectorPageResponse(),
    },
    {
      method: "GET",
      pattern: /^\/assets\/inspector\.js$/,
      handle: () => inspectorScriptResponse(),
    },
    {
      method: "GET",
      // Same-origin bootstrap for the page: base path + capability id only.
      pattern: /^\/config$/,
      handle: () => inspectorConfigResponse(ctx.basePath, ctx.agentCapabilityId),
    },
    {
      method: "POST",
      pattern: /^\/prompt$/,
      handle: (_match, request, url) => adapt(url, `/agents/${ctx.agentCapabilityId}/runs`, request),
    },
    {
      method: "GET",
      // SSE with Last-Event-ID reconnect: forwarded verbatim (headers + ?cursor=).
      pattern: /^\/events$/,
      handle: (_match, request, url) => {
        const runId = url.searchParams.get("runId");
        if (!runId) return devError(400, "ERR_PRISM_DEV_ROUTE", "runId query parameter is required");
        const cursor = url.searchParams.get("cursor");
        const suffix = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
        return adapt(url, `/agents/${ctx.agentCapabilityId}/runs/${encodeURIComponent(runId)}/events${suffix}`, request);
      },
    },
    {
      method: "GET",
      // Paged replay of a stored run: no session, no provider, no re-execution.
      pattern: /^\/runs\/([^/]+)\/replay$/,
      handle: (match, request, url) => {
        if (!ctx.replay) return devError(404, "ERR_PRISM_SERVER_NOT_FOUND", "replay requires a durable event source");
        return replayRunPage(ctx.replay, request, match[1]!, url.searchParams.get("cursor") ?? undefined);
      },
    },
    {
      method: "POST",
      pattern: /^\/runs\/([^/]+)\/decisions\/([^/]+)$/,
      handle: (match, request, url) => decision(match[1]!, match[2]!, request, url),
    },
  ];

  return async (request) => {
    const url = new URL(request.url);
    for (const route of routes) {
      if (request.method !== route.method) continue;
      const match = url.pathname.match(route.pattern);
      if (!match) continue;
      try {
        return await route.handle(match, request, url);
      } catch (error) {
        return devError(500, "ERR_PRISM_DEV_INSPECTOR", error instanceof Error ? error.message : String(error));
      }
    }
    return ctx.handler(request);
  };

  async function decision(runId: string, decisionId: string, request: Request, url: URL): Promise<Response> {
    const body = (await readJsonObject(request)) as DevDecisionRequest;
    if (!body || typeof body !== "object" || typeof body.outcome !== "string") {
      return devError(400, "ERR_PRISM_DEV_ROUTE", "decision body must be { outcome, expectedVersion? }");
    }
    // Single-entry decision batch: core validates the outcome discriminant
    // (and expectedVersion CAS) before any state write; garbage fails closed
    // with 400 from the resume boundary without the router duplicating rules.
    const payload = {
      decisions: [{ approvalId: decisionId, outcome: body.outcome }],
      ...(typeof body.expectedVersion === "number" ? { expectedVersion: body.expectedVersion } : {}),
    };
    return ctx.handler(
      await rewritten(url, `${ctx.basePath}/agents/${ctx.agentCapabilityId}/runs/${encodeURIComponent(runId)}/resume`, request, payload),
    );
  }

  /** GET/POST forward preserving method, headers, and body stream. */
  async function adapt(url: URL, toPath: string, request: Request): Promise<Response> {
    return ctx.handler(await rewritten(url, `${ctx.basePath}${toPath}`, request));
  }
}

function devError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function rewritten(url: URL, toPath: string, request: Request, body?: unknown): Promise<Request> {
  const next = new URL(url);
  next.pathname = toPath;
  if (body !== undefined) {
    return new Request(next, { method: request.method, headers: request.headers, body: JSON.stringify(body) });
  }
  return new Request(next, request);
}

async function readJsonObject(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
