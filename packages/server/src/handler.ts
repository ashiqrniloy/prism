import type { Agent, AgentEvent, AgentSession, JsonObject, Message } from "@arnilo/prism";
import {
  cancelWorkflowRun,
  createWorkflowEventBus,
  enqueueWorkflow,
  getWorkflowRun,
  replayWorkflow,
  resumeWorkflow,
  runWorkflow,
  type WorkflowEvent,
  type WorkflowResumeRequest,
  type WorkflowScheduleStatus,
} from "@arnilo/prism-workflows";
import { resolvePrismServerLimits, type ResolvedPrismServerLimits } from "./limits.js";
import type {
  CreatePrismHandlerOptions,
  PrismAgentExposure,
  PrismRequestHandler,
  PrismServerAuthorization,
  PrismServerOperation,
  PrismWorkflowExposure,
} from "./types.js";
import { PrismServerError } from "./types.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

export function createPrismHandler(options: CreatePrismHandlerOptions): PrismRequestHandler {
  const limits = resolvePrismServerLimits(options.limits);
  const base = normalizeBasePath(options.basePath ?? "/prism");
  let activeRuns = 0;

  return async (request) => {
    const origin = request.headers.get("origin");
    const corsHeaders = origin && options.allowedOrigins?.includes(origin)
      ? { "access-control-allow-origin": origin, vary: "origin" }
      : undefined;
    const respond = (response: Response) => addHeaders(response, corsHeaders);

    try {
      assertRequestPolicy(request, options.allowedHosts, options.allowedOrigins);
      const route = parseRoute(request, base);
      if (request.method === "OPTIONS") {
        if (!origin || !options.allowedOrigins?.includes(origin)) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        return respond(new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
            vary: "origin",
          },
        }));
      }
      if (!route) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");

      const authorization = await authorize(options, request, route.operation, route.capabilityId, limits.requestTimeoutMs);
      if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");

      if (route.kind.startsWith("schedule-")) {
        const selectedSchedules = options.schedules;
        if (!selectedSchedules) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const schedules = typeof selectedSchedules === "function"
            ? await awaitWithSignal(Promise.resolve(selectedSchedules(authorization, owned.signal)), owned.signal)
            : selectedSchedules;
          if (!sameOwnership(authorization.ownership, schedules.ownership)) {
            throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
          }
          if (route.kind === "schedule-list") {
            const query = new URL(request.url).searchParams;
            const status = query.get("status");
            const result = await awaitWithSignal(schedules.list({
              status: readScheduleStatus(status),
              cursor: query.get("cursor") ?? undefined,
              limit: query.has("limit") ? readPositiveInteger(query.get("limit"), "limit") : undefined,
              signal: owned.signal,
            }), owned.signal);
            return respond(json(result, 200, limits, options));
          }
          if (route.kind === "schedule-delete") {
            const result = await awaitWithSignal(schedules.delete(route.capabilityId, owned.signal), owned.signal);
            return respond(json({ deleted: result }, 200, limits, options));
          }
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          if (route.kind === "schedule-create") {
            const result = await awaitWithSignal(schedules.create({
              id: route.capabilityId,
              workflowId: readRequiredId(body.workflowId, "workflowId"),
              nextRunAt: readRequiredString(body.nextRunAt, "nextRunAt"),
              input: body.input,
              intervalMs: body.intervalMs === undefined ? undefined : readPositiveInteger(body.intervalMs, "intervalMs"),
              calculatorId: readOptionalId(body.calculatorId, "calculatorId"),
              paused: body.paused === true,
              metadata: readOptionalObject(body.metadata, "metadata"),
            }, owned.signal), owned.signal);
            return respond(json(result, 201, limits, options));
          }
          if (route.kind === "schedule-pause") {
            return respond(json(await awaitWithSignal(schedules.pause(route.capabilityId, owned.signal), owned.signal), 200, limits, options));
          }
          if (route.kind === "schedule-resume") {
            const nextRunAt = body.nextRunAt === undefined ? undefined : readRequiredString(body.nextRunAt, "nextRunAt");
            return respond(json(await awaitWithSignal(schedules.resume(route.capabilityId, nextRunAt, owned.signal), owned.signal), 200, limits, options));
          }
          const idempotencyKey = readRequiredId(body.idempotencyKey, "idempotencyKey");
          return respond(json(await awaitWithSignal(schedules.trigger(route.capabilityId, { idempotencyKey, signal: owned.signal }), owned.signal), 200, limits, options));
        } finally {
          owned.dispose();
        }
      }

      if (route.kind === "agent-run" || route.kind === "agent-stream") {
        const exposure = options.agents?.[route.capabilityId];
        if (!exposure) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        acquire();
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          const input = readAgentInput(body.input);
          const { session, runOptions } = await awaitWithSignal(createSession(exposure, authorization), owned.signal);
          const runConfig = {
            ...runOptions,
            ownership: authorization.ownership,
            metadata: { ...runOptions?.metadata, ...authorization.metadata },
            redactor: options.redactor,
            signal: owned.signal,
          };
          if (route.kind === "agent-run") {
            const result = await awaitWithSignal(session.run(input, runConfig), owned.signal);
            const response = respond(json(result, 200, limits, options));
            owned.dispose();
            release();
            return response;
          }
          const events = session.stream(input, {
            ...runConfig,
            maxQueuedEvents: limits.maxQueuedEvents,
            overflow: "close",
          });
          return respond(sse(events, owned, limits, options, release));
        } catch (error) {
          owned.dispose();
          release();
          throw error;
        }
      }

      const exposure = options.workflows?.[route.capabilityId];
      if (!exposure) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");

      if (route.kind === "workflow-enqueue") {
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          const result = await awaitWithSignal(enqueueWorkflow(exposure.definition, body.input, {
            checkpoints: exposure.checkpoints,
            ownership: authorization.ownership,
            runId: readOptionalId(body.runId, "runId"),
            metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
            signal: owned.signal,
          }), owned.signal);
          return respond(json(result, 202, limits, options));
        } finally {
          owned.dispose();
        }
      }
      if (route.kind === "workflow-replay") {
        acquire();
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          const result = await awaitWithSignal(replayWorkflow(exposure.definition, {
            sourceRunId: route.runId,
            fromNodeId: readRequiredId(body.fromNodeId, "fromNodeId"),
            runId: readOptionalId(body.runId, "runId"),
          }, {
            ...exposure.runOptions,
            checkpoints: exposure.checkpoints,
            ownership: authorization.ownership,
            metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
            redactor: options.redactor,
            signal: owned.signal,
          }), owned.signal);
          return respond(json(result, 200, limits, options));
        } finally {
          owned.dispose();
          release();
        }
      }
      if (route.kind === "workflow-status") {
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const record = await awaitWithSignal(getWorkflowRun(exposure.checkpoints, {
            workflowId: exposure.definition.id,
            runId: route.runId,
            ownership: authorization.ownership,
            signal: owned.signal,
          }), owned.signal);
          if (!record) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          return respond(json(record, 200, limits, options));
        } finally {
          owned.dispose();
        }
      }
      if (route.kind === "workflow-cancel") {
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const result = await awaitWithSignal(cancelWorkflowRun({
            workflowId: exposure.definition.id,
            runId: route.runId,
            checkpoints: exposure.checkpoints,
            ownership: authorization.ownership,
            signal: owned.signal,
          }), owned.signal);
          return respond(json(result, 200, limits, options));
        } finally {
          owned.dispose();
        }
      }
      if (route.kind === "workflow-resume") {
        acquire();
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          const result = await awaitWithSignal(resumeWorkflow(exposure.definition, {
            workflowId: exposure.definition.id,
            runId: route.runId,
          }, {
            ...exposure.runOptions,
            checkpoints: exposure.checkpoints,
            ownership: authorization.ownership,
            metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
            redactor: options.redactor,
            signal: owned.signal,
            resume: readResume(body),
          }), owned.signal);
          return respond(json(result, 200, limits, options));
        } finally {
          owned.dispose();
          release();
        }
      }

      acquire();
      const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
      try {
        const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
        const runId = readOptionalId(body.runId, "runId") ?? crypto.randomUUID();
        const workflowOptions = {
          ...exposure.runOptions,
          checkpoints: exposure.checkpoints,
          ownership: authorization.ownership,
          metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
          redactor: options.redactor,
          signal: owned.signal,
          runId,
        };
        if (route.kind === "workflow-run") {
          const result = await awaitWithSignal(runWorkflow(exposure.definition, body.input, workflowOptions), owned.signal);
          const response = respond(json(result, 200, limits, options));
          owned.dispose();
          release();
          return response;
        }
        const bus = createWorkflowEventBus({
          workflowId: exposure.definition.id,
          runId,
          maxQueuedEvents: limits.maxQueuedEvents,
          overflow: "close",
          signal: owned.signal,
        });
        const events = bus.subscribe();
        void runWorkflow(exposure.definition, body.input, { ...workflowOptions, eventBus: bus })
          .catch(() => undefined)
          .finally(() => bus.close());
        return respond(sse(events, owned, limits, options, release));
      } catch (error) {
        owned.dispose();
        release();
        throw error;
      }
    } catch (error) {
      return respond(errorResponse(error, limits, options));
    }
  };

  function acquire(): void {
    if (activeRuns >= limits.maxConcurrentRuns) {
      throw new PrismServerError("Server is busy", 429, "ERR_PRISM_SERVER_CONCURRENCY");
    }
    activeRuns += 1;
  }

  function release(): void {
    activeRuns = Math.max(0, activeRuns - 1);
  }
}

