export type { CodingCompactionStrategyOptions } from "./coding.js";
export { createCodingCompactionStrategy } from "./coding.js";
export type { LlmCompactionExtensionOptions } from "./extension.js";
export { createLlmCompactionExtension } from "./extension.js";
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
export type { LlmCompactionStrategyOptions } from "./strategy.js";
export { createLlmCompactionStrategy } from "./strategy.js";
export { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "./tokens.js";

export const packageName = "@arnilo/prism-memory/compaction/llm";
