export type * from "./contracts.js";
export { resolveCredentialValue } from "./credentials.js";
export type { CredentialValueSource } from "./credentials.js";
export { createModelRegistry } from "./models.js";
export type { ModelRegistry } from "./models.js";
export { createMockProvider } from "./mock-provider.js";
export type { MockProviderOptions } from "./mock-provider.js";
export {
  providerContentDelta,
  providerDone,
  providerError,
  providerTextDelta,
  providerThinkingDelta,
  providerToolCall,
  providerToolCallDelta,
  providerUsage,
  toolCallContent,
} from "./provider-events.js";
export { createProviderRegistry } from "./providers.js";
export type { ProviderRegistry } from "./providers.js";
export { errorToErrorInfo, redactSecrets } from "./redaction.js";

export const name = "prism";
export const version = "0.0.1";
export const description =
  "Agent harness for AI providers, agents, sessions, and tools.";
