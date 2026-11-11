import type { JsonSchema } from "@arnilo/prism";

import type { OpenApiLimits } from "./limits.js";

/** One OpenAPI 3.1 document the package compiles into tools. */
export interface ToolsOpenapiSpecConfig {
  /** Tool-name prefix: every operation compiles as `<id>_<operationId>`. */
  readonly id: string;
  /** Path to a local JSON document, or an `https:` URL fetched once at setup through pinned fetch. */
  readonly source: string;
  /** Pinned origin for the compiled operations. Defaults to the document's first absolute `servers[0].url`. */
  readonly baseUrl?: string;
  /** Header name → `env:NAME` or `keyring:NAME`. Resolved per request; a literal fails config validation. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Allow-listed operationIds. Omit to compile every operation the document declares. */
  readonly include?: readonly string[];
  /** operationIds to skip when `include` is absent. */
  readonly exclude?: readonly string[];
}

/** Validated `packageConfig` for `@arnilo/prism-tools/openapi`. */
export interface ToolsOpenapiConfig {
  /** Required; an empty list registers nothing and notes why. */
  readonly specs?: readonly ToolsOpenapiSpecConfig[];
  /** Byte, retry, pagination, and body bounds shared by every spec. */
  readonly limits?: OpenApiLimits;
}

const secretString: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: "^(env|keyring):",
  "x-prism-secret": true,
};

const limitProperties: Readonly<Record<string, JsonSchema>> = {
  maxDocumentBytes: { type: "number", minimum: 1 },
  maxOperations: { type: "number", minimum: 1 },
  maxSchemaDepth: { type: "number", minimum: 1 },
  maxRefs: { type: "number", minimum: 1 },
  maxBodyBytes: { type: "number", minimum: 1 },
  maxResponseBytes: { type: "number", minimum: 1 },
  maxPages: { type: "number", minimum: 1 },
  maxPaginationItems: { type: "number", minimum: 1 },
  maxRetries: { type: "number", minimum: 0 },
};

/**
 * The config schema. `specs` is deliberately not declared `required`: a required field with no
 * default would fail package conformance, so `setup` checks it and names the field instead.
 * `headers` values are ref-only secret fields; a literal fails validation.
 */
export const toolsOpenapiConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    specs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
          source: { type: "string", minLength: 1, maxLength: 4096 },
          baseUrl: { type: "string", minLength: 1, maxLength: 4096 },
          headers: { type: "object", additionalProperties: secretString },
          include: { type: "array", items: { type: "string", minLength: 1 } },
          exclude: { type: "array", items: { type: "string", minLength: 1 } },
        },
      },
    },
    limits: { type: "object", properties: limitProperties },
  },
};
