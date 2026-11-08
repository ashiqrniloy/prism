import type { ContextBlock, ContextDraft, HookContext, HookRegistrar } from "@arnilo/prism";
import { withContextBlocks } from "@arnilo/prism";
import { retrieveContext } from "./retrieve.js";
import type { RagContextProviderOptions } from "./types.js";
import { latestUserText } from "./util.js";

/**
 * RAG retrieval as a `context.build` handler (roadmap §2.4): the retrieved blocks join the draft
 * for this turn only, and the session store is never touched. Returns undefined when retrieval
 * finds nothing so the request keeps its exact bytes.
 */
export function registerRagContext(hooks: HookRegistrar, options: RagContextProviderOptions): void {
  const name = options.name ?? "rag";
  hooks.on(
    "context.build",
    async (draft: ContextDraft, context: HookContext): Promise<ContextDraft | undefined> => {
      context.signal?.throwIfAborted();
      const query =
        typeof options.query === "function"
          ? options.query({ messages: draft.messages })
          : (options.query ?? latestUserText(draft.messages));
      if (!query?.trim()) return undefined;
      if (options.prepare) await options.prepare(context.signal);
      const result = await retrieveContext(query, { ...options, signal: context.signal });
      if (!result.text) return undefined;
      const blocks: readonly ContextBlock[] = [
        {
          id: `${name}:context`,
          title: options.title ?? "Retrieved context",
          content: result.text,
          metadata: { citations: result.citations, trust: result.trust, inert: true, untrusted: true, injectionCapable: true },
        },
      ];
      return withContextBlocks(draft, blocks);
    },
    { id: name },
  );
}
