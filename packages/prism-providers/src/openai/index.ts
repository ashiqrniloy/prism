import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { createOpenAICodexProvider } from "./codex.js";
import { openAICodexModels, openAIModels } from "./models.js";
import { openAICodexOAuthProvider } from "./oauth.js";
import { createOpenAIResponsesProvider } from "./responses.js";

export interface OpenAIProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly codexAccessToken?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly codexBaseUrl?: string;
  /** Host override for registered OpenAI Responses models (defaults to featured `openAIModels`). */
  readonly models?: readonly ModelConfig[];
  /** Host override for registered Codex models (defaults to featured `openAICodexModels`). */
  readonly codexModels?: readonly ModelConfig[];
}

export function createOpenAIProviderPackage(options: OpenAIProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-providers/openai",
    description: "OpenAI provider package for Prism.",
    docs: { links: ["docs/providers/openai.md"] },
    setup(api) {
      api.registerProvider(createOpenAIResponsesProvider({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.fetch }));
      api.registerProvider(
        createOpenAICodexProvider({ accessToken: options.codexAccessToken, baseUrl: options.codexBaseUrl, fetch: options.fetch }),
      );
      for (const model of options.models ?? openAIModels) api.registerModel(model);
      for (const model of options.codexModels ?? openAICodexModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "openai", credentialName: "apiKey" });
      api.registerAuthMethod({ kind: "oauth", provider: "openai-codex", oauth: openAICodexOAuthProvider });
    },
  });
}

export {
  createOpenAIBatchJobsProvider,
  OPENAI_BATCH_COMPLETION_WINDOW,
  OPENAI_BATCH_MAX_REQUESTS,
  type OpenAIBatchJobsOptions,
} from "./batch.js";
export {
  applyPromptCacheBreakpoints,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
  promptCacheKey,
  promptCacheOptions,
  promptCacheRetention,
} from "./cache.js";
export { createOpenAICodexProvider, type OpenAICodexProviderOptions } from "./codex.js";
export {
  createOpenAIEmbeddingsProvider,
  OPENAI_EMBEDDINGS_MAX_BATCH_SIZE,
  type OpenAIEmbeddingsOptions,
} from "./embeddings.js";
export {
  createOpenAIImageGenerationProvider,
  DEFAULT_IMAGE_MAX_BYTES,
  OPENAI_IMAGE_MAX_COUNT,
  OPENAI_IMAGE_PROMPT_MAX_CHARS,
  type OpenAIImageGenerationOptions,
} from "./images.js";
export {
  defineOpenAIModel,
  type ListOpenAIModelsOptions,
  listOpenAIModels,
  mapOpenAIModel,
  type OpenAIModelConfig,
  type OpenAIModelEntry,
  openAICodexModels,
  openAIDefaultEffort,
  openAIModels,
  openAIThinkingLevels,
} from "./models.js";
export {
  createOpenAIModerationProvider,
  OPENAI_MODERATION_DEFAULT_MODEL,
  OPENAI_MODERATION_INPUT_MAX_CHARS,
  OPENAI_MODERATION_MAX_RESPONSE_BYTES,
  type OpenAIModerationOptions,
} from "./moderation.js";
export {
  computeS256Challenge,
  createOpenAICodexOAuthProvider,
  createPkceVerifier,
  type OpenAICodexOAuthOptions,
  openAICodexOAuthProvider,
} from "./oauth.js";
export {
  createOpenAIRealtimeSession,
  type OpenAIRealtimeSessionOptions,
  type RealtimeTransport,
  type RealtimeTransportOptions,
} from "./realtime.js";
export { createOpenAIResponsesProvider, type OpenAIResponsesProviderOptions, resolveOpenAIReasoning } from "./responses.js";
export {
  createOpenAISpeechProvider,
  DEFAULT_SPEECH_MAX_AUDIO_BYTES,
  OPENAI_SPEECH_MAX_INPUT_CHARS,
  type OpenAISpeechOptions,
} from "./speech.js";
export {
  createOpenAITranscriptionProvider,
  OPENAI_TRANSCRIPTION_MAX_AUDIO_BYTES,
  type OpenAITranscriptionOptions,
} from "./transcription.js";
