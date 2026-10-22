/**
 * Plan 089 Task 2: deployable local (in-process) reranker — the zero-service
 * default. A small cross-encoder (bge-reranker-base class) runs in the host's
 * own process, so adoption needs no TEI/hosted endpoint, no credential, and no
 * per-query egress.
 *
 * The model runtime is a host seam (`LocalRerankRuntime`), exactly like
 * `Embedder`: the package declares no inference dependency, so no new runtime
 * dependency name enters any manifest. When the host passes no runtime, the
 * built-in loader resolves `@huggingface/transformers` at first use with a
 * non-literal specifier (nothing to resolve at build/install time). Missing
 * runtime/model fails loud with install guidance — there is deliberately no
 * silent lexical fallback: a reranker that silently degrades is a reranker the
 * operator cannot trust.
 */
import { RagAbortError, RagValidationError } from "./errors.js";
import { orderHitsByScores } from "./rerank-shared.js";
import type { RagHit, Reranker } from "./types.js";
import { assertNotAborted } from "./util.js";

/** Default model: the transformers.js repo id for a bge-reranker-base class cross-encoder. */
export const DEFAULT_LOCAL_RERANK_MODEL = "Xenova/bge-reranker-base";

/** Same sentence on every failure path, so a missing model is never a mystery. */
const INSTALL_HINT = "install a local inference runtime (npm i @huggingface/transformers) or pass { runtime } backed by your own runtime";

