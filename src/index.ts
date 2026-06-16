export type * from "./contracts.js";
export { assertJsonObject, isJsonObject, loadConfigLayers, mergeConfigLayers } from "./config.js";
export type { ConfigLayer, ConfigLoadContext, ConfigProvider } from "./config.js";
export { createContributionRegistries, createContributionRegistry } from "./contributions.js";
export type { ContributionRegistries, ContributionRegistry, ContributionRegistryOptions } from "./contributions.js";
export { resolveCredentialValue } from "./credentials.js";
export { createExtensionEventBus, createExtensionKernel } from "./extensions.js";
export type { ExtensionErrorPolicy, ExtensionEventBus, ExtensionEventHandler, ExtensionKernel, ExtensionKernelOptions } from "./extensions.js";
export type { CredentialValueSource } from "./credentials.js";
export { createModelRegistry } from "./models.js";
export type { ModelRegistry } from "./models.js";
export { definePrismManifest, parsePrismManifest } from "./manifests.js";
export type { ManifestContributionDeclaration, ManifestContributionKind, ManifestResourceDeclaration, PrismManifest } from "./manifests.js";
export { loadJsonResource, loadManifestResource, loadTextResource } from "./resources.js";
export { createMiddlewareRegistry } from "./middleware.js";
export type { Middleware, MiddlewareHookName, MiddlewareNext, MiddlewareRegistry, MiddlewareRegistryOptions } from "./middleware.js";
export { assembleProviderInput, createDefaultInputBuilder, createDefaultPromptBuilder, resolveContextProviders } from "./input.js";
export type { AgentInput, AssembleProviderInputOptions, DefaultInputBuilder, DefaultInputBuildContext, DefaultPromptBuilder, InputAttachment, PromptInstruction, ResolveContextOptions } from "./input.js";
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
export { createToolRegistry, dispatchToolCall, filterTools } from "./tools.js";
export type { DispatchToolCallOptions, ToolFilter, ToolFilterInput, ToolValidator } from "./tools.js";

export const name = "prism";
export const version = "0.0.1";
export const description =
  "Agent harness for AI providers, agents, sessions, and tools.";
