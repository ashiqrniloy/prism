/** respond (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import { AgentRunStateError } from "@arnilo/prism";
import type { CreatePrismHandlerOptions } from "../types.js";
import { PrismServerError } from "../types.js";
import type { ResolvedPrismServerLimits } from "../limits.js";
import { JSON_HEADERS } from "./consts.js";

export function json(value: unknown, status: number, limits: ResolvedPrismServerLimits, options: CreatePrismHandlerOptions): Response {
  const safe = options.redactor?.redact(value) ?? value;
  const text = JSON.stringify(safe);
  if (text === undefined || new TextEncoder().encode(text).byteLength > limits.maxResponseBytes) {
    throw new PrismServerError("Response too large", 507, "ERR_PRISM_SERVER_RESPONSE_LIMIT");
  }
  return new Response(text, { status, headers: JSON_HEADERS });
}

export function errorResponse(error: unknown, limits: ResolvedPrismServerLimits, options: CreatePrismHandlerOptions): Response {
  const workflowCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
  const mapped =
    workflowCode === "ERR_PRISM_WORKFLOW_SCHEDULE_BUSY"
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
  const agentState = error instanceof AgentRunStateError;
  const status =
    mapped?.status ?? (agentState ? 404 : known ? error.status : error instanceof DOMException && error.name === "AbortError" ? 499 : 500);
  const code =
    mapped?.code ??
    (agentState
      ? "ERR_PRISM_SERVER_NOT_FOUND"
      : known
        ? error.code
        : status === 499
          ? "ERR_PRISM_SERVER_ABORTED"
          : "ERR_PRISM_SERVER_INTERNAL");
  const message =
    mapped?.message ?? (agentState ? "Not found" : known ? error.message : status === 499 ? "Request aborted" : "Internal server error");
  try {
    const response = json({ error: { code, message } }, status, limits, options);
    if (known && error.headers) return addHeaders(response, error.headers);
    return response;
  } catch {
    return new Response(null, { status });
  }
}

export function addHeaders(response: Response, extra?: Readonly<Record<string, string>>): Response {
  if (!extra) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
