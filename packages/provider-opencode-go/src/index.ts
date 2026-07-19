import { defineProviderPackage, type CredentialValueSource, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { openCodeGoModels } from "./models.js";
import { createOpenCodeGoProvider, type OpenCodeGoProviderOptions } from "./provider.js";

export interface OpenCodeGoProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://opencode.ai/zen/go/v1`. */
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export function createOpenCodeGoProviderPackage(options: OpenCodeGoProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-provider-opencode-go",
    description: "OpenCode Go provider package for Prism.",
    docs: { links: ["docs/providers/opencode-go.md"] },
    setup(api) {
      api.registerProvider(createOpenCodeGoProvider(options));
      for (const model of options.models ?? openCodeGoModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "opencode-go", credentialName: "apiKey" });
    },
  });
}

export { createOpenCodeGoProvider, type OpenCodeGoProviderOptions } from "./provider.js";
export {
  OPENCODE_GO_DEFAULT_BASE_URL,
  defineOpenCodeGoModel,
  listOpenCodeGoModels,
  mapOpenCodeGoModel,
  openCodeGoModels,
  routeForOpenCodeGoModel,
  type ListOpenCodeGoModelsOptions,
  type OpenCodeGoModelConfig,
  type OpenCodeGoModelEntry,
  type OpenCodeGoRoute,
} from "./models.js";
export {
  OPENCODE_SESSION_ID_MAX_LENGTH,
  applyOpencodeAnthropicCacheControl,
  opencodeAnthropicCacheEnabled,
  opencodeOwnedHeaders,
  opencodeSessionId,
} from "./cache.js";
export {
  openCodeGoPreserveThinking,
  openCodeGoReasoning,
  openCodeGoReasoningEffort,
  openCodeGoThinking,
  stripOpenCodeGoOwnedCompat,
} from "./thinking.js";
export { anthropicMessagesBody, anthropicMessagesEvents } from "./anthropic-messages.js";
export { openAIChatBody, openAIChatEvents, serializeOpenCodeGoChatMessage } from "./openai-chat.js";
