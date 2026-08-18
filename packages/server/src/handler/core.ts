/** core (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */

import {
  cancelWorkflowRun,
  createWorkflowEventBus,
  enqueueWorkflow,
  getWorkflowRun,
  replayWorkflow,
  resumeWorkflow,
  runWorkflow,
} from "@arnilo/prism-workflows";
import { isAdmitOperation } from "../drain.js";
import { resolvePrismServerLimits } from "../limits.js";
import type { CreatePrismHandlerOptions, PrismRequestHandler } from "../types.js";
import { PrismServerError } from "../types.js";
import { authorize, createSession, sameOwnership } from "./authorize.js";
import { assertRequestPolicy, awaitWithSignal, ownedSignal } from "./policy.js";
import {
  readAgentInput,
  readAgentResume,
  readJsonObject,
  readOptionalId,
  readOptionalObject,
  readPositiveInteger,
  readRequiredId,
  readRequiredString,
  readResume,
  readScheduleStatus,
  replayCursor,
} from "./readers.js";
import { addHeaders, errorResponse, json } from "./respond.js";
import { normalizeBasePath, parseRoute } from "./routing.js";
import { sse, sseAgentEvents } from "./sse.js";

export function createPrismHandler(options: CreatePrismHandlerOptions): PrismRequestHandler {
  const limits = resolvePrismServerLimits(options.limits);
  const base = normalizeBasePath(options.basePath ?? "/prism");
  let activeRuns = 0;

  return async (request) => {
    const origin = request.headers.get("origin");
    const corsHeaders =
      origin && options.allowedOrigins?.includes(origin) ? { "access-control-allow-origin": origin, vary: "origin" } : undefined;
    const respond = (response: Response) => addHeaders(response, corsHeaders);

    try {
      assertRequestPolicy(request, options.allowedHosts, options.allowedOrigins);
      const route = parseRoute(request, base);
      if (request.method === "OPTIONS") {
        if (!origin || !options.allowedOrigins?.includes(origin))
          throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        return respond(
          new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": origin,
              "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
              "access-control-allow-headers": "content-type, authorization, last-event-id",
              vary: "origin",
            },
          }),
        );
      }
      if (!route) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");

      const authorization = await authorize(options, request, route.operation, route.capabilityId, limits.requestTimeoutMs);
      if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");

      if (options.rateLimit) {
        const decision = await options.rateLimit({
          request,
          operation: route.operation,
          capabilityId: route.capabilityId,
          authorization,
          signal: request.signal,
        });
        if (decision !== true) {
          const headers: Record<string, string> = {};
          if (decision.retryAfterMs !== undefined && Number.isSafeInteger(decision.retryAfterMs) && decision.retryAfterMs > 0) {
            headers["retry-after"] = String(Math.ceil(decision.retryAfterMs / 1000));
          }
          throw new PrismServerError(
            decision.message ?? "Rate limit exceeded",
            429,
            decision.code ?? "ERR_PRISM_SERVER_RATE_LIMIT",
            Object.keys(headers).length ? headers : undefined,
          );
        }
      }
      if (options.drain && isAdmitOperation(route.operation)) options.drain.assertAdmit();

      if (route.kind.startsWith("schedule-")) {
        const selectedSchedules = options.schedules;
        if (!selectedSchedules) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const schedules =
            typeof selectedSchedules === "function"
              ? await awaitWithSignal(Promise.resolve(selectedSchedules(authorization, owned.signal)), owned.signal)
              : selectedSchedules;
          if (!sameOwnership(authorization.ownership, schedules.ownership)) {
            throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
          }
          if (route.kind === "schedule-list") {
            const query = new URL(request.url).searchParams;
            const status = query.get("status");
            const result = await awaitWithSignal(
              schedules.list({
                status: readScheduleStatus(status),
                cursor: query.get("cursor") ?? undefined,
                limit: query.has("limit") ? readPositiveInteger(query.get("limit"), "limit") : undefined,
                signal: owned.signal,
              }),
              owned.signal,
            );
            return respond(json(result, 200, limits, options));
          }
          if (route.kind === "schedule-delete") {
            const result = await awaitWithSignal(schedules.delete(route.capabilityId, owned.signal), owned.signal);
            return respond(json({ deleted: result }, 200, limits, options));
          }
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          if (route.kind === "schedule-create") {
            const result = await awaitWithSignal(
              schedules.create(
                {
                  id: route.capabilityId,
                  workflowId: readRequiredId(body.workflowId, "workflowId"),
                  nextRunAt: readRequiredString(body.nextRunAt, "nextRunAt"),
                  input: body.input,
                  intervalMs: body.intervalMs === undefined ? undefined : readPositiveInteger(body.intervalMs, "intervalMs"),
                  calculatorId: readOptionalId(body.calculatorId, "calculatorId"),
                  paused: body.paused === true,
                  metadata: readOptionalObject(body.metadata, "metadata"),
                },
                owned.signal,
              ),
              owned.signal,
            );
            return respond(json(result, 201, limits, options));
          }
          if (route.kind === "schedule-pause") {
            return respond(
              json(await awaitWithSignal(schedules.pause(route.capabilityId, owned.signal), owned.signal), 200, limits, options),
            );
          }
          if (route.kind === "schedule-resume") {
            const nextRunAt = body.nextRunAt === undefined ? undefined : readRequiredString(body.nextRunAt, "nextRunAt");
            return respond(
              json(
                await awaitWithSignal(schedules.resume(route.capabilityId, nextRunAt, owned.signal), owned.signal),
                200,
                limits,
                options,
              ),
            );
          }
          const idempotencyKey = readRequiredId(body.idempotencyKey, "idempotencyKey");
          return respond(
            json(
              await awaitWithSignal(schedules.trigger(route.capabilityId, { idempotencyKey, signal: owned.signal }), owned.signal),
              200,
              limits,
              options,
            ),
          );
        } finally {
          owned.dispose();
        }
      }

      if (route.kind === "agent-events") {
        const exposure = options.agents?.[route.capabilityId];
        if (!exposure || !("sessionFactory" in exposure) || !exposure.events || !exposure.resolveRun) {
          throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        }
        if (!authorization.ownership.tenantId) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
        acquire();
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const run = await awaitWithSignal(
            Promise.resolve(exposure.resolveRun({ runId: route.runId, authorization, signal: owned.signal })),
            owned.signal,
          );
          if (!run?.sessionId) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          const after = replayCursor(request, limits.maxReplayCursorBytes);
          const events = exposure.events.subscribe({
            ownership: authorization.ownership,
            sessionId: run.sessionId,
            runId: run.runId,
            after,
            signal: owned.signal,
          });
          return respond(sseAgentEvents(events, owned, limits, options, release));
        } catch (error) {
          owned.dispose();
          release();
          throw error;
        }
      }

      if (route.kind === "agent-status" || route.kind === "agent-resume") {
        const exposure = options.agentRuns?.[route.capabilityId];
        if (!exposure) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
        if (route.kind === "agent-status") {
          const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
          try {
            return respond(
              json(
                await awaitWithSignal(
                  exposure.lifecycle.status(
                    { runId: route.runId },
                    {
                      ownership: authorization.ownership,
                      signal: owned.signal,
                      agentId: route.capabilityId,
                    },
                  ),
                  owned.signal,
                ),
                200,
                limits,
                options,
              ),
            );
          } finally {
            owned.dispose();
          }
        }
        acquire();
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const body = await readJsonObject(request, limits.maxRequestBytes, owned.signal);
          return respond(
            json(
              await awaitWithSignal(
                exposure.lifecycle.resume({ runId: route.runId }, readAgentResume(body), {
                  ownership: authorization.ownership,
                  signal: owned.signal,
                  agentId: route.capabilityId,
                }),
                owned.signal,
              ),
              200,
              limits,
              options,
            ),
          );
        } finally {
          owned.dispose();
          release();
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
            identity: authorization.identity,
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
          const result = await awaitWithSignal(
            enqueueWorkflow(exposure.definition, body.input, {
              checkpoints: exposure.checkpoints,
              ownership: authorization.ownership,
              runId: readOptionalId(body.runId, "runId"),
              metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
              signal: owned.signal,
            }),
            owned.signal,
          );
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
          const result = await awaitWithSignal(
            replayWorkflow(
              exposure.definition,
              {
                sourceRunId: route.runId,
                fromNodeId: readRequiredId(body.fromNodeId, "fromNodeId"),
                runId: readOptionalId(body.runId, "runId"),
              },
              {
                ...exposure.runOptions,
                checkpoints: exposure.checkpoints,
                ownership: authorization.ownership,
                metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
                redactor: options.redactor,
                signal: owned.signal,
              },
            ),
            owned.signal,
          );
          return respond(json(result, 200, limits, options));
        } finally {
          owned.dispose();
          release();
        }
      }
      if (route.kind === "workflow-status") {
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const record = await awaitWithSignal(
            getWorkflowRun(exposure.checkpoints, {
              workflowId: exposure.definition.id,
              runId: route.runId,
              ownership: authorization.ownership,
              signal: owned.signal,
            }),
            owned.signal,
          );
          if (!record) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          return respond(json(record, 200, limits, options));
        } finally {
          owned.dispose();
        }
      }
      if (route.kind === "workflow-cancel") {
        const owned = ownedSignal(request, limits.requestTimeoutMs, options.disconnectAborts ?? true);
        try {
          const result = await awaitWithSignal(
            cancelWorkflowRun({
              workflowId: exposure.definition.id,
              runId: route.runId,
              workflow: exposure.definition,
              checkpoints: exposure.checkpoints,
              ownership: authorization.ownership,
              signal: owned.signal,
            }),
            owned.signal,
          );
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
          const result = await awaitWithSignal(
            resumeWorkflow(
              exposure.definition,
              {
                workflowId: exposure.definition.id,
                runId: route.runId,
              },
              {
                ...exposure.runOptions,
                checkpoints: exposure.checkpoints,
                ownership: authorization.ownership,
                metadata: { ...exposure.runOptions?.metadata, ...authorization.metadata },
                redactor: options.redactor,
                signal: owned.signal,
                resume: readResume(body),
              },
            ),
            owned.signal,
          );
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
