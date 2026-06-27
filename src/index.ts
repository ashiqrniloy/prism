export type * from "./contracts.js";
export { createAgent, createAgentSession } from "./agents.js";
export { parseSkillFile, parseAgentFile } from "./contribution-parsing.js";
export { assertJsonObject, isJsonObject, loadConfigLayers, mergeConfigLayers } from "./config.js";
export type { ConfigLayer, ConfigLoadContext, ConfigProvider } from "./config.js";
export { createDefaultCompactionStrategy, isCompactionEntryData } from "./compaction.js";
export type { DefaultCompactionStrategyOptions } from "./compaction.js";
export { createDefaultRetryPolicy, isTransientErrorInfo, waitForRetry } from "./retry.js";
export type { DefaultRetryPolicyOptions } from "./retry.js";
export { createContributionRegistries, createContributionRegistry, registerDiscoveredContributions } from "./contributions.js";
export type { ContributionRegistries, ContributionRegistry, ContributionRegistryOptions } from "./contributions.js";
export { createChainedCredentialResolver, createEnvCredentialResolver, createExplicitCredentialResolver, createMemoryCredentialStore, refreshOAuthCredential, resolveCredentialValue } from "./credentials.js";
export { createExtensionEventBus, createExtensionKernel } from "./extensions.js";
export type { ExtensionErrorPolicy, ExtensionEventBus, ExtensionEventHandler, ExtensionKernel, ExtensionKernelOptions } from "./extensions.js";
export type { CredentialRecord, CredentialValueSource, MemoryCredentialStore } from "./credentials.js";
export { createModelRegistry } from "./models.js";
export { authMethodKey, defineProviderPackage, systemPromptContributionKey } from "./provider-packages.js";
export { createProviderRequestPolicyChain, createSessionCachePolicy, mergeProviderRequestOptions } from "./provider-request-policy.js";
export type { SessionCachePolicyOptions } from "./provider-request-policy.js";
export { composeSystemPrompt, mergeSystemPromptConfig } from "./system-prompts.js";
export type { ComposeSystemPromptOptions } from "./system-prompts.js";
export type { ModelRegistry } from "./models.js";
export { definePrismManifest, parsePrismManifest } from "./manifests.js";
export type { ManifestContributionDeclaration, ManifestContributionKind, ManifestResourceDeclaration, PrismManifest } from "./manifests.js";
export { loadJsonResource, loadManifestResource, loadTextResource } from "./resources.js";
export { createChainedSettingsProvider, createStaticSettingsProvider } from "./settings.js";
export { createMiddlewareRegistry } from "./middleware.js";
export type { Middleware, MiddlewareHookName, MiddlewareNext, MiddlewareRegistry, MiddlewareRegistryOptions } from "./middleware.js";
export { assembleProviderInput, createDefaultInputBuilder, createDefaultPromptBuilder, renderPromptTemplate, resolveContextProviders } from "./input.js";
export type { AgentInput, AssembleProviderInputOptions, DefaultInputBuilder, DefaultInputBuildContext, DefaultPromptBuilder, InputAttachment, PromptInstruction, PromptTemplateOptions, ResolveContextOptions } from "./input.js";
export { createMockProvider } from "./mock-provider.js";
export { createMemorySessionStore, createSessionEntry, getSessionBranchEntries, listSessionBranches, rebuildSessionContext } from "./session-stores.js";
export type { CreateSessionEntryOptions, SessionBranch, SessionBranchOptions, SessionContextSnapshot } from "./session-stores.js";
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
export type { ProviderResolver } from "./contracts.js";
export { createProviderRegistry, createProviderResolver } from "./providers.js";
export type { ProviderRegistry } from "./providers.js";
export { createSecretRedactor, errorToErrorInfo, redactAgentEvent, redactMessage, redactProviderRequest, redactSecrets, redactSessionEntry } from "./redaction.js";
export type { SecretRedactor } from "./redaction.js";
export { assertPermission, assertTrusted, checkPermission, createStaticPermissionPolicy, createStaticTrustPolicy, denialToErrorInfo, isTrusted, PermissionDeniedError, TrustDeniedError } from "./security.js";
export type { PermissionDecision, PermissionPolicy, PermissionRequest, TrustDecision, TrustPolicy, TrustRequest } from "./security.js";
export { createSkillRegistry, resolveActiveSkills } from "./skills.js";
export type { ResolveActiveSkillsOptions } from "./skills.js";
export { resolveInstructionInjectors, runInstructionInjectors } from "./instruction-injection.js";
export type { ResolveInstructionInjectorsOptions } from "./instruction-injection.js";
export { createToolRegistry, dispatchToolCall, filterTools } from "./tools.js";
export type { DispatchToolCallOptions, ToolFilter, ToolFilterInput, ToolValidator } from "./tools.js";
export { generateValidateReviseLoop, isAgentLoopOptions, resolveLoop, singleShotLoop } from "./agent-loops.js";

export const name = "prism";
export const version = "0.0.1";
export const description =
  "Agent harness for AI providers, agents, sessions, and tools.";
