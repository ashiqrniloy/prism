import type { ContextProvider } from "@arnilo/prism";
import { retrieveContext } from "./retrieve.js";
import type { RagContextProviderOptions } from "./types.js";
import { latestUserText } from "./util.js";

export function createRagContextProvider(options: RagContextProviderOptions): ContextProvider {
  return {
    name: options.name ?? "rag",
    async resolve(context) {
      context.signal?.throwIfAborted();
      const query = typeof options.query === "function"
        ? options.query({ messages: context.messages })
        : options.query ?? latestUserText(context.messages);
      if (!query?.trim()) return [];
      const result = await retrieveContext(query, { ...options, signal: context.signal });
      if (!result.text) return [];
      return [{
        id: `${options.name ?? "rag"}:context`,
        title: options.title ?? "Retrieved context",
        content: result.text,
        metadata: { citations: result.citations, inert: true },
      }];
    },
  };
}
