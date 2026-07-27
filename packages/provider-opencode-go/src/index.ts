import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { openCodeGoModels } from "./models.js";
import { createOpenCodeGoProvider } from "./provider.js";

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

export { anthropicMessagesBody, anthropicMessagesEvents } from "./anthropic-messages.js";
export {
  applyOpencodeAnthropicCacheControl,
  OPENCODE_SESSION_ID_MAX_LENGTH,
  opencodeAnthropicCacheEnabled,
  opencodeOwnedHeaders,
  opencodeSessionId,
} from "./cache.js";
export {
  defineOpenCodeGoModel,
  type ListOpenCodeGoModelsOptions,
  listOpenCodeGoModels,
  mapOpenCodeGoModel,
  OPENCODE_GO_DEFAULT_BASE_URL,
  type OpenCodeGoModelConfig,
  type OpenCodeGoModelEntry,
  type OpenCodeGoRoute,
  openCodeGoModels,
  routeForOpenCodeGoModel,
} from "./models.js";
export { openAIChatBody, openAIChatEvents, serializeOpenCodeGoChatMessage } from "./openai-chat.js";
export { createOpenCodeGoProvider, type OpenCodeGoProviderOptions } from "./provider.js";
export {
  openCodeGoPreserveThinking,
  openCodeGoReasoning,
  openCodeGoReasoningEffort,
  openCodeGoThinking,
  stripOpenCodeGoOwnedCompat,
} from "./thinking.js";
