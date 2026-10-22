import type { ContextBlock, ContextDraft, Message } from "@arnilo/prism";
import { estimateMessageTokens } from "@arnilo/prism";
import { contentToText } from "./util.js";

/** Apply on every context.build call, after engineering (hook priority below -1000). */
export function withTailContext(draft: ContextDraft, blocks: readonly ContextBlock[]): ContextDraft {
  if (blocks.length === 0) return draft;
  const rendered = blocks.map(
    (block): Message => ({
      role: "system",
      content: [
        {
          type: "text",
          text: `${block.title ? `${block.title}:` : "Context:"}\n${typeof block.content === "string" ? block.content : contentToText(block.content)}`,
        },
      ],
    }),
  );
  const message: Message = {
    role: "system",
    content: rendered.flatMap((block, index) => [...(index > 0 ? [{ type: "text" as const, text: "\n\n" }] : []), ...block.content]),
    metadata: {
      contextBlocks: blocks.map((block, index) => ({
        // Carry the whole block envelope (e.g. `untrusted`/`inert`), then the tail fields.
        ...block.metadata,
        title: block.title,
        source: block.metadata?.source,
        itemIds: block.metadata?.itemIds,
        tokens: block.metadata?.tokens ?? estimateMessageTokens(rendered[index]!),
      })),
    },
  };
  let anchor = draft.messages.length;
  for (let index = draft.messages.length - 1; index >= 0; index--) {
    if (draft.messages[index]!.role === "user") {
      anchor = index;
      break;
    }
  }
  return { ...draft, messages: [...draft.messages.slice(0, anchor), message, ...draft.messages.slice(anchor)] };
}