type Route =
  | { readonly kind: "agent-run" | "agent-stream"; readonly operation: "agent.run" | "agent.stream"; readonly capabilityId: string }
  | { readonly kind: "workflow-run" | "workflow-stream" | "workflow-enqueue"; readonly operation: "workflow.run" | "workflow.stream" | "workflow.enqueue"; readonly capabilityId: string }
  | { readonly kind: "workflow-status"; readonly operation: "workflow.status"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-cancel"; readonly operation: "workflow.cancel"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-resume"; readonly operation: "workflow.resume"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "workflow-replay"; readonly operation: "workflow.replay"; readonly capabilityId: string; readonly runId: string }
  | { readonly kind: "schedule-list"; readonly operation: "schedule.list"; readonly capabilityId: "*" }
  | { readonly kind: "schedule-create"; readonly operation: "schedule.create"; readonly capabilityId: string }
  | { readonly kind: "schedule-pause"; readonly operation: "schedule.pause"; readonly capabilityId: string }
  | { readonly kind: "schedule-resume"; readonly operation: "schedule.resume"; readonly capabilityId: string }
  | { readonly kind: "schedule-trigger"; readonly operation: "schedule.trigger"; readonly capabilityId: string }
  | { readonly kind: "schedule-delete"; readonly operation: "schedule.delete"; readonly capabilityId: string };

