import { type Compactor, isCompactionEntryData, type SessionEntry } from "@arnilo/prism";
import { createLlmCompactor, type LlmCompactorOptions } from "./strategy.js";

export interface CodingCompactorOptions
  extends Omit<LlmCompactorOptions, "name" | "includeFileOperations" | "trackFileOperations" | "customInstructions"> {
  /** Extra host focus, appended after the coding baseline. */
  readonly customInstructions?: string;
}

const CODING_COMPACTION_INSTRUCTIONS = `For coding work, prioritize:
- modified and read file paths;
- compact diff or patch intent, affected symbols, and why a change was made;
- commands run and concise failing-check summaries;
- plan and todo state, blockers, and next verification command.
Retain decisions needed to continue safely. Do not retain complete diffs or raw command output when a bounded hunk or result summary is enough.`;

/** LLM compaction preset for coding sessions; raw history remains in the session store. */
export function createCodingCompactor(options: CodingCompactorOptions): Compactor {
  return createLlmCompactor({
    ...options,
    name: "coding",
    trackFileOperations: true,
    includeFileOperations: true,
    customInstructions: [CODING_COMPACTION_INSTRUCTIONS, options.customInstructions].filter(Boolean).join("\n\n"),
  });
}

/**
 * Keeps the latest plan turn out of the cut. The plan lives in history, and a token-based cut would
 * summarize it away: an assistant tool call plus its results whose result carries todo-list metadata,
 * the marker `@arnilo/prism-tools/coding` writes. Ids are re-pinned on every compaction, so one plan
 * written at the start of a long run survives any number of cuts. Wraps any compactor, including the
 * kernel default the package falls back to.
 */
export function keepLatestPlanTurn(compactor: Compactor): Compactor {
  return {
    ...compactor,
    async compact(context) {
      const result = await compactor.compact(context);
      const pinned = planTurnEntryIds(context.entries);
      if (pinned.length === 0) return result;
      const source = result.entries?.find((entry) => entry.kind === "compaction");
      const data = source?.data;
      if (source === undefined || !isCompactionEntryData(data)) return result;
      const keepEntryIds = [...(data.keepEntryIds ?? []), ...pinned.filter((id) => !data.keepEntryIds?.includes(id))];
      return {
        ...result,
        entries: result.entries?.map((entry) => (entry === source ? { ...entry, data: { ...data, keepEntryIds } } : entry)),
      };
    },
  };
}

/** The entries of the latest plan turn: its assistant call, then every tool result that answers it. */
export function planTurnEntryIds(entries: readonly SessionEntry[]): readonly string[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const message = entry?.kind === "message" ? entry.message : undefined;
    if (message?.role !== "tool" || !isTodoList(message.metadata)) continue;
    const toolCallId = message.content.find((block) => block.type === "tool_result")?.toolCallId;
    if (toolCallId === undefined) continue;
    const start = assistantCallIndex(entries, index, toolCallId);
    if (start < 0) return [];
    const ids: string[] = [];
    for (let cursor = start; cursor < entries.length; cursor += 1) {
      const current = entries[cursor];
      if (current?.kind !== "message" || current.message === undefined) break;
      if (cursor > start && current.message.role !== "tool") break;
      ids.push(current.id);
    }
    return ids;
  }
  return [];
}

/** The todo-list metadata shape `todo_write` writes: an array under `todos`. */
function isTodoList(metadata: Readonly<Record<string, unknown>> | undefined): boolean {
  return Array.isArray(metadata?.todos);
}

function assistantCallIndex(entries: readonly SessionEntry[], before: number, toolCallId: string): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role !== "assistant") continue;
    if (message.content.some((block) => block.type === "tool_call" && block.id === toolCallId)) return index;
  }
  return -1;
}