/** One loaded cross-encoder: score every (query, document) pair in a single batch call. */
export interface LocalRerankModel {
  /** Model identity for errors/telemetry; never document text. */
  readonly id: string;
  score(input: {
    readonly query: string;
    readonly documents: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<readonly number[]>;
}

/** Host-owned local inference runtime (transformers.js, onnxruntime-node, llama.cpp, …). */
export interface LocalRerankRuntime {
  /** Load (or fetch-and-cache) one model; called lazily once per reranker instance. */
  load(model: string): Promise<LocalRerankModel>;
}

/** Pass-through knobs for the built-in transformers.js loader. */
export interface TransformersRerankRuntimeOptions {
  /** Directory the runtime caches downloaded weights in. */
  readonly cacheDir?: string;
  /** Runtime default: `true`. `false` keeps the runtime strictly offline (local files only). */
  readonly allowRemoteModels?: boolean;
  /** Weight precision hint, e.g. `q8`; runtime default when omitted. */
  readonly dtype?: string;
  /** Execution device hint, e.g. `cpu`; runtime default when omitted. */
  readonly device?: string;
}

export interface CreateLocalRerankerOptions extends TransformersRerankRuntimeOptions {
  /** Runtime-relative model id. Default `DEFAULT_LOCAL_RERANK_MODEL`. */
  readonly model?: string;
  /** Host runtime; omit to use the built-in transformers.js loader. */
  readonly runtime?: LocalRerankRuntime;
  /** Opt-in load observability — called once per loaded model, never with document text. */
  readonly onLoad?: (info: { readonly model: string; readonly loadMs: number }) => void;
}

/**
 * Build the built-in transformers.js runtime. The dependency is resolved at
 * first `load()` (non-literal specifier) and is never declared in a manifest, so
 * installs stay lean; a missing package fails with install guidance.
 */
export function createTransformersRerankRuntime(options: TransformersRerankRuntimeOptions = {}): LocalRerankRuntime {
  return {
    async load(model: string): Promise<LocalRerankModel> {
      const transformers = await loadTransformersModule();
      const settings = {
        ...(options.cacheDir ? { cache_dir: options.cacheDir } : {}),
        ...(options.dtype ? { dtype: options.dtype } : {}),
        ...(options.device ? { device: options.device } : {}),
        ...(options.allowRemoteModels === false ? { local_files_only: true } : {}),
      };
      const tokenizer = await transformers.AutoTokenizer.from_pretrained(model, settings);
      const crossEncoder = await transformers.AutoModelForSequenceClassification.from_pretrained(model, settings);
      return {
        id: model,
        async score({ query, documents, signal }): Promise<readonly number[]> {
          assertNotAborted(signal);
          const inputs = await tokenizer(
            documents.map(() => query),
            { text_pair: documents, padding: true, truncation: true },
          );
          const outputs = await crossEncoder(inputs);
          assertNotAborted(signal);
          const data = outputs?.logits?.data;
          if (!data || data.length !== documents.length) {
            throw new RagValidationError(`local reranker ${model} returned no per-document scores (expected ${documents.length})`);
          }
          return Array.from(data, Number);
        },
      };
    },
  };
}

interface TransformersModule {
  readonly AutoTokenizer: { from_pretrained(id: string, options?: unknown): Promise<TransformersTokenizer> };
  readonly AutoModelForSequenceClassification: {
    from_pretrained(id: string, options?: unknown): Promise<TransformersSequenceClassifier>;
  };
}

type TransformersTokenizer = (
  texts: readonly string[],
  options: { readonly text_pair: readonly string[]; readonly padding: boolean; readonly truncation: boolean },
) => Promise<unknown>;

type TransformersSequenceClassifier = (inputs: unknown) => Promise<{ readonly logits?: { readonly data?: ArrayLike<number> } } | undefined>;

/** Non-literal specifier: the optional runtime is resolved at use time, never at build or install time. */
const TRANSFORMERS_MODULE = "@huggingface/transformers";

async function loadTransformersModule(): Promise<TransformersModule> {
  let loaded: unknown;
  try {
    loaded = await import(TRANSFORMERS_MODULE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "module not found";
    throw new RagValidationError(`local reranker unavailable (${reason}): ${INSTALL_HINT}`);
  }
  const module = loaded as Partial<TransformersModule>;
  if (
    typeof module.AutoTokenizer?.from_pretrained !== "function" ||
    typeof module.AutoModelForSequenceClassification?.from_pretrained !== "function"
  ) {
    throw new RagValidationError(
      `local reranker runtime @huggingface/transformers exposes no tokenizer/sequence classifier: ${INSTALL_HINT}`,
    );
  }
  return module as TransformersModule;
}

/**
 * Local reranker over the `Reranker` seam: lazy, memoized model load; one
 * batched `score` call per rerank (never one call per document); and a frozen
 * permutation of the exact input hits, so provenance/trust move untouched and
 * `rerankHits` caps/abort/timeout stay in charge.
 */
export function createLocalReranker(options: CreateLocalRerankerOptions = {}): Reranker {
  if (options.runtime && typeof options.runtime.load !== "function") {
    throw new RagValidationError(`local reranker runtime must expose load(model): ${INSTALL_HINT}`);
  }
  const model = options.model?.trim() || DEFAULT_LOCAL_RERANK_MODEL;
  const runtime = options.runtime ?? createTransformersRerankRuntime(options);
  let pending: Promise<LocalRerankModel> | undefined;

  const load = (): Promise<LocalRerankModel> => {
    if (!pending) {
      pending = (async () => {
        const started = Date.now();
        let loaded: LocalRerankModel;
        try {
          loaded = await runtime.load(model);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "load failed";
          throw new RagValidationError(`local reranker could not load model ${model} (${reason}); ${INSTALL_HINT}`);
        }
        if (!loaded || typeof loaded.score !== "function") {
          throw new RagValidationError(`local reranker runtime returned no scoring model for ${model}: ${INSTALL_HINT}`);
        }
        options.onLoad?.({ model: loaded.id || model, loadMs: Date.now() - started });
        return loaded;
      })();
    }
    return pending;
  };

  return {
    async rerank({ query, hits, signal }): Promise<readonly RagHit[]> {
      if (hits.length === 0) return [];
      const loaded = await load();
      assertNotAborted(signal);
      const scores = await loaded.score({ query, documents: hits.map((hit) => hit.text), signal }).catch((error: unknown) => {
        if (error instanceof RagValidationError || error instanceof RagAbortError) throw error;
        const reason = error instanceof Error ? error.message : "scoring failed";
        throw new RagValidationError(`local reranker ${model} failed: ${reason}`);
      });
      return orderHitsByScores(hits, scores, `local reranker ${model}`);
    },
  };
}
