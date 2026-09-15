import { trimTrailingSlashes } from "@arnilo/prism";
import {
  cancelWorkflowRun,
  listWorkflowRuns,
  type WorkflowCheckpointAdapter,
  type WorkflowCheckpointRecord,
  type WorkflowDefinition,
  type WorkflowRunStatus,
} from "../workflows/index.js";
import { HARD_MAX_HEALTH_BYTES, resolvePrismDeploymentLimits } from "./limits.js";
import { type PrismRequestHandler, type PrismServerAuthorization, PrismServerError } from "./types.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const DEFAULT_PAGE = 50;
const HARD_PAGE = 100;
const MAX_BODY = 64 * 1024;

export interface OperatorUnknownEffect {
  readonly key: string;
  readonly expectedVersion: number;
  readonly toolName?: string;
  readonly updatedAt?: string;
}

export interface OperatorUnknownEffects {
  list(input: {
    readonly ownership: PrismServerAuthorization["ownership"];
    readonly cursor?: string;
    readonly limit: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly items: readonly OperatorUnknownEffect[]; readonly nextCursor?: string }>;
  reconcile(input: {
    readonly ownership: PrismServerAuthorization["ownership"];
    readonly key: string;
    readonly expectedVersion: number;
    readonly status: "completed" | "failed_terminal";
    readonly evidence?: string;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface CreatePrismOperatorHandlerOptions {
  readonly authorize: (request: Request) => false | PrismServerAuthorization | Promise<false | PrismServerAuthorization>;
  readonly checkpoints: WorkflowCheckpointAdapter;
  readonly workflows?:
    | Readonly<Record<string, WorkflowDefinition>>
    | ((workflowId: string) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>);
  readonly unknownEffects?: OperatorUnknownEffects;
  readonly clock?: () => number;
  readonly basePath?: string;
  readonly pageSize?: number;
}

export function createPrismOperatorHandler(options: CreatePrismOperatorHandlerOptions): PrismRequestHandler {
  if (typeof options.authorize !== "function") {
    throw new PrismServerError("operator authorize is required", 500, "ERR_PRISM_SERVER_CONFIG");
  }
  const base = normalizeBase(options.basePath ?? "/ops");
  const pageSize = clampPage(options.pageSize ?? DEFAULT_PAGE);
  const clock = options.clock ?? Date.now;
  const limits = resolvePrismDeploymentLimits({});

  return async (request) => {
    try {
      const url = new URL(request.url);
      const path = trimTrailingSlashes(url.pathname) || "/";
      if (!path.startsWith(base)) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      const rest = path === base ? "" : path.slice(base.length);
      const auth = await options.authorize(request);
      if (!auth) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      if (!auth.ownership.tenantId && !auth.ownership.accountId && !auth.ownership.userId) {
        throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const limit = clampPage(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || pageSize);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        if (rest === "/queue")
          return json(await listStatus(["queued", "running"], auth, cursor, limit, clock), request.method, limits.maxHealthBytes);
        if (rest === "/suspended")
          return json(await listStatus("suspended", auth, cursor, limit, clock), request.method, limits.maxHealthBytes);
        if (rest === "/failed") return json(await listStatus("failed", auth, cursor, limit, clock), request.method, limits.maxHealthBytes);
        if (rest === "/unknown") {
          if (!options.unknownEffects)
            throw new PrismServerError("Unknown-effect listing is not configured", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          const page = await options.unknownEffects.list({ ownership: auth.ownership, cursor, limit, signal: request.signal });
          return json(
            { items: page.items.slice(0, limit), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) },
            request.method,
            limits.maxHealthBytes,
          );
        }
        throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      }

      if (request.method !== "POST") throw new PrismServerError("Method not allowed", 405, "ERR_PRISM_SERVER_METHOD");
      const body = await readJson(request);
      if (rest === "/cancel") {
        const workflowId = requireId(body.workflowId, "workflowId");
        const runId = requireId(body.runId, "runId");
        const workflow = await resolveWorkflow(options.workflows, workflowId);
        if (!workflow) throw new PrismServerError("Unknown workflow", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        const result = await cancelWorkflowRun({
          workflowId,
          runId,
          workflow,
          checkpoints: options.checkpoints,
          ownership: auth.ownership,
          signal: request.signal,
        });
        return json(result, request.method, limits.maxHealthBytes);
      }
      if (rest === "/reconcile") {
        if (!options.unknownEffects)
          throw new PrismServerError("Unknown-effect reconcile is not configured", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        const status = body.status;
        if (status !== "completed" && status !== "failed_terminal") {
          throw new PrismServerError("Reconcile cannot retry an unknown effect", 400, "ERR_PRISM_SERVER_RECONCILE");
        }
        const evidence = body.evidence === undefined ? undefined : requireId(body.evidence, "evidence", 1024);
        const result = await options.unknownEffects.reconcile({
          ownership: auth.ownership,
          key: requireId(body.key, "key"),
          expectedVersion: requireVersion(body.expectedVersion),
          status,
          evidence,
          signal: request.signal,
        });
        return json({ ok: true, result }, request.method, limits.maxHealthBytes);
      }
      throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
    } catch (error) {
      if (error instanceof PrismServerError) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
          status: error.status,
          headers: JSON_HEADERS,
        });
      }
      const message = error instanceof Error ? error.message : "Operator request failed";
      const status = /mismatch|not found|does not match/i.test(message) ? 404 : 500;
      return new Response(JSON.stringify({ error: { code: "ERR_PRISM_SERVER", message } }), { status, headers: JSON_HEADERS });
    }
  };

  async function listStatus(
    status: WorkflowRunStatus | readonly WorkflowRunStatus[],
    auth: PrismServerAuthorization,
    cursor: string | undefined,
    limit: number,
    now: () => number,
  ) {
    const page = await listWorkflowRuns(options.checkpoints, {
      ownership: auth.ownership,
      status,
      cursor,
      limit,
    });
    const t = now();
    return {
      items: page.items.slice(0, limit).map((record) => publicRun(record, t)),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }
}

function workloadClass(record: WorkflowCheckpointRecord): string {
  const raw = record.value.metadata?.workloadClass;
  if (typeof raw !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(raw)) return "default";
  return raw;
}

function publicRun(record: WorkflowCheckpointRecord, now: number) {
  const created = Date.parse(record.value.createdAt);
  const reason = record.value.suspension?.reason;
  return {
    workflowId: record.workflowId,
    runId: record.runId,
    status: record.value.status,
    createdAt: record.value.createdAt,
    updatedAt: record.value.updatedAt,
    queueAgeMs: Number.isFinite(created) ? Math.max(0, now - created) : 0,
    class: workloadClass(record),
    ...(typeof reason === "string" && reason.length > 0 && reason.length <= 128 ? { suspension: reason } : {}),
  };
}

async function resolveWorkflow(
  workflows:
    | Readonly<Record<string, WorkflowDefinition>>
    | ((workflowId: string) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>)
    | undefined,
  workflowId: string,
): Promise<WorkflowDefinition | undefined> {
  if (!workflows) return undefined;
  return typeof workflows === "function" ? await workflows(workflowId) : workflows[workflowId];
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY) {
    throw new PrismServerError("Request too large", 413, "ERR_PRISM_SERVER_LIMIT");
  }
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PrismServerError("Invalid JSON", 400, "ERR_PRISM_SERVER_VALIDATION");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PrismServerError("Invalid JSON", 400, "ERR_PRISM_SERVER_VALIDATION");
  }
  return parsed as Record<string, unknown>;
}

function requireId(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > max || value.includes("\0")) {
    throw new PrismServerError(`${name} is invalid`, 400, "ERR_PRISM_SERVER_VALIDATION");
  }
  return value;
}

function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PrismServerError("expectedVersion is invalid", 400, "ERR_PRISM_SERVER_VALIDATION");
  }
  return value as number;
}

function clampPage(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return DEFAULT_PAGE;
  return Math.min(value, HARD_PAGE);
}

function json(body: unknown, method: string, maxBytes: number): Response {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text, "utf8") > Math.max(maxBytes, HARD_MAX_HEALTH_BYTES)) {
    throw new PrismServerError("Operator response too large", 507, "ERR_PRISM_SERVER_LIMIT");
  }
  if (method === "HEAD") return new Response(null, { status: 200, headers: JSON_HEADERS });
  return new Response(text, { status: 200, headers: JSON_HEADERS });
}

function normalizeBase(basePath: string): string {
  if (!basePath.startsWith("/") || basePath.includes("?") || basePath.includes("#")) {
    throw new PrismServerError("Invalid operator basePath", 500, "ERR_PRISM_SERVER_CONFIG");
  }
  return trimTrailingSlashes(basePath) || "/ops";
}
