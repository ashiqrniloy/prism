import type { JsonObject } from "@arnilo/prism";

/** The request header Prism owns: minted per call, echoed back by the proxy on every response. */
export const LITELLM_CALL_ID_HEADER = "x-litellm-call-id";

/** Response headers the proxy adds (plan 214 Task 1b measured the set against v1.106.6). */
export const LITELLM_HEADERS = {
  callId: "x-litellm-call-id",
  modelId: "x-litellm-model-id",
  modelGroup: "x-litellm-model-group",
  apiBase: "x-litellm-model-api-base",
  version: "x-litellm-version",
  responseCost: "x-litellm-response-cost",
} as const;

/** Values are scalars only: a header is bounded so a hostile proxy cannot inflate run telemetry. */
export const LITELLM_HEADER_VALUE_LIMIT = 256;

export interface LiteLLMTelemetry {
  readonly callId: string;
  readonly modelId?: string;
  readonly modelGroup?: string;
  /** Origin only (`https://host:port`): the path and query can name private infrastructure. */
  readonly apiBase?: string;
  readonly version?: string;
  readonly responseCost?: number;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const trimmed = value.trim();
  // A longer value is dropped rather than truncated: a truncated URL or id misleads spend reconciliation.
  return trimmed && trimmed.length <= LITELLM_HEADER_VALUE_LIMIT ? trimmed : undefined;
}

/** Reduces an api base to its origin; an unparseable value is dropped. */
export function readLiteLLMApiBase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a cost header: finite and non-negative, otherwise ignored (`0` is a real cost, never dropped). */
export function readLiteLLMCost(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const cost = Number(value);
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/**
 * Response headers → the `usage.metadata.litellm` record. Pure: the same headers always map to the
 * same telemetry, so the seam is testable without a request.
 */
export function readLiteLLMHeaders(headers: Headers, callId: string): LiteLLMTelemetry {
  const modelId = readHeader(headers, LITELLM_HEADERS.modelId);
  const modelGroup = readHeader(headers, LITELLM_HEADERS.modelGroup) ?? readHeader(headers, "x-litellm-model-name");
  const apiBase = readLiteLLMApiBase(readHeader(headers, LITELLM_HEADERS.apiBase));
  const version = readHeader(headers, LITELLM_HEADERS.version);
  const responseCost = readLiteLLMCost(readHeader(headers, LITELLM_HEADERS.responseCost));
  return {
    callId,
    ...(modelId !== undefined ? { modelId } : {}),
    ...(modelGroup !== undefined ? { modelGroup } : {}),
    ...(apiBase !== undefined ? { apiBase } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(responseCost !== undefined ? { responseCost } : {}),
  };
}

/** The metadata object as it lands on the wire-facing `usage`: scalars only, no bodies. */
export function liteLLMUsageMetadata(telemetry: LiteLLMTelemetry): JsonObject {
  return { ...telemetry };
}
