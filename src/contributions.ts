import type {
  AgentDefinition,
  CommandDefinition,
  CompactionStrategy,
  ContextProvider,
  CredentialResolver,
  InputBuilder,
  PromptBuilder,
  ResourceLoader,
  SettingsProvider,
  Skill,
  StoreFactory,
  ToolDefinition,
} from "./contracts.js";
import { createModelRegistry, type ModelRegistry } from "./models.js";
import { createProviderRegistry, type ProviderRegistry } from "./providers.js";

export interface ContributionRegistry<T> {
  register(key: string, contribution: T): void;
  get(key: string): T | undefined;
  resolve(key: string): T;
  list(): readonly T[];
}

export interface ContributionRegistryOptions {
  readonly label?: string;
}

export function createContributionRegistry<T>(options: ContributionRegistryOptions = {}): ContributionRegistry<T> {
  const label = options.label ?? "contribution";
  const byKey = new Map<string, T>();

  return {
    register(key, contribution) {
      byKey.set(key, contribution);
    },
    get(key) {
      return byKey.get(key);
    },
    resolve(key) {
      const contribution = byKey.get(key);
      if (!contribution) throw new Error(`Unknown ${label}: ${key}`);
      return contribution;
    },
    list() {
      return [...byKey.values()];
    },
  };
}

export interface ContributionRegistries {
  readonly providers: ProviderRegistry;
  readonly models: ModelRegistry;
  readonly tools: ContributionRegistry<ToolDefinition>;
  readonly contextProviders: ContributionRegistry<ContextProvider>;
  readonly skills: ContributionRegistry<Skill>;
  readonly commands: ContributionRegistry<CommandDefinition>;
  readonly agents: ContributionRegistry<AgentDefinition>;
  readonly inputBuilders: ContributionRegistry<InputBuilder>;
  readonly promptBuilders: ContributionRegistry<PromptBuilder>;
  readonly compactionStrategies: ContributionRegistry<CompactionStrategy>;
  readonly storeFactories: ContributionRegistry<StoreFactory>;
  readonly resourceLoaders: ContributionRegistry<ResourceLoader>;
  readonly settingsProviders: ContributionRegistry<SettingsProvider>;
  readonly credentialResolvers: ContributionRegistry<CredentialResolver>;
}

export function createContributionRegistries(): ContributionRegistries {
  return {
    providers: createProviderRegistry(),
    models: createModelRegistry(),
    tools: createContributionRegistry({ label: "tool" }),
    contextProviders: createContributionRegistry({ label: "context provider" }),
    skills: createContributionRegistry({ label: "skill" }),
    commands: createContributionRegistry({ label: "command" }),
    agents: createContributionRegistry({ label: "agent" }),
    inputBuilders: createContributionRegistry({ label: "input builder" }),
    promptBuilders: createContributionRegistry({ label: "prompt builder" }),
    compactionStrategies: createContributionRegistry({ label: "compaction strategy" }),
    storeFactories: createContributionRegistry({ label: "store factory" }),
    resourceLoaders: createContributionRegistry({ label: "resource loader" }),
    settingsProviders: createContributionRegistry({ label: "settings provider" }),
    credentialResolvers: createContributionRegistry({ label: "credential resolver" }),
  };
}
