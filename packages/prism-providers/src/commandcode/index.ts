import { type CredentialValueSource, defineProviderPackage, type ModelConfig, type ProviderPackage } from "@arnilo/prism";
import { commandCodeModels } from "./models.js";
import { createCommandCodeProvider } from "./provider.js";

export interface CommandCodeProviderPackageOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://api.commandcode.ai/provider/v1`. */
  readonly baseUrl?: string;
  readonly models?: readonly ModelConfig[];
  /** Enforce zero data retention (`x-cmd-zdr: 1`); see {@link CommandCodeProviderOptions.zdr}. */
  readonly zdr?: boolean;
}

export function createCommandCodeProviderPackage(options: CommandCodeProviderPackageOptions = {}): ProviderPackage {
  return defineProviderPackage({
    name: "@arnilo/prism-providers/commandcode",
    description: "Command Code provider package for Prism.",
    docs: { links: ["docs/providers/commandcode.md"] },
    setup(api) {
      api.registerProvider(createCommandCodeProvider(options));
      for (const model of options.models ?? commandCodeModels) api.registerModel(model);
      api.registerAuthMethod({ kind: "api_key", provider: "commandcode", credentialName: "apiKey" });
    },
  });
}

export { applyCommandCodeCacheControl, commandCodeCacheEnabled } from "./cache.js";
export {
  type CommandCodeModelConfig,
  type CommandCodeModelEntry,
  type CommandCodeRoute,
  commandCodeModels,
  COMMAND_CODE_DEFAULT_BASE_URL,
  defineCommandCodeModel,
  listCommandCodeModels,
  mapCommandCodeModel,
  routeForCommandCodeModel,
} from "./models.js";
export { commandCodeChatBody, commandCodeChatEvents, serializeCommandCodeChatMessage } from "./openai-chat.js";
export { createCommandCodeProvider, type CommandCodeProviderOptions } from "./provider.js";
export {
  classifyCommandCodeError,
  commandCodeHttpError,
  type CommandCodeErrorInput,
  type CommandCodeRetryDecision,
} from "./errors.js";
export { commandCodePreserveThinking, stripCommandCodeOwnedCompat } from "./thinking.js";
