import type {
  AgentDefinition,
  AuthMethod,
  CommandDefinition,
  CompactionStrategy,
  ContextProvider,
  CredentialResolver,
  DiscoveredContribution,
  InputBuilder,
  InstructionInjector,
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
  readonly retryPolicies: ContributionRegistry<RetryPolicy>;
  readonly storeFactories: ContributionRegistry<StoreFactory>;
  readonly resourceLoaders: ContributionRegistry<ResourceLoader>;
  readonly settingsProviders: ContributionRegistry<SettingsProvider>;
  readonly credentialResolvers: ContributionRegistry<CredentialResolver>;
  readonly providerPackages: ContributionRegistry<ProviderPackage>;
  readonly authMethods: ContributionRegistry<AuthMethod>;
  readonly providerRequestPolicies: ContributionRegistry<ProviderRequestPolicy>;
  readonly systemPromptContributions: ContributionRegistry<SystemPromptContribution>;
  readonly instructionInjectors: ContributionRegistry<InstructionInjector>;
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
    retryPolicies: createContributionRegistry({ label: "retry policy" }),
    storeFactories: createContributionRegistry({ label: "store factory" }),
    resourceLoaders: createContributionRegistry({ label: "resource loader" }),
    settingsProviders: createContributionRegistry({ label: "settings provider" }),
    credentialResolvers: createContributionRegistry({ label: "credential resolver" }),
    providerPackages: createContributionRegistry({ label: "provider package" }),
    authMethods: createContributionRegistry({ label: "auth method" }),
    providerRequestPolicies: createContributionRegistry({ label: "provider request policy" }),
    systemPromptContributions: createContributionRegistry({ label: "system prompt contribution" }),
    instructionInjectors: createContributionRegistry({ label: "instruction injector" }),
  };
}

/** Register discovered contributions into the given registries. Inert: skill
 *  kinds register a fully realized {@link Skill}; tool/context/instructions
 *  kinds register **descriptor-only** entries whose executable behavior is
 *  host-owned. Performs NO `import()`. Last-write-wins per `(kind, name)`
 *  (workspace discovery already won the merge; calling twice is idempotent). */
export function registerDiscoveredContributions(
  registries: ContributionRegistries,
  contributions: readonly DiscoveredContribution[],
): void {
  for (const contribution of contributions) {
    switch (contribution.kind) {
      case "skill": {
        if (contribution.skill) registries.skills.register(contribution.skill.name, contribution.skill);
        break;
      }
      case "tool": {
        registries.tools.register(contribution.name, descriptorTool(contribution));
        break;
      }
      case "context": {
        registries.contextProviders.register(contribution.name, descriptorContextProvider(contribution));
        break;
      }
      case "instructions": {
        registries.systemPromptContributions.register(contribution.name, descriptorInstructions(contribution));
        break;
      }
    }
  }
}

function discoverMetadata(contribution: DiscoveredContribution): Record<string, unknown> {
  const decl = contribution.declaration;
  return {
    discovered: true,
    origin: contribution.origin,
    path: contribution.path,
    ...(decl?.module ? { module: decl.module } : {}),
    ...(decl?.exportName ? { exportName: decl.exportName } : {}),
    ...(decl?.resource ? { resource: decl.resource } : {}),
  };
}

// ponytail: descriptor-only tool — no import(), no execution. Host owns resolving declaration.module.
// ToolDefinition has no metadata slot; discovery provenance rides on the DiscoveredContribution envelope.
function descriptorTool(contribution: DiscoveredContribution): ToolDefinition {
  const name = contribution.name;
  return {
    name,
    description: `Discovered tool ${name}; host-owned execution`,
    execute: () => {
      throw new Error(`Discovered tool ${name} requires host execution (declaration.module not loaded)`);
    },
  };
}

function descriptorContextProvider(contribution: DiscoveredContribution): ContextProvider {
  const name = contribution.name;
  return {
    name,
    resolve: () => {
      throw new Error(`Discovered context provider ${name} requires host execution (declaration.module not loaded)`);
    },
    // ponytail: ContextProvider has no metadata field; discovery provenance rides on declaration.resource/module via the DiscoveredContribution envelope.
  };
}

// ponytail: core is fs-free; cannot read declaration.resource here. text is empty until the host
// lifts the resource into actual prompt text (Phase 30 instruction injection).
function descriptorInstructions(contribution: DiscoveredContribution): SystemPromptContribution {
  return {
    id: contribution.name,
    source: "package",
    mode: "append",
    text: "",
    metadata: discoverMetadata(contribution),
  };
}
