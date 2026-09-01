import type { JsonObject, SecretRedactor, ToolExecutionContext } from "@arnilo/prism";
import type { OpenApiLimits } from "./limits.js";

export interface OpenApiCredentialInput {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

/** Host-owned credential resolver. Never inline secrets in the document or options. */
export type OpenApiCredentialResolver = (
  input: OpenApiCredentialInput,
  context: ToolExecutionContext,
) =>
  | { readonly headers?: Readonly<Record<string, string>>; readonly query?: Readonly<Record<string, string>> }
  | undefined
  | Promise<{ readonly headers?: Readonly<Record<string, string>>; readonly query?: Readonly<Record<string, string>> } | undefined>;

/** Host policy check immediately before the request; throw to deny. */
export type OpenApiPolicyCheck = (
  input: OpenApiCredentialInput & { readonly args: JsonObject },
  context: ToolExecutionContext,
) => void | Promise<void>;

/** Optional bounded cursor pagination. Applies only to operations whose compiled query parameters include `pageParam`. */
export interface OpenApiPagination {
  /** Query parameter name carrying the page token. */
  readonly pageParam: string;
  /** Optional query parameter name for the page size. */
  readonly pageSizeParam?: string;
  /** Page size sent with every page when `pageSizeParam` is set. */
  readonly pageSize?: number;
  /** Dot-path to the next-page token in the JSON response. Default probes `next` then `nextPageToken`. */
  readonly nextPath?: string;
  /** Dot-path to the items array in the JSON response. Default `items`. */
  readonly itemsPath?: string;
}

export interface OpenApiToolsOptions {
  /** OpenAPI 3.1 document as a JSON string or parsed object; byte-bounded by `maxDocumentBytes`. */
  readonly document: string | JsonObject;
  /** Allow-listed operationIds; only these compile into tools. */
  readonly operations: readonly string[];
  /** Pinned absolute base URL (https; http only for loopback hosts). Document/path/operation `servers` must share its origin. */
  readonly server: string;
  /** Host credential resolver; merged into request headers/query, never echoed into output. */
  readonly credentials?: OpenApiCredentialResolver;
  /** Host policy check before each request; throw to deny. */
  readonly policy?: OpenApiPolicyCheck;
  /** Applied to response text before it enters the tool result. */
  readonly redactor?: SecretRedactor;
  /** Optional bounded cursor pagination. */
  readonly pagination?: OpenApiPagination;
  /** Send `Idempotency-Key: <core idempotencyKey>` on mutating requests when the core provided one. Default false. */
  readonly idempotencyKeyHeader?: boolean;
  readonly limits?: OpenApiLimits;
  /** Test seam; defaults to global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}
