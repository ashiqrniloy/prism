import type {
  AgentDefinition,
  AgentEvent,
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
  InstructionInjector,
  ModelConfig,
  PromptBuilder,
  ProviderPackage,
  ProviderRequestPolicy,
  ResourceLoader,
  RetryPolicy,
  SettingsProvider,
  Skill,
  StopHook,
  StoreFactory,
  SystemPromptContribution,
  ToolDefinition,
} from "./contracts.js";
import { type ContributionRegistries, createContributionRegistries } from "./contributions.js";
import { createMiddlewareRegistry, type Middleware, type MiddlewareHookName, type MiddlewareRegistry } from "./middleware.js";
import { authMethodKey, systemPromptContributionKey } from "./provider-packages.js";
import { errorToErrorInfo } from "./redaction.js";
import { assertPermission, type PermissionPolicy } from "./security.js";

export type ExtensionEventHandler = (event: ExtensionEvent) => void | Promise<void>;
export type ExtensionErrorPolicy = "event" | "throw";

export interface ExtensionLoadPolicy {
  /** When set, only listed extension names may load. */
  readonly allowList?: readonly string[];
  /**
   * Host signature / attestation check. Return false or throw to deny.
   * Unsigned extensions fail closed when this callback is provided.
   */
  readonly verifySignature?: (extension: Extension) => boolean | Promise<boolean>;
}

export interface ExtensionKernelOptions {
  readonly registries?: ContributionRegistries;
  readonly middleware?: MiddlewareRegistry;
  readonly errorPolicy?: ExtensionErrorPolicy;
  readonly secrets?: readonly (string | undefined)[];
  readonly permission?: PermissionPolicy;
  /** Optional allow-list / signature policy evaluated before `setup`. */
  readonly loadPolicy?: ExtensionLoadPolicy;
}

export interface ExtensionEventBus {
  on(type: ExtensionLifecycleEventName | string, handler: ExtensionEventHandler): () => void;
  emit(event: ExtensionEvent): Promise<void>;
}

export interface LoadedExtension {
  readonly name: string;
  /** Remove this extension's registry contributions and middleware/event subscriptions.
   *  Best-effort and idempotent; side effects outside the registries are NOT unwound. */
  dispose(): void;
}

export interface ExtensionKernel {
  readonly registries: ContributionRegistries;
  readonly middleware: MiddlewareRegistry;
  readonly events: ExtensionEventBus;
  load(extensions: readonly Extension[]): Promise<LoadedExtension[]>;
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

