/** readers (0.2.5 plan 025 Task 1 split). Moved verbatim from handler.ts; public surface unchanged behind the barrel. */
import type { JsonObject, Message, RunDecision } from "@arnilo/prism";
import { HARD_MAX_DECISION_REASON_BYTES, HARD_MAX_ELICITATION_BYTES, HARD_MAX_PENDING_DECISIONS } from "@arnilo/prism";
import type { WorkflowResumeRequest, WorkflowScheduleStatus } from "@arnilo/prism-workflows";
import { PrismServerError } from "../types.js";

export async function readJsonObject(request: Request, maxBytes: number, signal: AbortSignal): Promise<JsonObject> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json")
    throw new PrismServerError("Content-Type must be application/json", 415, "ERR_PRISM_SERVER_CONTENT_TYPE");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  const reader = request.body?.getReader();
  if (!reader) throw new PrismServerError("JSON body is required", 400, "ERR_PRISM_SERVER_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel(signal.reason);
  };
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

export function readAgentInput(value: unknown): string | Message | readonly Message[] {
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

const RUN_DECISION_OUTCOMES = new Set(["allow_once", "allow_for_run", "reject_once", "reject_for_run"]);
const RUN_DECISION_KEYS = new Set(["approvalId", "outcome", "reason", "modifiedArguments", "elicitation"]);

/** Boundary validation for a client-supplied decision batch; core re-validates under CAS. */
function readAgentDecisions(value: unknown): readonly RunDecision[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > HARD_MAX_PENDING_DECISIONS) {
    throw new PrismServerError("decisions must be a non-empty bounded array", 400, "ERR_PRISM_SERVER_RESUME");
  }
  return value.map((entry): RunDecision => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PrismServerError("decision entry must be an object", 400, "ERR_PRISM_SERVER_RESUME");
    }
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some((key) => !RUN_DECISION_KEYS.has(key))) {
      throw new PrismServerError("decision entry has unknown keys", 400, "ERR_PRISM_SERVER_RESUME");
    }
    if (typeof row.approvalId !== "string" || row.approvalId.length === 0 || row.approvalId.length > 128) {
      throw new PrismServerError("decision approvalId is invalid", 400, "ERR_PRISM_SERVER_RESUME");
    }
    if (typeof row.outcome !== "string" || !RUN_DECISION_OUTCOMES.has(row.outcome)) {
      throw new PrismServerError("decision outcome is invalid", 400, "ERR_PRISM_SERVER_RESUME");
    }
    if (
      row.reason !== undefined &&
      (typeof row.reason !== "string" || Buffer.byteLength(row.reason, "utf8") > HARD_MAX_DECISION_REASON_BYTES)
    ) {
      throw new PrismServerError("decision reason exceeds limits", 400, "ERR_PRISM_SERVER_RESUME");
    }
    for (const key of ["modifiedArguments", "elicitation"] as const) {
      const field = row[key];
      if (field === undefined) continue;
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        throw new PrismServerError(`decision ${key} must be an object`, 400, "ERR_PRISM_SERVER_RESUME");
      }
      const text = JSON.stringify(field);
      if (text === undefined || Buffer.byteLength(text, "utf8") > HARD_MAX_ELICITATION_BYTES) {
        throw new PrismServerError(`decision ${key} exceeds limits`, 400, "ERR_PRISM_SERVER_RESUME");
      }
    }
    return entry as RunDecision;
  });
}

export function readAgentResume(
  body: JsonObject,
):
  | { readonly decision: "approve" | "deny"; readonly expectedVersion: number }
  | { readonly decisions: readonly RunDecision[]; readonly expectedVersion: number } {
  if (Object.keys(body).some((key) => key !== "decision" && key !== "decisions" && key !== "expectedVersion")) {
    throw new PrismServerError("Invalid agent resume body", 400, "ERR_PRISM_SERVER_RESUME");
  }
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new PrismServerError("expectedVersion must be a positive safe integer", 400, "ERR_PRISM_SERVER_RESUME");
  }
  if (body.decision !== undefined && body.decisions !== undefined) {
    throw new PrismServerError("provide exactly one of decision or decisions", 400, "ERR_PRISM_SERVER_RESUME");
  }
  if (body.decision !== undefined) {
    if (body.decision !== "approve" && body.decision !== "deny") {
      throw new PrismServerError("decision must be approve or deny", 400, "ERR_PRISM_SERVER_RESUME");
    }
    return { decision: body.decision, expectedVersion: Number(body.expectedVersion) };
  }
  if (body.decisions === undefined) {
    throw new PrismServerError("provide decision or decisions", 400, "ERR_PRISM_SERVER_RESUME");
  }
  return { decisions: readAgentDecisions(body.decisions), expectedVersion: Number(body.expectedVersion) };
}

export function readResume(body: JsonObject): WorkflowResumeRequest {
  if (body.decision !== "approve" && body.decision !== "deny") {
    throw new PrismServerError("decision must be approve or deny", 400, "ERR_PRISM_SERVER_RESUME");
  }
  if (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) {
    throw new PrismServerError("expectedVersion must be a positive safe integer", 400, "ERR_PRISM_SERVER_RESUME");
  }
  return { decision: body.decision, input: body.input, expectedVersion: Number(body.expectedVersion) };
}

export function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new PrismServerError(`${name} is required`, 400, "ERR_PRISM_SERVER_INPUT");
  return value;
}

export function readRequiredId(value: unknown, name: string): string {
  const result = readOptionalId(value, name);
  if (!result) throw new PrismServerError(`${name} is required`, 400, "ERR_PRISM_SERVER_ID");
  return result;
}

export function readPositiveInteger(value: unknown, name: string): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 1)
    throw new PrismServerError(`${name} must be a positive safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return Number(number);
}

export function readOptionalObject(value: unknown, name: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrismServerError(`${name} must be an object`, 400, "ERR_PRISM_SERVER_INPUT");
  return value as JsonObject;
}

export function readScheduleStatus(value: string | null): WorkflowScheduleStatus | undefined {
  if (value === null) return undefined;
  if (value === "active" || value === "paused" || value === "completed") return value;
  throw new PrismServerError("status is invalid", 400, "ERR_PRISM_SERVER_INPUT");
}

export function readOptionalId(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !validId(value)) throw new PrismServerError(`${name} is invalid`, 400, "ERR_PRISM_SERVER_ID");
  return value;
}

export function validId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

export function replayCursor(request: Request, maxBytes: number): string | undefined {
  const query = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const header = request.headers.get("last-event-id") ?? undefined;
  if (query !== undefined && header !== undefined && query !== header) {
    throw new PrismServerError("Conflicting event cursors", 400, "ERR_PRISM_SERVER_REPLAY_CURSOR");
  }
  const cursor = header ?? query;
  if (cursor !== undefined && (Buffer.byteLength(cursor, "utf8") > maxBytes || /\r|\n|\0/.test(cursor))) {
    throw new PrismServerError("Invalid event cursor", 400, "ERR_PRISM_SERVER_REPLAY_CURSOR");
  }
  return cursor;
}
