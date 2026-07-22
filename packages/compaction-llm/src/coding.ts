import type { CompactionStrategy } from "@arnilo/prism";
import { createLlmCompactionStrategy, type LlmCompactionStrategyOptions } from "./strategy.js";

export interface CodingCompactionStrategyOptions extends Omit<LlmCompactionStrategyOptions, "name" | "includeFileOperations" | "trackFileOperations" | "customInstructions"> {
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
export function createCodingCompactionStrategy(options: CodingCompactionStrategyOptions): CompactionStrategy {
  return createLlmCompactionStrategy({
    ...options,
    name: "coding",
    trackFileOperations: true,
    includeFileOperations: true,
    customInstructions: [CODING_COMPACTION_INSTRUCTIONS, options.customInstructions].filter(Boolean).join("\n\n"),
  });
}
