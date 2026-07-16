import type { LanguageModelV4 } from "@ai-sdk/provider";

export interface AiSdkProviderOptions {
  /** Host-owned AI SDK language model implementing specification v4. */
  readonly model: LanguageModelV4;
  /** Prism provider id. Defaults to `ai-sdk` or `ai-sdk:<model.provider>`. */
  readonly id?: string;
}

export const SUPPORTED_AI_SDK_SPECIFICATION = "v4" as const;
