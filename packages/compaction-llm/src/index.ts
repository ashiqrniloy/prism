export { createLlmCompactionExtension } from "./extension.js";
export type { LlmCompactionExtensionOptions } from "./extension.js";
export { collectFileOperations, formatFileOperations } from "./file-ops.js";
export type { FileOperationDetails } from "./file-ops.js";
export { findLlmCompactionCutPoint, prepareLlmCompaction } from "./prepare.js";
export type { LlmCompactionEntryData, LlmCompactionPreparation, PrepareLlmCompactionOptions } from "./prepare.js";
export { HISTORY_SUMMARIZATION_PROMPT, SUMMARIZATION_SYSTEM_PROMPT, TURN_PREFIX_SYSTEM_PROMPT, UPDATE_SUMMARIZATION_PROMPT } from "./prompts.js";
export { serializeCompactionConversation } from "./serialize.js";
export type { SerializeCompactionConversationOptions } from "./serialize.js";
export { createLlmCompactionStrategy } from "./strategy.js";
export type { LlmCompactionStrategyOptions } from "./strategy.js";
export { estimateEntryTokens, estimateMessageTokens, estimateTextTokens } from "./tokens.js";

export const packageName = "@prism/compaction-llm";
