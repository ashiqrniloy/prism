/**
 * `@arnilo/prism-rag` — retrieval over indexed sources as a package (plan 158 Task 3).
 *
 * The package owns the 0.12 RAG library (chunking, retrieval, fusion, reranking, connectors, sync) and
 * adds the package surface the roadmap §2.9 row asks for: one `rag_search` tool (`effects: ["read"]`),
 * an opt-in `context.build` block, and the `embeddings` service other packages consume.
 *
 * Cost: off by default. With `context` unset, a turn makes no embedding call — retrieval happens only
 * when the model calls `rag_search`. With `context: true`, one retrieval (one query embedding, plus an
 * optional rerank request) runs per turn. Indexing runs once, lazily, on the first `rag_search` or
 * `context.build` call, never during `createAgent`.
 *
 * ```ts
 * import memoryRag from "@arnilo/prism-rag";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "openai/gpt-5",
 *   packages: [memoryRag({ sources: [{ path: "./docs", glob: "**\/*.md" }], embeddings: { model: "openai/text-embedding-3-small" } })],
 * });
 * ```
 */
import manifest from "../package.json" with { type: "json" };
import {
  type JsonObject,
  type ModelRef,
  type PackageAPI,
  type PackageCommand,
  type PackageInstance,
  type Secret,
  definePackage,
} from "@arnilo/prism";
import { type Embedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import type { WebFetchService } from "@arnilo/prism-tools-web";

import {
  type RagConfig,
  type RagEmbeddingsServiceConfig,
  type RagRerankerConfig,
  type ResolvedRagConfig,
  ragConfigSchema,
  resolveRagConfig,
} from "./config.js";
import { registerRagContext } from "./context.js";
import { createProviderEmbedder, probeEmbedderDimensions } from "./embedder.js";
import { type IndexSourcesResult, indexSources } from "./index-sources.js";
import { type RerankerConfig, resolveReranker } from "./reranker-config.js";
import { retrieveContext } from "./retrieve.js";
import { createRagSearchTool } from "./tool.js";
import type { RagScope, Reranker, TransactionalVectorStore } from "./types.js";

// The moved 0.12 library surface keeps its names, now behind one entry point.
export * from "./exports.js";
export {
  DEFAULT_RAG_EMBED_BATCH,
  DEFAULT_RAG_GLOB,
  DEFAULT_RAG_SCOPE,
  type RagConfig,
  type RagEmbeddingsConfig,
  type RagEmbeddingsServiceConfig,
  type RagPostgresStoreConfig,
  type RagRerankerConfig,
  type RagScopeConfig,
  type RagSourceConfig,
  type ResolvedRagConfig,
  ragConfigSchema,
  resolveRagConfig,
} from "./config.js";
export { createProviderEmbedder, probeEmbedderDimensions, type ProviderEmbedderOptions } from "./embedder.js";
export {
  HARD_MAX_SOURCE_FILES,
  globToRegExp,
  indexSources,
  resolveSourceFiles,
  type SourceFile,
  type IndexSourcesOptions,
  type IndexSourcesResult,
} from "./index-sources.js";
export { createRagSearchTool, type RagSearchToolOptions } from "./tool.js";

const RAG_TOOL_NAME = "rag_search";
const RAG_CONTEXT_HOOK_ID = "memory-rag:context.build";

const definition = definePackage<RagConfig>({
  name: "@arnilo/prism-rag",
  version: manifest.version,
  description: "Retrieval over indexed sources: a rag_search tool, an opt-in context block, and the embeddings service.",
  requires: { api: 1 },
  capabilities: ["models", "credentials"],
  config: ragConfigSchema,
  setup: async (prism) => {
    const config = resolveRagConfig(prism.config);

    const embedder = await resolveEmbedder(prism, config);
    if (!embedder) return;

    const store = await resolveStore(prism, config);
    if (!store) return;

    const reranker = await resolveRerankerConfig(prism, config.reranker);
    const scope: RagScope = config.scope;

    // --- lazy indexing: one promise per agent, created on the first use, never in `createAgent`.
    const indexing = prism.state.agent<Promise<IndexSourcesResult> | undefined>("rag.indexing", undefined);
    const runIndex = async (signal?: AbortSignal): Promise<IndexSourcesResult> => {
      await probeEmbedderDimensions(embedder, signal);
      // Resolved per run: a package that provides `web.fetch` may load after this one.
      const webFetch = prism.services.consume<WebFetchService>("web.fetch");
      return indexSources({
        sources: config.sources,
        embedder,
        store,
        scope,
        ...(webFetch ? { webFetch } : {}),
        ...(signal ? { signal } : {}),
        onSkip: (source, reason) => prism.status.note("warn", `rag source skipped: ${reason} (${source.url ?? source.path ?? "unnamed"})`),
      });
    };
    const ensureIndexed = (signal?: AbortSignal): Promise<IndexSourcesResult> => {
      const pending = indexing.get();
      if (pending) return pending;
      const started = runIndex(signal).catch((error: unknown) => {
        indexing.set(undefined);
        throw error;
      });
      indexing.set(started);
      return started;
    };

    // --- the embeddings service: other packages (fabric) consume it instead of configuring a model.
    if (!isServiceConfig(config.embeddings)) prism.services.provide("embeddings", embedder);

    // --- tool: read-only retrieval, always visible; one embedding call per call.
    prism.tools.register(
      createRagSearchTool({
        name: RAG_TOOL_NAME,
        retrieve: async (query, signal) => {
          await ensureIndexed(signal);
          return retrieveContext(query, {
            embedder,
            store,
            scope,
            ...(config.topK === undefined ? {} : { topK: config.topK }),
            ...(reranker ? { reranker } : {}),
            ...(signal ? { signal } : {}),
          });
        },
      }),
    );

    // --- context: opt-in, one retrieval per turn, only the provider view changes.
    if (config.context) {
      registerRagContext(prism.hooks, {
        name: RAG_CONTEXT_HOOK_ID,
        title: "Retrieved context",
        embedder,
        store,
        scope,
        ...(config.topK === undefined ? {} : { topK: config.topK }),
        ...(reranker ? { reranker } : {}),
        prepare: (signal) => ensureIndexed(signal).then(() => {}),
      });
    }

    // --- command: force a re-index (drops the cached promise, re-runs the sources).
    prism.commands.register(createReindexCommand(() => runIndex()));
  },
});

/** The package definition. Pass config through `packageConfig` or use {@link memoryRag}. */
export default definition;

/** The package with config baked in, for `packages: [memoryRag({ ... })]`. */
export function memoryRag(config: RagConfig): PackageInstance {
  return definition(config);
}

function isServiceConfig(value: RagConfig["embeddings"]): value is RagEmbeddingsServiceConfig {
  return value !== undefined && "service" in value && typeof (value as RagEmbeddingsServiceConfig).service === "string";
}

/**
 * The configured `Embedder`: another package's service, or memory's `Embedder` over the model's kernel
 * embeddings adapter. A missing model or an unsupported one writes a `warn` note and registers nothing.
 */
async function resolveEmbedder(prism: PackageAPI<RagConfig>, config: ResolvedRagConfig): Promise<Embedder | undefined> {
  const embeddings = config.embeddings;
  if (isServiceConfig(embeddings)) {
    const consumed = prism.services.consume<Embedder>(embeddings.service);
    if (!consumed) {
      prism.status.note("warn", `rag: no package provides the ${JSON.stringify(embeddings.service)} embeddings service`);
      return undefined;
    }
    return consumed;
  }
  if (!embeddings || embeddings.model === undefined) {
    prism.status.note("warn", "rag: no embeddings configured; rag_search and the RAG context block stay unregistered");
    return undefined;
  }
  let provider: ReturnType<typeof prism.models.embeddings>;
  try {
    provider = prism.models.embeddings(embeddings.model);
  } catch (error) {
    prism.status.note("warn", `rag: ${error instanceof Error ? error.message : "the configured model cannot embed"}`);
    return undefined;
  }
  return createProviderEmbedder({
    provider,
    model: modelIdOf(embeddings.model),
    ...(embeddings.dimensions === undefined ? {} : { dimensions: embeddings.dimensions }),
    ...(embeddings.batchSize === undefined ? {} : { batchSize: embeddings.batchSize }),
  });
}

/** The configured vector store. Postgres resolves the connection ref and loads `pg` only when configured. */
async function resolveStore(prism: PackageAPI<RagConfig>, config: ResolvedRagConfig): Promise<TransactionalVectorStore | undefined> {
  if (config.store === "memory") return createMemoryVectorStore();
  const postgres = config.store.postgres;
  if (!postgres?.connection) {
    prism.status.note("warn", "rag: store.postgres needs a connection ref; no store registered");
    return undefined;
  }
  const secret: Secret | undefined = await prism.credentials.resolve(postgres.connection);
  if (!secret) {
    prism.status.note("warn", `rag: connection ref ${JSON.stringify(postgres.connection)} did not resolve`);
    return undefined;
  }
  const { createPostgresVectorStore } = await import("@arnilo/prism-memory-core/postgres");
  return createPostgresVectorStore({
    connectionString: secret.value,
    ...(postgres.schema === undefined ? {} : { schema: postgres.schema }),
    ...(postgres.table === undefined ? {} : { table: postgres.table }),
  });
}

/** Resolve ref-only secrets to values, then hand the library's declarative config to `resolveReranker`. */
async function resolveRerankerConfig(prism: PackageAPI<RagConfig>, config: RagRerankerConfig | undefined): Promise<Reranker | undefined> {
  if (!config || config.kind === "none") return undefined;
  if (config.kind === "fake" || config.kind === "local") return resolveReranker(config as RerankerConfig);
  let apiKey: string | undefined;
  if (config.apiKey !== undefined) {
    const secret = await prism.credentials.resolve(config.apiKey);
    if (!secret) {
      prism.status.note("warn", `rag: reranker apiKey ref ${JSON.stringify(config.apiKey)} did not resolve; reranking stays off`);
      return undefined;
    }
    apiKey = secret.value;
  }
  const shared = {
    baseUrl: config.baseUrl,
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.allowLoopback === undefined ? {} : { allowLoopback: config.allowLoopback }),
    ...(config.maxResponseBytes === undefined ? {} : { maxResponseBytes: config.maxResponseBytes }),
  };
  try {
    return resolveReranker({ kind: config.kind, ...shared } as RerankerConfig);
  } catch (error) {
    prism.status.note("warn", `rag: reranker config rejected: ${error instanceof Error ? error.message : "invalid"}`);
    return undefined;
  }
}

function modelIdOf(ref: ModelRef): string {
  if (typeof ref === "string") {
    const slash = ref.indexOf("/");
    return slash === -1 ? ref : ref.slice(slash + 1);
  }
  return ref.model;
}

function createReindexCommand(run: () => Promise<IndexSourcesResult>): PackageCommand {
  return {
    name: "rag:reindex",
    description: "Re-read every configured RAG source and re-index it.",
    async run(): Promise<JsonObject> {
      const result = await run();
      return { indexed: result.indexed, files: result.files, skipped: result.skipped };
    },
  };
}
