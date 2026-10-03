import { type CredentialValueSource, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { vendorPackage } from "../shared/package.js";
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

export function commandcodePackage(options: CommandCodeProviderPackageOptions = {}): PackageInstance {
  return vendorPackage("@arnilo/prism-providers.commandcode", "Command Code provider package for Prism.", () => [
    createCommandCodeProvider(options),
  ]);
}

export { applyCommandCodeCacheControl, commandCodeCacheEnabled } from "./cache.js";
export {
  type CommandCodeErrorInput,
  type CommandCodeRetryDecision,
  classifyCommandCodeError,
  commandCodeHttpError,
} from "./errors.js";
export {
  COMMAND_CODE_DEFAULT_BASE_URL,
  type CommandCodeModelConfig,
  type CommandCodeModelEntry,
  type CommandCodeRoute,
  commandCodeModels,
  commandCodeThinkingFamily,
  commandCodeThinkingLevels,
  defineCommandCodeModel,
  listCommandCodeModels,
  mapCommandCodeModel,
  routeForCommandCodeModel,
} from "./models.js";
export { commandCodeChatBody, commandCodeChatEvents, serializeCommandCodeChatMessage } from "./openai-chat.js";
export {
  COMMAND_CODE_ANTHROPIC_HOOKS,
  type CommandCodeProviderOptions,
  createCommandCodeProvider,
} from "./provider.js";
export {
  commandCodeEffort,
  commandCodePreserveThinking,
  commandCodeReasoning,
  commandCodeThinking,
  stripCommandCodeOwnedCompat,
} from "./thinking.js";
