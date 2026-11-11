/**
 * Validated `packageConfig` for `@arnilo/prism-knowledge/rag` (plan 158 Task 3).
 *
 * Every secret field is a ref (`env:` / `keyring:`) and fails validation as a literal. The schema
 * declares no `required` key: a required field with no default would fail package conformance, so
 * `setup` checks what it needs and notes the reason instead of throwing.
 */
import type { JsonSchema, ModelRef } from "@arnilo/prism";

/** One indexed source: a local path (with an optional glob) or an absolute HTTP(S) URL. */
export interface RagSourceConfig {
  /** Local file or directory. Mutually exclusive with `url`. */
  readonly path?: string;
  /** Glob relative to `path` when it is a directory. Default `**\/*.{md,markdown,mdx,txt,html,htm,pdf}`. */
  readonly glob?: string;
  /** Absolute HTTP(S) URL, fetched through the `web.fetch` service. Mutually exclusive with `path`. */
  readonly url?: string;
}

/** The embeddings the package provides. `model` builds an `Embedder` over the kernel embeddings adapter. */
export interface RagEmbeddingsConfig {
  /** `"provider/model"` or a model object; the model must declare `capabilities.embeddings`. */
  readonly model?: ModelRef;
  /** Vector size; probed from the provider on first use when omitted. */
  readonly dimensions?: number;
  /** Texts per `embedMany` call. Default 64. */
  readonly batchSize?: number;
}

/** Consume another package's `Embedder` instead of building one from a model. */
export interface RagEmbeddingsServiceConfig {
  /** A service name (default `embeddings`) provided by another package. */
  readonly service: string;
}

/** The tenant/resource/corpus every source and query uses. */
export interface RagScopeConfig {
  readonly tenantId?: string;
  readonly resourceId?: string;
  readonly corpusId?: string;
}

/** The Postgres vector store. `connection` is a ref; a literal fails validation. */
export interface RagPostgresStoreConfig {
  /** `env:NAME` or `keyring:NAME`. */
  readonly connection?: string;
  readonly schema?: string;
  readonly table?: string;
}

export interface RagRerankerNoneConfig {
  readonly kind: "none";
}
export interface RagRerankerFakeConfig {
  readonly kind: "fake";
}
export interface RagRerankerLocalConfig {
  readonly kind: "local";
  readonly model?: string;
  readonly allowRemoteModels?: boolean;
  readonly dtype?: string;
  readonly cacheDir?: string;
}
export interface RagRerankerHttpConfig {
  readonly kind: "tei" | "openai-compatible" | "voyage";
  readonly baseUrl: string;
  readonly model?: string;
  /** `env:NAME` or `keyring:NAME`; required by `voyage`, optional for the others. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly allowLoopback?: boolean;
  readonly maxResponseBytes?: number;
}

export type RagRerankerConfig = RagRerankerNoneConfig | RagRerankerFakeConfig | RagRerankerLocalConfig | RagRerankerHttpConfig;

/** Validated `packageConfig` for `@arnilo/prism-knowledge/rag`. */
export interface RagConfig {
  readonly sources?: readonly RagSourceConfig[];
  readonly embeddings?: RagEmbeddingsConfig | RagEmbeddingsServiceConfig;
  readonly store?: "memory" | { readonly postgres?: RagPostgresStoreConfig };
  /** Register the `context.build` handler (one retrieval per turn). Default `false`. */
  readonly context?: boolean;
  readonly scope?: RagScopeConfig;
  /** Hits returned by `rag_search`. Default the library's `DEFAULT_TOP_K`. */
  readonly topK?: number;
  readonly reranker?: RagRerankerConfig;
}

/** {@link RagConfig} with every default applied, so `setup` reads one shape. */
export interface ResolvedRagConfig {
  readonly sources: readonly RagSourceConfig[];
  readonly embeddings?: RagEmbeddingsConfig | RagEmbeddingsServiceConfig;
  readonly store: "memory" | { readonly postgres?: RagPostgresStoreConfig };
  readonly context: boolean;
  readonly scope: { readonly tenantId: string; readonly resourceId: string; readonly corpusId: string };
  readonly topK?: number;
  readonly reranker?: RagRerankerConfig;
}

export const DEFAULT_RAG_SCOPE = Object.freeze({ tenantId: "prism", resourceId: "rag", corpusId: "default" });
export const DEFAULT_RAG_GLOB = "**/*.{md,markdown,mdx,txt,html,htm,pdf}";
export const DEFAULT_RAG_EMBED_BATCH = 64;

const secretString: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: "^(env|keyring):",
  "x-prism-secret": true,
};