  // Per-extension tracked API: every registration records an undo so a dispose handle
  // (or a failed setup) can unwind exactly what that extension added.
  const createApi = (track?: (undo: () => void) => void) => ({
    registries,
    middleware,
    on(type: ExtensionLifecycleEventName | string, handler: ExtensionEventHandler) {
      const off = events.on(type, handler);
      track?.(off);
      return off;
    },
    emit: events.emit,
    use<T>(hook: MiddlewareHookName | string, mw: Middleware<T>) {
      const off = middleware.use(hook, mw);
      track?.(off);
      return off;
    },
    registerProvider(provider: AIProvider) {
      registries.providers.register(provider);
      track?.(() => registries.providers.unregister(provider.id));
    },
    registerModel(model: ModelConfig) {
      registries.models.register(model);
      track?.(() => registries.models.unregister(model.provider, model.model));
    },
    registerTool(tool: ToolDefinition) {
      registries.tools.register(tool.name, tool);
      track?.(() => registries.tools.unregister(tool.name));
    },
    registerContextProvider(provider: ContextProvider) {
      registries.contextProviders.register(provider.name, provider);
      track?.(() => registries.contextProviders.unregister(provider.name));
    },
    registerSkill(skill: Skill) {
      registries.skills.register(skill.name, skill);
      track?.(() => registries.skills.unregister(skill.name));
    },
    registerCommand(command: CommandDefinition) {
      registries.commands.register(command.name, command);
      track?.(() => registries.commands.unregister(command.name));
    },
    registerAgent(agent: AgentDefinition) {
      registries.agents.register(agent.name, agent);
      track?.(() => registries.agents.unregister(agent.name));
    },
    registerInputBuilder(builder: InputBuilder) {
      registries.inputBuilders.register(builder.name, builder);
      track?.(() => registries.inputBuilders.unregister(builder.name));
    },
    registerPromptBuilder(builder: PromptBuilder) {
      registries.promptBuilders.register(builder.name, builder);
      track?.(() => registries.promptBuilders.unregister(builder.name));
    },
    registerCompactionStrategy(strategy: CompactionStrategy) {
      registries.compactionStrategies.register(strategy.name, strategy);
      track?.(() => registries.compactionStrategies.unregister(strategy.name));
    },
    registerRetryPolicy(policy: RetryPolicy) {
      registries.retryPolicies.register(policy.name, policy);
      track?.(() => registries.retryPolicies.unregister(policy.name));
    },
    registerStoreFactory(factory: StoreFactory) {
      registries.storeFactories.register(factory.name, factory);
      track?.(() => registries.storeFactories.unregister(factory.name));
    },
    registerResourceLoader(key: string, loader: ResourceLoader) {
      registries.resourceLoaders.register(key, loader);
      track?.(() => registries.resourceLoaders.unregister(key));
    },
    registerSettingsProvider(key: string, provider: SettingsProvider) {
      registries.settingsProviders.register(key, provider);
      track?.(() => registries.settingsProviders.unregister(key));
    },
    registerCredentialResolver(key: string, resolver: CredentialResolver) {
      registries.credentialResolvers.register(key, resolver);
      track?.(() => registries.credentialResolvers.unregister(key));
    },
    registerProviderPackage(providerPackage: ProviderPackage) {
      registries.providerPackages.register(providerPackage.name, providerPackage);
      track?.(() => registries.providerPackages.unregister(providerPackage.name));
    },
    registerAuthMethod(method: AuthMethod) {
      const key = authMethodKey(method);
      registries.authMethods.register(key, method);
      track?.(() => registries.authMethods.unregister(key));
    },
    registerProviderRequestPolicy(policy: ProviderRequestPolicy) {
      registries.providerRequestPolicies.register(policy.name, policy);
      track?.(() => registries.providerRequestPolicies.unregister(policy.name));
    },
    registerSystemPromptContribution(contribution: SystemPromptContribution) {
      const key = systemPromptContributionKey(contribution);
      registries.systemPromptContributions.register(key, contribution);
      track?.(() => registries.systemPromptContributions.unregister(key));
    },
    registerInstructionInjector(injector: InstructionInjector) {
      registries.instructionInjectors.register(injector.name, injector);
      track?.(() => registries.instructionInjectors.unregister(injector.name));
    },
    registerStopHook(hook: StopHook) {
      registries.stopHooks.register(hook.name, hook);
      track?.(() => registries.stopHooks.unregister(hook.name));
    },
  });

  const unwind = (undo: (() => void)[]) => {
    for (const fn of undo.reverse()) {
      try {
        fn();
      } catch {
        // best-effort: one stuck undo must not block the rest
      }
    }
  };

  return {
    registries,
    middleware,
    events,
    async load(extensions) {
      const loaded: LoadedExtension[] = [];
      for (const extension of extensions) {
        const undo: (() => void)[] = [];
        try {
          await assertPermission(options.permission, { kind: "extension", action: "setup", target: extension.name });
          await assertExtensionLoadPolicy(options.loadPolicy, extension);
          await extension.setup(createApi((fn) => undo.push(fn)));
        } catch (error) {
          // A failed setup must not leave partial contributions behind.
          unwind(undo);
          if (errorPolicy === "throw") throw error;
          await events.emit(extensionError(error, extension.name, secrets));
          continue;
        }
        let disposed = false;
        loaded.push({
          name: extension.name,
          dispose() {
            if (disposed) return;
            disposed = true;
            unwind(undo);
          },
        });
      }
      return loaded;
    },
  };
}

/**
 * Lifecycle hook each forwarded `AgentEvent` maps onto (plan 106 R2). Notification only: the bus
 * receives the original event as `payload` and nothing is transformed. Events not listed here are
 * ignored — notably `agent_finished` stays an AgentEvent and is not re-emitted as a bus event.
 */
