import { resolveRedactor } from "@arnilo/prism";
import { RagAbortError, RagLimitError, RagValidationError } from "./errors.js";
import type { RagHit, Reranker } from "./types.js";
import { assertNotAborted, byteLength } from "./util.js";

const active = new WeakMap<Reranker, number>();

export async function rerankHits(
  query: string,
  hits: readonly RagHit[],
  options: {
    readonly reranker: Reranker;
    readonly maxBytes: number;
    readonly maxMs: number;
    readonly concurrency: number;
    readonly signal?: AbortSignal;
    readonly redactor?: Parameters<typeof resolveRedactor>[0];
    readonly secrets?: Parameters<typeof resolveRedactor>[1];
  },
): Promise<readonly RagHit[]> {
  assertNotAborted(options.signal);
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const safeQuery = redactor?.redact(query) ?? query;
  const safeHits = hits.map((hit) => redactor?.redact(hit) ?? hit);
  if (byteLength({ query: safeQuery, hits: safeHits }) > options.maxBytes) {
    throw new RagLimitError(`reranker input exceeds ${options.maxBytes} bytes`);
  }
  const running = active.get(options.reranker) ?? 0;
  if (running >= options.concurrency) throw new RagLimitError(`reranker concurrency exceeds ${options.concurrency}`);
  active.set(options.reranker, running + 1);
  const release = () => {
    const remaining = (active.get(options.reranker) ?? 1) - 1;
    if (remaining) active.set(options.reranker, remaining);
    else active.delete(options.reranker);
  };
  try {
    const ordered = await boundedRerank(
      (signal) => options.reranker.rerank({ query: safeQuery, hits: safeHits, signal }),
      (operation) => {
        void operation.then(release, release);
      },
      options.maxMs,
      options.signal,
    );
    const originals = new Map(hits.map((hit) => [hit.id, hit]));
    if (ordered.length !== hits.length || new Set(ordered.map((hit) => hit.id)).size !== hits.length) {
      throw new RagValidationError("reranker must return each retrieved hit exactly once");
    }
    const output = ordered.map((hit) => originals.get(hit.id));
    if (output.some((hit) => !hit)) throw new RagValidationError("reranker returned an unknown hit");
    return Object.freeze(output as RagHit[]);
  } catch (error) {
    if (error instanceof RagAbortError || error instanceof RagLimitError || error instanceof RagValidationError) throw error;
    const message = error instanceof Error ? error.message : "reranker failed";
    throw new RagValidationError(`reranker failed: ${redactor?.redact(message) ?? message}`);
  }
}

async function boundedRerank(
  run: (signal: AbortSignal) => Promise<readonly RagHit[]>,
  onStart: (operation: Promise<readonly RagHit[]>) => void,
  maxMs: number,
  signal?: AbortSignal,
): Promise<readonly RagHit[]> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), maxMs);
  const aborted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener(
      "abort",
      () => {
        reject(signal?.aborted ? new RagAbortError() : new RagLimitError(`reranker exceeded ${maxMs}ms`));
      },
      { once: true },
    ),
  );
  const operation = Promise.resolve().then(() => run(controller.signal));
  onStart(operation);
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
