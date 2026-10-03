import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
import { createOpenCodeGoProvider } from "./provider.js";

export interface OpenCodeGoProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://opencode.ai/zen/go/v1`. */
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
}

export function opencodeGoPackage(options: OpenCodeGoProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.opencode-go", "OpenCode Go provider package for Prism.", () => [
    createOpenCodeGoProvider(options),
  ]);
}

export { anthropicMessagesBody, anthropicMessagesEvents } from "../shared/anthropic-messages.js";
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
  openCodeGoThinkingFamily,
  openCodeGoThinkingLevels,
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
