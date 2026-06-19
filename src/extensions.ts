import type {
  AgentDefinition,
  AIProvider,
  AuthMethod,
  CommandDefinition,
  CompactionStrategy,
  ContextProvider,
  CredentialResolver,
  Extension,
  ExtensionEvent,
  ExtensionLifecycleEventName,
  InputBuilder,
  ModelConfig,
  PromptBuilder,
  ProviderPackage,
  ProviderRequestPolicy,
  ResourceLoader,
  RetryPolicy,
  SettingsProvider,
  Skill,
  StoreFactory,
  SystemPromptContribution,
  ToolDefinition,
} from "./contracts.js";
import { createContributionRegistries, type ContributionRegistries } from "./contributions.js";
import { createMiddlewareRegistry, type MiddlewareRegistry } from "./middleware.js";
import { authMethodKey, systemPromptContributionKey } from "./provider-packages.js";
import { errorToErrorInfo } from "./redaction.js";
import { assertPermission, type PermissionPolicy } from "./security.js";

export type ExtensionEventHandler = (event: ExtensionEvent) => void | Promise<void>;
export type ExtensionErrorPolicy = "event" | "throw";

export interface ExtensionKernelOptions {
  readonly registries?: ContributionRegistries;
  readonly middleware?: MiddlewareRegistry;
  readonly errorPolicy?: ExtensionErrorPolicy;
  readonly secrets?: readonly (string | undefined)[];
  readonly permission?: PermissionPolicy;
}

export interface ExtensionEventBus {
  on(type: ExtensionLifecycleEventName | string, handler: ExtensionEventHandler): () => void;
  emit(event: ExtensionEvent): Promise<void>;
}

export interface ExtensionKernel {
  readonly registries: ContributionRegistries;
  readonly middleware: MiddlewareRegistry;
  readonly events: ExtensionEventBus;
  load(extensions: readonly Extension[]): Promise<void>;
}

function extensionError(error: unknown, source?: string, secrets: readonly (string | undefined)[] = []): ExtensionEvent {
  return { type: "extension_error", extension: source, error: errorToErrorInfo(error, secrets) };
}

export function createExtensionEventBus(options: Pick<ExtensionKernelOptions, "errorPolicy" | "secrets"> = {}): ExtensionEventBus {
  const handlers = new Map<string, ExtensionEventHandler[]>();
  const errorPolicy = options.errorPolicy ?? "event";
  const secrets = options.secrets ?? [];

  const bus: ExtensionEventBus = {
    on(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
      return () => {
        const next = (handlers.get(type) ?? []).filter((item) => item !== handler);
        if (next.length === 0) handlers.delete(type);
        else handlers.set(type, next);
      };
    },
    async emit(event) {
      for (const handler of handlers.get(event.type) ?? []) {
        try {
          await handler(event);
        } catch (error) {
          if (errorPolicy === "throw") throw error;
          if (event.type !== "extension_error") await bus.emit(extensionError(error, event.extension, secrets));
        }
      }
    },
  };

  return bus;
}

export function createExtensionKernel(options: ExtensionKernelOptions = {}): ExtensionKernel {
  const registries = options.registries ?? createContributionRegistries();
  const events = createExtensionEventBus(options);
  const middleware = options.middleware ?? createMiddlewareRegistry({ ...options, onError: events.emit });
  const errorPolicy = options.errorPolicy ?? "event";
  const secrets = options.secrets ?? [];

  const api = {
    registries,
    middleware,
    on: events.on,
    emit: events.emit,
    use: middleware.use,
    registerProvider(provider: AIProvider) {
      registries.providers.register(provider);
    },
    registerModel(model: ModelConfig) {
      registries.models.register(model);
    },
    registerTool(tool: ToolDefinition) {
      registries.tools.register(tool.name, tool);
    },
    registerContextProvider(provider: ContextProvider) {
      registries.contextProviders.register(provider.name, provider);
    },
    registerSkill(skill: Skill) {
      registries.skills.register(skill.name, skill);
    },
    registerCommand(command: CommandDefinition) {
      registries.commands.register(command.name, command);
    },
    registerAgent(agent: AgentDefinition) {
      registries.agents.register(agent.name, agent);
    },
    registerInputBuilder(builder: InputBuilder) {
      registries.inputBuilders.register(builder.name, builder);
    },
    registerPromptBuilder(builder: PromptBuilder) {
      registries.promptBuilders.register(builder.name, builder);
    },
    registerCompactionStrategy(strategy: CompactionStrategy) {
      registries.compactionStrategies.register(strategy.name, strategy);
    },
    registerRetryPolicy(policy: RetryPolicy) {
      registries.retryPolicies.register(policy.name, policy);
    },
    registerStoreFactory(factory: StoreFactory) {
      registries.storeFactories.register(factory.name, factory);
    },
    registerResourceLoader(key: string, loader: ResourceLoader) {
      registries.resourceLoaders.register(key, loader);
    },
    registerSettingsProvider(key: string, provider: SettingsProvider) {
      registries.settingsProviders.register(key, provider);
    },
    registerCredentialResolver(key: string, resolver: CredentialResolver) {
      registries.credentialResolvers.register(key, resolver);
    },
    registerProviderPackage(providerPackage: ProviderPackage) {
      registries.providerPackages.register(providerPackage.name, providerPackage);
    },
    registerAuthMethod(method: AuthMethod) {
      registries.authMethods.register(authMethodKey(method), method);
    },
    registerProviderRequestPolicy(policy: ProviderRequestPolicy) {
      registries.providerRequestPolicies.register(policy.name, policy);
    },
    registerSystemPromptContribution(contribution: SystemPromptContribution) {
      registries.systemPromptContributions.register(systemPromptContributionKey(contribution), contribution);
    },
  };

  return {
    registries,
    middleware,
    events,
    async load(extensions) {
      for (const extension of extensions) {
        try {
          await assertPermission(options.permission, { kind: "extension", action: "setup", target: extension.name });
          await extension.setup(api);
        } catch (error) {
          if (errorPolicy === "throw") throw error;
          await events.emit(extensionError(error, extension.name, secrets));
        }
      }
    },
  };
}
