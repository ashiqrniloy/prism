/** Contracts-core extensions family (0.2.5 plan 025 Task 1 split).
 * Moved verbatim from contracts-core.ts; public surface unchanged behind the barrel. */
import type { ContributionRegistries } from "../contributions.js";
import type { ManifestContributionDeclaration } from "../manifests.js";
import type { Middleware, MiddlewareHookName, MiddlewareRegistry } from "../middleware.js";
import type { ToolDefinition } from "../contracts-protocol.js";
import type { AIProvider, ProviderRequest } from "./provider.js";
import type {
  AgentDefinition,
  CommandDefinition,
  ContextProvider,
  InputBuilder,
  InstructionInjector,
  PromptBuilder,
  Skill,
} from "./agent.js";
import type { CompactionStrategy, RetryPolicy } from "./compaction.js";
import type { Credential, CredentialResolver, ResourceLoader, SettingsProvider } from "./resources.js";
import type { ErrorInfo, ModelConfig } from "./content.js";
import type { StoreFactory } from "./persistence.js";

export type ContributionFileKind = "skill" | "tool" | "context" | "instructions";

/** Inert envelope emitted by the host/CLI discovery scanner. Carries the
 *  realized {@link Skill} for skill kinds and a manifest-referenced
 *  {@link ManifestContributionDeclaration} for other kinds; the host owns
 *  any executable behavior. Contains no code, no credential. */
export interface DiscoveredContribution {
  readonly kind: ContributionFileKind;
  readonly name: string;
  readonly origin: "global" | "workspace";
  readonly path: string;
  /** Present when `kind === "skill"`. */
  readonly skill?: Skill;
  /** Present for non-skill kinds. */
  readonly declaration?: ManifestContributionDeclaration;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExtensionLifecycleEventName =
  | "resource_discovery"
  | "session_start"
  | "session_shutdown"
  | "before_agent_start"
  | "turn"
  | "context"
  | "provider_request"
  | "tool_call"
  | "tool_result"
  | "compaction"
  | "retry";

export interface ExtensionEvent {
  readonly type: ExtensionLifecycleEventName | "extension_error" | string;
  readonly payload?: unknown;
  readonly extension?: string;
  readonly error?: ErrorInfo;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Extension {
  readonly name: string;
  setup(api: ExtensionAPI): void | Promise<void>;
  /** Host-attested signature/digest for `ExtensionLoadPolicy.verifySignature`. */
  readonly signature?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderPackage {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly docs?: ProviderPackageDocs;
  setup(api: ProviderPackageAPI): void | Promise<void>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderPackageDocs {
  readonly description?: string;
  readonly links?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderPackageAPI extends ExtensionAPI {}

export type AuthMethod = ApiKeyAuthMethod | OAuthAuthMethod | CustomAuthMethod;

export interface ApiKeyAuthMethod {
  readonly kind: "api_key";
  readonly provider: string;
  readonly name?: string;
  readonly credentialName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthAuthMethod {
  readonly kind: "oauth";
  readonly provider: string;
  readonly name?: string;
  readonly oauth?: OAuthProvider;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthLoginCallbacks {
  onAuth?(url: string): void | Promise<void>;
  onDeviceCode?(code: { readonly userCode: string; readonly verificationUri: string; readonly expiresAt?: string }): void | Promise<void>;
  onPrompt?(message: string): string | undefined | Promise<string | undefined>;
  onSelect?(prompt: { readonly message: string; readonly choices: readonly string[] }): string | undefined | Promise<string | undefined>;
  /** Aborts OAuth login flows and device-code polling when signaled. */
  readonly signal?: AbortSignal;
}

export interface OAuthCredentials {
  readonly access?: string;
  readonly refresh?: string;
  readonly expires?: string | number;
  readonly accountId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface OAuthProvider {
  readonly id: string;
  login(callbacks?: OAuthLoginCallbacks): Promise<OAuthCredentials> | OAuthCredentials;
  refresh?(credentials: OAuthCredentials): Promise<OAuthCredentials> | OAuthCredentials;
  /** Best-effort upstream revocation; the store delete is what fails closed locally. */
  revoke?(credentials: OAuthCredentials): Promise<void> | void;
  getCredential?(credentials: OAuthCredentials): Promise<Credential | undefined> | Credential | undefined;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CustomAuthMethod {
  readonly kind: "custom" | string;
  readonly provider: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestPolicy {
  readonly name: string;
  apply(
    context: ProviderRequestPolicyContext,
  ): Promise<ProviderRequest | ProviderRequestPolicyResult> | ProviderRequest | ProviderRequestPolicyResult;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderRequestPolicyContext {
  readonly request: ProviderRequest;
  readonly sessionId?: string;
  readonly runId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

export interface ProviderRequestPolicyResult {
  readonly request: ProviderRequest;
  readonly secrets?: readonly (string | undefined)[];
}

export type SystemPromptMode = "append" | "prepend" | "replace" | "disable";
export type SystemPromptSource = "package" | "app" | "user" | "run" | string;

export interface SystemPromptContribution {
  readonly id: string;
  readonly source?: SystemPromptSource;
  readonly mode?: SystemPromptMode;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type SystemPromptConfig = false | SystemPromptContribution | readonly SystemPromptContribution[];

export interface ExtensionAPI {
  readonly registries: ContributionRegistries;
  readonly middleware: MiddlewareRegistry;
  on(type: ExtensionLifecycleEventName | string, handler: (event: ExtensionEvent) => void | Promise<void>): () => void;
  emit(event: ExtensionEvent): Promise<void>;
  use<T>(hook: MiddlewareHookName | string, middleware: Middleware<T>): () => void;
  registerProvider(provider: AIProvider): void;
  registerModel(model: ModelConfig): void;
  registerTool(tool: ToolDefinition): void;
  registerContextProvider(provider: ContextProvider): void;
  registerSkill(skill: Skill): void;
  registerCommand(command: CommandDefinition): void;
  registerAgent(agent: AgentDefinition): void;
  registerInputBuilder(builder: InputBuilder): void;
  registerPromptBuilder(builder: PromptBuilder): void;
  registerCompactionStrategy(strategy: CompactionStrategy): void;
  registerRetryPolicy(policy: RetryPolicy): void;
  registerStoreFactory(factory: StoreFactory): void;
  registerResourceLoader(key: string, loader: ResourceLoader): void;
  registerSettingsProvider(key: string, provider: SettingsProvider): void;
  registerCredentialResolver(key: string, resolver: CredentialResolver): void;
  registerProviderPackage(providerPackage: ProviderPackage): void;
  registerAuthMethod(method: AuthMethod): void;
  registerProviderRequestPolicy(policy: ProviderRequestPolicy): void;
  registerSystemPromptContribution(contribution: SystemPromptContribution): void;
  registerInstructionInjector(injector: InstructionInjector): void;
}