const modelRef: JsonSchema = {
  additionalProperties: true,
  anyOf: [
    { type: "string", minLength: 1 },
    { type: "object", additionalProperties: true },
  ],
};

const sourceProperties: Readonly<Record<string, JsonSchema>> = {
  path: { type: "string", minLength: 1, maxLength: 4096 },
  glob: { type: "string", minLength: 1, maxLength: 4096 },
  url: { type: "string", minLength: 1, maxLength: 4096 },
};

const rerankerSchema: JsonSchema = {
  additionalProperties: true,
  oneOf: [
    { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "none" } } },
    { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "fake" } } },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { const: "local" },
        model: { type: "string", minLength: 1 },
        allowRemoteModels: { type: "boolean" },
        dtype: { type: "string", minLength: 1 },
        cacheDir: { type: "string", minLength: 1 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "baseUrl"],
      properties: {
        kind: { enum: ["tei", "openai-compatible", "voyage"] },
        baseUrl: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        apiKey: secretString,
        timeoutMs: { type: "integer", minimum: 1 },
        allowLoopback: { type: "boolean" },
        maxResponseBytes: { type: "integer", minimum: 1 },
      },
    },
  ],
};

/** The config schema. A literal secret fails validation; the `x-prism-secret` marker is enforced by the loader. */
export const ragConfigSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sources: {
      type: "array",
      maxItems: 256,
      items: { type: "object", additionalProperties: false, properties: sourceProperties },
    },
    embeddings: {
      additionalProperties: true,
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            model: modelRef,
            dimensions: { type: "integer", minimum: 1, maximum: 4096 },
            batchSize: { type: "integer", minimum: 1, maximum: 2048 },
          },
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["service"],
          properties: { service: { type: "string", minLength: 1, maxLength: 256 } },
        },
      ],
    },
    store: {
      oneOf: [
        { const: "memory" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            postgres: {
              type: "object",
              additionalProperties: false,
              properties: {
                connection: secretString,
                schema: { type: "string", minLength: 1, maxLength: 128 },
                table: { type: "string", minLength: 1, maxLength: 128 },
              },
            },
          },
        },
      ],
    },
    context: { type: "boolean", default: false },
    scope: {
      type: "object",
      additionalProperties: false,
      properties: {
        tenantId: { type: "string", minLength: 1, maxLength: 256 },
        resourceId: { type: "string", minLength: 1, maxLength: 256 },
        corpusId: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
    topK: { type: "integer", minimum: 1 },
    reranker: rerankerSchema,
  },
};

export function resolveRagConfig(config: RagConfig = {}): ResolvedRagConfig {
  return {
    sources: config.sources ?? [],
    ...(config.embeddings === undefined ? {} : { embeddings: config.embeddings }),
    store: config.store ?? "memory",
    context: config.context === true,
    scope: {
      tenantId: config.scope?.tenantId ?? DEFAULT_RAG_SCOPE.tenantId,
      resourceId: config.scope?.resourceId ?? DEFAULT_RAG_SCOPE.resourceId,
      corpusId: config.scope?.corpusId ?? DEFAULT_RAG_SCOPE.corpusId,
    },
    ...(config.topK === undefined ? {} : { topK: config.topK }),
    ...(config.reranker === undefined ? {} : { reranker: config.reranker }),
  };
}