function parseRoute(request: Request, base: string): Route | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  let parts: string[];
  try {
    parts = pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new PrismServerError("Invalid route", 400, "ERR_PRISM_SERVER_ROUTE");
  }
  const [group, id, segment, runId, action] = parts;
  if (group === "schedules" && parts.length === 1 && request.method === "GET") {
    return { kind: "schedule-list", operation: "schedule.list", capabilityId: "*" };
  }
  if (!id || !validId(id)) return undefined;
  if (group === "schedules") {
    if (parts.length === 2 && request.method === "POST") return { kind: "schedule-create", operation: "schedule.create", capabilityId: id };
    if (parts.length === 2 && request.method === "DELETE") return { kind: "schedule-delete", operation: "schedule.delete", capabilityId: id };
    if (parts.length === 3 && segment === "pause" && request.method === "POST") return { kind: "schedule-pause", operation: "schedule.pause", capabilityId: id };
    if (parts.length === 3 && segment === "resume" && request.method === "POST") return { kind: "schedule-resume", operation: "schedule.resume", capabilityId: id };
    if (parts.length === 3 && segment === "trigger" && request.method === "POST") return { kind: "schedule-trigger", operation: "schedule.trigger", capabilityId: id };
    return undefined;
  }
  if (group === "agents" && segment === "runs" && parts.length === 3 && request.method === "POST") {
    return { kind: "agent-run", operation: "agent.run", capabilityId: id };
  }
  if (group === "agents" && segment === "stream" && parts.length === 3 && request.method === "POST") {
    return { kind: "agent-stream", operation: "agent.stream", capabilityId: id };
  }
  if (group !== "workflows") return undefined;
  if (segment === "runs" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-run", operation: "workflow.run", capabilityId: id };
  }
  if (segment === "stream" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-stream", operation: "workflow.stream", capabilityId: id };
  }
  if (segment === "enqueue" && parts.length === 3 && request.method === "POST") {
    return { kind: "workflow-enqueue", operation: "workflow.enqueue", capabilityId: id };
  }
  if (segment !== "runs" || !runId || !validId(runId)) return undefined;
  if (parts.length === 4 && request.method === "GET") {
    return { kind: "workflow-status", operation: "workflow.status", capabilityId: id, runId };
  }
  if (parts.length === 4 && request.method === "DELETE") {
    return { kind: "workflow-cancel", operation: "workflow.cancel", capabilityId: id, runId };
  }
  if (parts.length === 5 && action === "resume" && request.method === "POST") {
    return { kind: "workflow-resume", operation: "workflow.resume", capabilityId: id, runId };
  }
  if (parts.length === 5 && action === "replay" && request.method === "POST") {
    return { kind: "workflow-replay", operation: "workflow.replay", capabilityId: id, runId };
  }
  return undefined;
}

