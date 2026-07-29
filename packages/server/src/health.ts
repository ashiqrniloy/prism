import type { PrismDrainController } from "./drain.js";
import { type PrismDeploymentLimits, type ResolvedPrismDeploymentLimits, resolvePrismDeploymentLimits } from "./limits.js";
import { type PrismRequestHandler, PrismServerError } from "./types.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export interface CreatePrismHealthHandlerOptions {
  /** Path prefix. Default `/health`. Routes: `/livez`, `/readyz`, and prefix itself. */
  readonly basePath?: string;
  /** Liveness probe. Default always true. Must stay O(1)/bounded. */
  readonly live?: () => boolean | Promise<boolean>;
  /** Readiness probe (deps). Default true. Must stay O(1)/bounded. */
  readonly ready?: () => boolean | Promise<boolean>;
  readonly drain?: PrismDrainController;
  /**
   * Optional extra fields for `?detail=1`. Never include secrets/tenant payloads.
   * Emitted only when `authorizeDetail` returns true.
   */
  readonly detail?: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
  readonly authorizeDetail?: (request: Request) => boolean | Promise<boolean>;
  readonly limits?: PrismDeploymentLimits;
}

export function createPrismHealthHandler(options: CreatePrismHealthHandlerOptions = {}): PrismRequestHandler {
  const limits = resolvePrismDeploymentLimits(options.limits);
  const base = normalizeHealthBase(options.basePath ?? "/health");

  return async (request) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new PrismServerError("Method not allowed", 405, "ERR_PRISM_SERVER_METHOD");
      }
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const livePath = `${base}/livez`;
      const readyPath = `${base}/readyz`;
      if (path !== base && path !== livePath && path !== readyPath) {
        throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      }

      const wantDetail = url.searchParams.get("detail") === "1";
      if (wantDetail) {
        const allowed = options.authorizeDetail ? await options.authorizeDetail(request) : false;
        if (!allowed) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      }

      const live = options.live ? await options.live() : true;
      const readyCheck = options.ready ? await options.ready() : true;
      const drainSnap = options.drain?.snapshot();
      const draining = drainSnap?.draining === true;
      const ready = readyCheck && !draining;

      if (path === livePath) {
        return healthJson({ status: live ? "ok" : "fail", live }, live ? 200 : 503, limits, request.method);
      }
      if (path === readyPath) {
        return healthJson(
          {
            status: ready ? "ok" : "fail",
            ready,
            ...(drainSnap ? { draining: drainSnap.draining } : {}),
          },
          ready ? 200 : 503,
          limits,
          request.method,
        );
      }

      const body: Record<string, unknown> = {
        status: live && ready ? "ok" : "fail",
        live,
        ready,
      };
      if (drainSnap) {
        body.drain = {
          status: drainSnap.status,
          draining: drainSnap.draining,
          ...(drainSnap.deadlineAt === undefined ? {} : { deadlineAt: drainSnap.deadlineAt }),
        };
      }
      if (wantDetail && options.detail) {
        const extra = await options.detail();
        assertSafeDetail(extra);
        body.detail = extra;
      }
      const ok = live && ready;
      return healthJson(body, ok ? 200 : 503, limits, request.method);
    } catch (error) {
      if (error instanceof PrismServerError) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
          status: error.status,
          headers: JSON_HEADERS,
        });
      }
      return new Response(JSON.stringify({ error: { code: "ERR_PRISM_SERVER", message: "Health check failed" } }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }
  };
}

function healthJson(
  body: Readonly<Record<string, unknown>>,
  status: number,
  limits: ResolvedPrismDeploymentLimits,
  method: string,
): Response {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text, "utf8") > limits.maxHealthBytes) {
    throw new PrismServerError("Health response too large", 507, "ERR_PRISM_SERVER_HEALTH_LIMIT");
  }
  if (method === "HEAD") return new Response(null, { status, headers: JSON_HEADERS });
  return new Response(text, { status, headers: JSON_HEADERS });
}

function normalizeHealthBase(basePath: string): string {
  if (!basePath.startsWith("/") || basePath.includes("?") || basePath.includes("#")) {
    throw new PrismServerError("Invalid health basePath", 500, "ERR_PRISM_SERVER_CONFIG");
  }
  return basePath.replace(/\/+$/, "") || "/health";
}

function assertSafeDetail(value: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("password") ||
      lower.includes("credential") ||
      lower === "authorization" ||
      lower === "prompt" ||
      lower === "body"
    ) {
      throw new PrismServerError("Health detail key not allowed", 500, "ERR_PRISM_SERVER_HEALTH_DETAIL");
    }
  }
}
