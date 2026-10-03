export type { CodingCompactorOptions } from "./coding.js";
export { createCodingCompactor } from "./coding.js";
export { llmCompaction } from "./extension.js";
export type { FileOperationDetails } from "./file-ops.js";
export { collectFileOperations, formatFileOperations } from "./file-ops.js";
export {
  DEFAULT_MAX_SUMMARY_ERROR_BYTES,
  DEFAULT_MAX_SUMMARY_TOKENS,
  DEFAULT_RESERVE_TOKENS,
  HARD_MAX_SUMMARY_ERROR_BYTES,
  HARD_MAX_SUMMARY_TOKENS,
  HARD_RESERVE_TOKENS,
} from "./limits.js";
export type { LlmCompactionEntryData, LlmCompactionPreparation, PrepareLlmCompactionOptions } from "./prepare.js";
export { findLlmCompactionCutPoint, prepareLlmCompaction } from "./prepare.js";
export {
  HISTORY_SUMMARIZATION_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
  TURN_PREFIX_SYSTEM_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from "./prompts.js";
export type { SerializeCompactionConversationOptions } from "./serialize.js";
export { serializeCompactionConversation } from "./serialize.js";
export type { LlmCompactorOptions, ProviderRequestTransform } from "./strategy.js";
export { createLlmCompactor } from "./strategy.js";
export { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "./tokens.js";

export const packageName = "@arnilo/prism-memory/compaction/llm";