const AGENT_EVENT_BRIDGE: Readonly<Record<string, ExtensionLifecycleEventName>> = {
  agent_started: "before_agent_start",
  turn_started: "turn",
  turn_finished: "turn",
  tool_execution_started: "tool_call",
  tool_execution_finished: "tool_result",
};

export interface AgentEventBridgeOptions {
  /** Bridge-side failure (a source error, or a bus listener that throws under `errorPolicy: "throw"`).
   *  Never rethrown — the bridge must not fail the run it is observing. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Forward an `AgentEvent` iterable onto the extension bus, one mapped lifecycle event at a time
 * (plan 106 R2). Handlers run in event order and never in the run's path, so a slow or throwing
 * listener cannot stall or fail the observed run. Returns an unsubscribe that stops forwarding and
 * releases the source iterator.
 */
export function forwardAgentEvents(
  source: AsyncIterable<AgentEvent>,
  events: Pick<ExtensionEventBus, "emit">,
  options: AgentEventBridgeOptions = {},
): () => void {
  const iterator: AsyncIterator<AgentEvent> = source[Symbol.asyncIterator]();
  const report = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // A throwing error callback must not become an unhandled rejection.
    }
  };
  let stopped = false;
  // Serially chained so a listener that awaits keeps event order; the run never awaits this chain.
  let pending: Promise<void> = Promise.resolve();
  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await iterator.next();
        if (done || stopped) return;
        const type = AGENT_EVENT_BRIDGE[value.type];
        if (type === undefined) continue;
        const event: ExtensionEvent = { type, payload: value };
        pending = pending.then(() => events.emit(event)).catch(report);
      }
    } catch (error) {
      if (!stopped) report(error);
    }
  })();
  return () => {
    if (stopped) return;
    stopped = true;
    void (async () => {
      try {
        await iterator.return?.();
      } catch (error) {
        report(error);
      }
    })();
  };
}

/** Host-owned activation: copy contributed entries into the `createAgent()`
 *  fields that accept plain arrays. Contributions stay inert until the host
 *  passes the returned fields into runtime config. Array slots only —
 *  single-slot builders (`inputBuilder`/`promptBuilder`), `compaction`,
 *  `retry`, provider/model selection, and skill activation remain host-owned
 *  decisions; `commands` are for host RPC surfaces, not an `AgentConfig` field. */
export interface ActivatedKernelConfig {
  readonly tools: readonly ToolDefinition[];
  readonly skills: readonly Skill[];
  readonly instructionInjectors: readonly InstructionInjector[];
  readonly context: readonly ContextProvider[];
  /** Run-end stop hooks (plan 106 R1); pass to `createAgent({ stopHooks })`. */
  readonly stopHooks: readonly StopHook[];
  /** For host command surfaces (CLI/RPC/UI); not part of `AgentConfig`. */
  readonly commands: readonly CommandDefinition[];
  /** The kernel middleware registry itself; runs only when passed to runtime config. */
  readonly middleware: MiddlewareRegistry;
}

export function activateKernel(kernel: ExtensionKernel): ActivatedKernelConfig {
  return {
    tools: kernel.registries.tools.list(),
    skills: kernel.registries.skills.list(),
    instructionInjectors: kernel.registries.instructionInjectors.list(),
    context: kernel.registries.contextProviders.list(),
    stopHooks: kernel.registries.stopHooks.list(),
    commands: kernel.registries.commands.list(),
    middleware: kernel.middleware,
  };
}

async function assertExtensionLoadPolicy(policy: ExtensionLoadPolicy | undefined, extension: Extension): Promise<void> {
  if (!policy) return;
  if (policy.allowList && !policy.allowList.includes(extension.name)) {
    throw new Error(`Extension "${extension.name}" is not allow-listed`);
  }
  if (policy.verifySignature) {
    if (!extension.signature) throw new Error(`Extension "${extension.name}" is unsigned`);
    const ok = await policy.verifySignature(extension);
    if (!ok) throw new Error(`Extension "${extension.name}" failed signature verification`);
  }
}
