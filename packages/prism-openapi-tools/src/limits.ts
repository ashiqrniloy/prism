import { OpenApiToolError } from "./errors.js";

export interface OpenApiLimits {
  readonly maxDocumentBytes?: number;
  readonly maxOperations?: number;
  readonly maxSchemaDepth?: number;
  readonly maxRefs?: number;
  readonly maxBodyBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxPages?: number;
  readonly maxPaginationItems?: number;
  readonly maxRetries?: number;
}

export interface ResolvedOpenApiLimits {
  readonly maxDocumentBytes: number;
  readonly maxOperations: number;
  readonly maxSchemaDepth: number;
  readonly maxRefs: number;
  readonly maxBodyBytes: number;
  readonly maxResponseBytes: number;
  readonly maxPages: number;
  readonly maxPaginationItems: number;
  readonly maxRetries: number;
}

export const DEFAULT_OPENAPI_LIMITS: ResolvedOpenApiLimits = {
  maxDocumentBytes: 2 * 1024 * 1024,
  maxOperations: 256,
  maxSchemaDepth: 32,
  maxRefs: 1024,
  maxBodyBytes: 1024 * 1024,
  maxResponseBytes: 1024 * 1024,
  maxPages: 20,
  maxPaginationItems: 1000,
  maxRetries: 0,
};

export const HARD_OPENAPI_LIMITS: ResolvedOpenApiLimits = {
  maxDocumentBytes: 16 * 1024 * 1024,
  maxOperations: 1024,
  maxSchemaDepth: 128,
  maxRefs: 8192,
  maxBodyBytes: 16 * 1024 * 1024,
  maxResponseBytes: 16 * 1024 * 1024,
  maxPages: 100,
  maxPaginationItems: 10000,
  maxRetries: 3,
};

export function resolveOpenApiLimits(input: OpenApiLimits = {}): ResolvedOpenApiLimits {
  const resolved = { ...DEFAULT_OPENAPI_LIMITS, ...input };
  for (const [key, value] of Object.entries(resolved)) {
    const min = key === "maxRetries" ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < min) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `openapi limit ${key} must be a safe integer >= ${min}`);
    }
    if (value > HARD_OPENAPI_LIMITS[key as keyof ResolvedOpenApiLimits]) {
      throw new OpenApiToolError("ERR_PRISM_OPENAPI_DOCUMENT_BOUNDS", `openapi limit ${key} exceeds its hard cap`);
    }
  }
  return resolved;
}