async function authorize(
  options: CreatePrismHandlerOptions,
  request: Request,
  operation: PrismServerOperation,
  capabilityId: string,
  timeoutMs: number,
): Promise<PrismServerAuthorization | false> {
  let result: false | PrismServerAuthorization;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  try {
    result = await Promise.race([
      options.authorize({ request, operation, capabilityId, signal: controller.signal }),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort(new Error("authorization timed out"));
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
  if (!result || !hasOwnership(result.ownership)) return false;
  return result;
}

function hasOwnership(value: PrismServerAuthorization["ownership"]): boolean {
  return [value.tenantId, value.accountId, value.userId].some((item) => typeof item === "string" && item.length > 0);
}

async function createSession(
  exposure: Agent | PrismAgentExposure,
  authorization: PrismServerAuthorization,
): Promise<{ readonly session: AgentSession; readonly runOptions?: PrismAgentExposure["runOptions"] }> {
  if ("sessionFactory" in exposure) {
    return { session: await exposure.sessionFactory(authorization), runOptions: exposure.runOptions };
  }
  return { session: exposure.createSession() };
}

async function readJsonObject(request: Request, maxBytes: number, signal: AbortSignal): Promise<JsonObject> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new PrismServerError("Content-Type must be application/json", 415, "ERR_PRISM_SERVER_CONTENT_TYPE");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  const reader = request.body?.getReader();
  if (!reader) throw new PrismServerError("JSON body is required", 400, "ERR_PRISM_SERVER_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason); };
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (signal.aborted) throw new PrismServerError("Request timed out or disconnected", 408, "ERR_PRISM_SERVER_ABORTED");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as JsonObject;
  } catch (error) {
    if (error instanceof PrismServerError) throw error;
    throw new PrismServerError("Invalid JSON object body", 400, "ERR_PRISM_SERVER_BODY");
  }
}

function readAgentInput(value: unknown): string | Message | readonly Message[] {
  if (typeof value === "string") return value;
  if (isMessage(value)) return value;
  if (Array.isArray(value) && value.length > 0 && value.every(isMessage)) return value;
  throw new PrismServerError("input must be a string, message, or non-empty message array", 400, "ERR_PRISM_SERVER_INPUT");
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["system", "user", "assistant", "tool"].includes(String(item.role)) && Array.isArray(item.content);
}

function readResume(body: JsonObject): WorkflowResumeRequest {
  if (body.decision !== "approve" && body.decision !== "deny") {
    throw new PrismServerError("decision must be approve or deny", 400, "ERR_PRISM_SERVER_RESUME");
  }
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new PrismServerError("expectedVersion must be a positive safe integer", 400, "ERR_PRISM_SERVER_RESUME");
  }
  return { decision: body.decision, input: body.input, expectedVersion: Number(body.expectedVersion) };
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new PrismServerError(`${name} is required`, 400, "ERR_PRISM_SERVER_INPUT");
  return value;
}

function readRequiredId(value: unknown, name: string): string {
  const result = readOptionalId(value, name);
  if (!result) throw new PrismServerError(`${name} is required`, 400, "ERR_PRISM_SERVER_ID");
  return result;
}

function readPositiveInteger(value: unknown, name: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 1) throw new PrismServerError(`${name} must be a positive safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return Number(number);
}

function readOptionalObject(value: unknown, name: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrismServerError(`${name} must be an object`, 400, "ERR_PRISM_SERVER_INPUT");
  return value as JsonObject;
}

function readScheduleStatus(value: string | null): WorkflowScheduleStatus | undefined {
  if (value === null) return undefined;
  if (value === "active" || value === "paused" || value === "completed") return value;
  throw new PrismServerError("status is invalid", 400, "ERR_PRISM_SERVER_INPUT");
}

function sameOwnership(left: PrismServerAuthorization["ownership"], right: PrismServerAuthorization["ownership"]): boolean {
  return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
}

function readOptionalId(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !validId(value)) throw new PrismServerError(`${name} is invalid`, 400, "ERR_PRISM_SERVER_ID");
  return value;
}

function validId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) throw new RangeError("basePath must be an absolute URL path");
  const normalized = value.length > 1 ? value.replace(/\/+$/, "") : value;
  if (normalized === "/") throw new RangeError("basePath cannot expose the URL root");
  return normalized;
}

function assertRequestPolicy(request: Request, hosts?: readonly string[], origins?: readonly string[]): void {
  if (hosts) {
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (!hosts.includes(host)) throw new PrismServerError("Forbidden host", 403, "ERR_PRISM_SERVER_HOST");
  }
  const origin = request.headers.get("origin");
  if (origin && origins && !origins.includes(origin)) throw new PrismServerError("Forbidden origin", 403, "ERR_PRISM_SERVER_ORIGIN");
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new PrismServerError("Request timed out or disconnected", 408, "ERR_PRISM_SERVER_ABORTED");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PrismServerError("Request timed out or disconnected", 408, "ERR_PRISM_SERVER_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function ownedSignal(request: Request, timeoutMs: number, disconnectAborts: boolean) {
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason ?? new Error("request disconnected"));
  if (disconnectAborts) {
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    dispose() {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    },
  };
}

function sse(
  source: AsyncIterable<AgentEvent | WorkflowEvent>,
  owned: ReturnType<typeof ownedSignal>,
  limits: ResolvedPrismServerLimits,
  options: CreatePrismHandlerOptions,
  release: () => void,
): Response {
  const iterator = source[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  let events = 0;
  let bytes = 0;
  let finished = false;
  const onAbort = () => { void finish(owned.signal.reason); };
  const finish = async (reason?: unknown) => {
    if (finished) return;
    finished = true;
    owned.signal.removeEventListener("abort", onAbort);
    owned.abort(reason);
    owned.dispose();
    release();
    await iterator.return?.();
  };
  owned.signal.addEventListener("abort", onAbort, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          await finish();
          controller.close();
          return;
        }
        const safe = options.redactor?.redact(next.value) ?? next.value;
        const chunk = encoder.encode(`data: ${JSON.stringify(safe)}\n\n`);
        events += 1;
        bytes += chunk.byteLength;
        if (chunk.byteLength > limits.maxEventBytes || events > limits.maxStreamEvents || bytes > limits.maxStreamBytes) {
          const error = encoder.encode('data: {"type":"error","error":{"code":"ERR_PRISM_SERVER_STREAM_LIMIT","message":"stream limit exceeded"}}\n\n');
          if (error.byteLength <= limits.maxEventBytes) controller.enqueue(error);
          await finish(new Error("stream limit exceeded"));
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      } catch {
        const error = encoder.encode('data: {"type":"error","error":{"code":"ERR_PRISM_SERVER_STREAM","message":"stream failed"}}\n\n');
        if (error.byteLength <= limits.maxEventBytes) controller.enqueue(error);
        await finish(new Error("stream failed"));
        controller.close();
      }
    },
    cancel(reason) {
      return finish(reason);
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

function json(value: unknown, status: number, limits: ResolvedPrismServerLimits, options: CreatePrismHandlerOptions): Response {
  const safe = options.redactor?.redact(value) ?? value;
  const text = JSON.stringify(safe);
  if (text === undefined || new TextEncoder().encode(text).byteLength > limits.maxResponseBytes) {
    throw new PrismServerError("Response too large", 507, "ERR_PRISM_SERVER_RESPONSE_LIMIT");
  }
  return new Response(text, { status, headers: JSON_HEADERS });
}

function errorResponse(error: unknown, limits: ResolvedPrismServerLimits, options: CreatePrismHandlerOptions): Response {
  const workflowCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
  const mapped = workflowCode === "ERR_PRISM_WORKFLOW_SCHEDULE_BUSY"
    ? { status: 409, code: workflowCode, message: "Schedule is busy" }
    : workflowCode === "ERR_PRISM_WORKFLOW_SCHEDULE"
      ? { status: 400, code: workflowCode, message: error instanceof Error ? error.message : "Invalid schedule" }
      : workflowCode === "ERR_PRISM_WORKFLOW_SCHEDULE_OWNERSHIP"
        ? { status: 403, code: workflowCode, message: "Forbidden" }
        : workflowCode === "ERR_PRISM_WORKFLOW_NOT_FOUND"
          ? { status: 404, code: workflowCode, message: "Not found" }
          : workflowCode === "ERR_PRISM_WORKFLOW_CHECKPOINT"
            ? { status: 409, code: workflowCode, message: "Workflow checkpoint operation rejected" }
            : undefined;
  const known = error instanceof PrismServerError;
  const status = mapped?.status ?? (known ? error.status : error instanceof DOMException && error.name === "AbortError" ? 499 : 500);
  const code = mapped?.code ?? (known ? error.code : status === 499 ? "ERR_PRISM_SERVER_ABORTED" : "ERR_PRISM_SERVER_INTERNAL");
  const message = mapped?.message ?? (known ? error.message : status === 499 ? "Request aborted" : "Internal server error");
  try {
    return json({ error: { code, message } }, status, limits, options);
  } catch {
    return new Response(null, { status });
  }
}

function addHeaders(response: Response, extra?: Readonly<Record<string, string>>): Response {
  if (!extra) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
