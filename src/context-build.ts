import { createId } from "./ids.js";
import type { ContextBlock, Message } from "./contracts.js";
import type { ContextDraft, HookRegistrar } from "./hooks/types.js";

/**
 * A named block of host text contributed to the provider view every turn. This is the shape
 * `InstructionInjector` and `ContextProvider` collapse to now that both are `context.build`
 * handlers (plan 145 Task 4): instructions and context blocks, nothing else. A source cannot grant
 * tools, skills, or permissions — it can only add text to the draft.
 */
export interface ContextSource {
  readonly name: string;
  readonly instructions?: string;
  readonly contextBlocks?: readonly ContextBlock[];
}

/**
 * Append `blocks` to a draft's context, or return `undefined` when there is nothing to add — the
 * transform's way of saying "no change", so the controller skips re-deriving the request.
 */
export function withContextBlocks(draft: ContextDraft, blocks: readonly ContextBlock[]): ContextDraft | undefined {
  if (blocks.length === 0) return undefined;
  return { ...draft, context: [...(draft.context ?? []), ...blocks] };
}

function systemMessage(text: string): Message {
  return { id: createId("msg"), role: "system", content: [{ type: "text", text }] };
}

/**
 * Insert a system message behind the leading system block and ahead of the dynamic transcript.
 * The kernel's own assembly already puts the agent's instructions at the front
 * (`buildProviderMessages` in `src/input.ts`); a `context.build` handler composes on top of that,
 * so its text belongs at the end of the stable prefix rather than at the head of the transcript.
 */
function withInstruction(messages: readonly Message[], text: string): readonly Message[] {
  const boundary = messages.findIndex((message) => message.role !== "system");
  const at = boundary === -1 ? messages.length : boundary;
  return [...messages.slice(0, at), systemMessage(text), ...messages.slice(at)];
}

/**
 * Register `sources` as one `context.build` handler, in order: each source's instructions become a
 * system message at the stable-prefix boundary and its context blocks append to the draft's
 * context. The draft is the provider view only, so nothing here reaches the store.
 *
 * Register once per registrar. An empty list registers nothing, so a host that configured no
 * sources keeps the exact pre-1.0 request bytes.
 */
export function registerContextSources(hooks: HookRegistrar, sources: readonly ContextSource[]): void {
  const contributing = sources.filter((source) => source.instructions !== undefined || source.contextBlocks?.length);
  if (contributing.length === 0) return;
  hooks.on(
    "context.build",
    (draft: ContextDraft): ContextDraft => {
      let messages = draft.messages;
      let context = draft.context;
      for (const source of contributing) {
        if (source.instructions) messages = withInstruction(messages, source.instructions);
        if (source.contextBlocks?.length) context = [...(context ?? []), ...source.contextBlocks];
      }
      return context === draft.context ? { ...draft, messages } : { ...draft, messages, context };
    },
    { id: "context-sources" },
  );
}
