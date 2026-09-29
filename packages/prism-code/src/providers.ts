import { readFileSync } from "node:fs";
import { type AIProvider, createMockProvider, type ModelConfig, type ProviderEvent, providerDone, providerTextDelta } from "@arnilo/prism";
import { PROVIDER_ENV_VARS, type PrismCodeCredentialManager } from "./credentials.js";
import { PrismCodeExecutionError } from "./errors.js";
import { createOAuthTokenSource, resolveOAuthProvider } from "./oauth.js";

export type CredentialResolver = (ref: string) => string | undefined | Promise<string | undefined>;

/** Credential sources for one provider resolution; later sources only run when earlier ones miss. */
export interface ProviderResolutionOptions {
  /** Explicit config ref: env var first, then the store under the same name. */
  readonly credentialRef?: string;
  readonly resolver?: CredentialResolver;
  /** Single per-process manager; required for stored keys to beat ambient env vars. */
  readonly credentialManager?: PrismCodeCredentialManager;
}

export interface ProviderFactoryContext {
  readonly apiKey: string;
  readonly model: ModelConfig;
  /**
   * OAuth providers: fresh access token per request (proactive 60 s refresh, single-flight).
   * Absent when a static credential (explicit ref, stored key, or env token) applies.
   */
  readonly accessToken?: () => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Provider Inventory & Descriptors
// ---------------------------------------------------------------------------

export type ProviderAuthKind = "api_key" | "oauth" | "ambient" | "host_setup";

export interface ShippedProviderDescriptor {
  readonly id: string;
  readonly name: string;
  readonly packageSubpath: string;
  readonly authKinds: readonly ProviderAuthKind[];
  readonly description: string;
  readonly defaultEnvVar?: string;
  /** Ambient env vars, from the credential layer's single source of truth. */
  readonly envVars: readonly string[];
  readonly isMultiIdPackage?: boolean;
  readonly parentPackage?: string;
  /** Startup auto-detect order; undefined means never auto-detected (local runtime / host setup). */
  readonly autoDetectPriority?: number;
  /** Catalog default model; when a catalog is shipped it must contain this id. */
  readonly defaultModel?: string;
  /** Lazily imports and constructs the adapter (one literal `import()` per provider). */
  readonly create?: (context: ProviderFactoryContext) => Promise<AIProvider>;
}

/**
 * Shipped provider adapter inventory.
 * Covers every provider adapter in `@arnilo/prism-providers` export map.
 * Explicitly excludes non-adapter `./model-discovery` and `./decisions`.
 */
export const SHIPPED_PROVIDERS: readonly ShippedProviderDescriptor[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    packageSubpath: "anthropic",
    authKinds: ["api_key"],
    defaultEnvVar: "ANTHROPIC_API_KEY",
    description: "Claude 3.7 Sonnet, Opus 4.8, Haiku 4.5 via official Messages API",
    envVars: PROVIDER_ENV_VARS.anthropic ?? [],
    autoDetectPriority: 10,
    defaultModel: "claude-sonnet-5",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/anthropic");
      return mod.createAnthropicMessagesProvider({ apiKey });
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    packageSubpath: "openai",
    authKinds: ["api_key"],
    defaultEnvVar: "OPENAI_API_KEY",
    description: "GPT-4o, o1, o3, o4-mini via OpenAI Responses API",
    envVars: PROVIDER_ENV_VARS.openai ?? [],
    autoDetectPriority: 20,
    defaultModel: "gpt-5.1",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.createOpenAIResponsesProvider({ apiKey });
    },
    isMultiIdPackage: true,
    parentPackage: "openai",
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    packageSubpath: "openai",
    authKinds: ["oauth"],
    description: "OpenAI Codex via OAuth PKCE / device code subscription flow",
    envVars: PROVIDER_ENV_VARS["openai-codex"] ?? [],
    autoDetectPriority: 30,
    defaultModel: "gpt-5.1-codex",
    create: async ({ apiKey, accessToken }) => {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.createOpenAICodexProvider({ accessToken: accessToken ?? apiKey });
    },
    isMultiIdPackage: true,
    parentPackage: "openai",
  },
  {
    id: "google",
    name: "Google (Gemini)",
    packageSubpath: "google",
    authKinds: ["api_key"],
    defaultEnvVar: "GEMINI_API_KEY",
    description: "Gemini 2.5 Pro, Flash, Thinking via Google AI Studio",
    envVars: PROVIDER_ENV_VARS.google ?? [],
    autoDetectPriority: 40,
    defaultModel: "gemini-2.5-pro",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/google");
      return mod.createGoogleGenerateContentProvider({ apiKey });
    },
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    packageSubpath: "deepseek",
    authKinds: ["api_key"],
    defaultEnvVar: "DEEPSEEK_API_KEY",
    description: "DeepSeek V3 and R1 reasoning models",
    envVars: PROVIDER_ENV_VARS.deepseek ?? [],
    autoDetectPriority: 70,
    defaultModel: "deepseek-v4-pro",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/deepseek");
      return mod.createDeepSeekProvider({ apiKey });
    },
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    packageSubpath: "xai",
    authKinds: ["api_key", "oauth"],
    defaultEnvVar: "XAI_API_KEY",
    description: "Grok 3, Grok 3 Mini with reasoning effort via API key or OAuth",
    envVars: PROVIDER_ENV_VARS.xai ?? [],
    autoDetectPriority: 50,
    defaultModel: "grok-4.6",
    create: async ({ apiKey, accessToken }) => {
      const mod = await import("@arnilo/prism-providers/xai");
      return mod.createXaiProvider({ apiKey: accessToken ?? apiKey });
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    packageSubpath: "openrouter",
    authKinds: ["api_key"],
    defaultEnvVar: "OPENROUTER_API_KEY",
    description: "Unified router for hundreds of open and proprietary models",
    envVars: PROVIDER_ENV_VARS.openrouter ?? [],
    autoDetectPriority: 60,
    // No shipped catalog (live discovery only); `openrouter/auto` is OpenRouter's own router id.
    defaultModel: "openrouter/auto",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/openrouter");
      return mod.createOpenRouterProvider({ apiKey });
    },
  },
  {
    id: "ollama",
    name: "Ollama",
    packageSubpath: "ollama",
    authKinds: ["ambient"],
    description: "Local model runtime (default http://127.0.0.1:11434)",
    envVars: PROVIDER_ENV_VARS.ollama ?? [],
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/ollama");
      return mod.createOllamaProvider({ apiKey: apiKey || undefined });
    },
  },
  {
    id: "alibaba",
    name: "Alibaba (DashScope / Qwen)",
    packageSubpath: "alibaba",
    authKinds: ["api_key"],
    defaultEnvVar: "DASHSCOPE_API_KEY",
    description: "Qwen 2.5 Coder, Max, and Plus models",
    envVars: PROVIDER_ENV_VARS.alibaba ?? [],
    autoDetectPriority: 90,
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/alibaba");
      return mod.createAlibabaProvider({ apiKey });
    },
  },
  {
    id: "kimi-coding",
    name: "Kimi Coding",
    packageSubpath: "kimi",
    authKinds: ["api_key"],
    defaultEnvVar: "KIMI_API_KEY",
    description: "Moonshot Kimi K3, K2, and 1.5 coding models",
    envVars: PROVIDER_ENV_VARS["kimi-coding"] ?? [],
    autoDetectPriority: 100,
    defaultModel: "kimi-for-coding",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/kimi");
      return mod.createKimiCodingProvider({ apiKey });
    },
    isMultiIdPackage: true,
    parentPackage: "kimi",
  },
  {
    id: "moonshot",
    name: "Moonshot Open Platform",
    packageSubpath: "kimi",
    authKinds: ["api_key"],
    defaultEnvVar: "MOONSHOT_API_KEY",
    description: "Moonshot Open Platform chat completions",
    envVars: PROVIDER_ENV_VARS.moonshot ?? [],
    autoDetectPriority: 110,
    defaultModel: "kimi-k2.7-code",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/kimi");
      return mod.createMoonshotProvider({ apiKey });
    },
    isMultiIdPackage: true,
    parentPackage: "kimi",
  },
  {
    id: "clinepass",
    name: "ClinePass",
    packageSubpath: "clinepass",
    authKinds: ["api_key"],
    defaultEnvVar: "CLINEPASS_API_KEY",
    description: "High-throughput coding gateway with adaptive routing",
    envVars: PROVIDER_ENV_VARS.clinepass ?? [],
    autoDetectPriority: 180,
    defaultModel: "cline-pass/glm-5.2",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/clinepass");
      return mod.createClinePassProvider({ apiKey });
    },
  },
  {
    id: "commandcode",
    name: "CommandCode",
    packageSubpath: "commandcode",
    authKinds: ["api_key"],
    defaultEnvVar: "COMMANDCODE_API_KEY",
    description: "Coding agent execution engine and model family",
    envVars: PROVIDER_ENV_VARS.commandcode ?? [],
    autoDetectPriority: 120,
    defaultModel: "claude-opus-5",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/commandcode");
      return mod.createCommandCodeProvider({ apiKey });
    },
  },
  {
    id: "neuralwatt",
    name: "NeuralWatt",
    packageSubpath: "neuralwatt",
    authKinds: ["api_key"],
    defaultEnvVar: "NEURALWATT_API_KEY",
    description: "High-efficiency open weight inference endpoint",
    envVars: PROVIDER_ENV_VARS.neuralwatt ?? [],
    autoDetectPriority: 130,
    defaultModel: "glm-5.2",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/neuralwatt");
      return mod.createNeuralWattProvider({ apiKey });
    },
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    packageSubpath: "opencode-go",
    authKinds: ["api_key"],
    defaultEnvVar: "OPENCODE_GO_API_KEY",
    description: "OpenCode Go specialized development models",
    envVars: PROVIDER_ENV_VARS["opencode-go"] ?? [],
    autoDetectPriority: 140,
    defaultModel: "grok-4.5",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/opencode-go");
      return mod.createOpenCodeGoProvider({ apiKey });
    },
  },
  {
    id: "typesafe",
    name: "TypeSafe AI",
    packageSubpath: "typesafe",
    authKinds: ["api_key"],
    defaultEnvVar: "TYPESAFE_API_KEY",
    description: "Syntactic constraint & verified type-generation backend",
    envVars: PROVIDER_ENV_VARS.typesafe ?? [],
    autoDetectPriority: 150,
    defaultModel: "jev-preview",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/typesafe");
      return mod.createTypeSafeProvider({ apiKey });
    },
  },
  {
    id: "laya",
    name: "Laya",
    packageSubpath: "laya",
    authKinds: ["api_key"],
    defaultEnvVar: "LAYA_API_KEY",
    description: "Laya accelerated inference provider",
    envVars: PROVIDER_ENV_VARS.laya ?? [],
    autoDetectPriority: 160,
    defaultModel: "laya",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/laya");
      return mod.createLayaProvider({ apiKey });
    },
  },
  {
    id: "zai",
    name: "Z.AI (GLM)",
    packageSubpath: "zai",
    authKinds: ["api_key"],
    defaultEnvVar: "ZAI_API_KEY",
    description: "Zhipu AI GLM-4.5 / 5 models and reasoning",
    envVars: PROVIDER_ENV_VARS.zai ?? [],
    autoDetectPriority: 80,
    defaultModel: "glm-5.2",
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/zai");
      return mod.createZaiProvider({ apiKey });
    },
  },
  {
    id: "hyper",
    name: "Hyper",
    packageSubpath: "hyper",
    authKinds: ["api_key"],
    defaultEnvVar: "HYPER_API_KEY",
    description: "Hyper low-latency developer inference",
    envVars: PROVIDER_ENV_VARS.hyper ?? [],
    autoDetectPriority: 170,
    create: async ({ apiKey }) => {
      const mod = await import("@arnilo/prism-providers/hyper");
      return mod.createHyperProvider({ apiKey });
    },
  },
  {
    id: "azure",
    name: "Azure OpenAI / Foundry",
    packageSubpath: "azure",
    authKinds: ["host_setup"],
    description: "Enterprise Azure OpenAI endpoint and Entra auth",
    envVars: PROVIDER_ENV_VARS.azure ?? [],
    create: async ({ apiKey }) => {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
      if (!endpoint) {
        throw new PrismCodeExecutionError(
          "Azure OpenAI requires AZURE_OPENAI_ENDPOINT (an absolute https URL); refusing the placeholder default.",
        );
      }
      if (!apiKey) {
        throw new PrismCodeExecutionError("Azure OpenAI requires AZURE_OPENAI_API_KEY (Azure resource key).");
      }
      const mod = await import("@arnilo/prism-providers/azure");
      return mod.createAzureOpenAIProvider({ endpoint, credential: apiKey, authStyle: "api-key" });
    },
  },
  {
    id: "bedrock",
    name: "Amazon Bedrock",
    packageSubpath: "bedrock",
    authKinds: ["host_setup"],
    description: "AWS Bedrock enterprise runtime with IAM / IRSA",
    envVars: PROVIDER_ENV_VARS.bedrock ?? [],
    create: async () => {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
      if (!accessKeyId || !secretAccessKey) {
        throw new PrismCodeExecutionError(
          "Bedrock requires AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or configure a host credential source).",
        );
      }
      const region = process.env.AWS_REGION?.trim() ?? process.env.AWS_DEFAULT_REGION?.trim() ?? "us-east-1";
      const mod = await import("@arnilo/prism-providers/bedrock");
      return mod.createBedrockConverseProvider({
        region,
        credential: { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN?.trim() },
      });
    },
  },
  {
    id: "vertex",
    name: "Google Vertex AI",
    packageSubpath: "vertex",
    authKinds: ["host_setup"],
    description: "Enterprise Google Cloud Vertex AI with ADC",
    envVars: PROVIDER_ENV_VARS.vertex ?? [],
    create: async () => {
      const projectId = process.env.GOOGLE_PROJECT_ID?.trim() ?? process.env.GOOGLE_CLOUD_PROJECT?.trim();
      if (!projectId) {
        throw new PrismCodeExecutionError("Vertex AI requires GOOGLE_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) plus ADC credentials.");
      }
      const location = process.env.GOOGLE_VERTEX_LOCATION?.trim() ?? process.env.GOOGLE_CLOUD_LOCATION?.trim() ?? "us-central1";
      const mod = await import("@arnilo/prism-providers/vertex");
      return mod.createVertexProvider({ projectId, location });
    },
  },
  {
    id: "ai-sdk",
    name: "Vercel AI SDK Adapter",
    packageSubpath: "ai-sdk",
    authKinds: ["host_setup"],
    description: "Host-only Vercel AI SDK LanguageModel adapter",
    envVars: PROVIDER_ENV_VARS["ai-sdk"] ?? [],
  },
  {
    id: "mock",
    name: "Mock Provider (Offline Testing)",
    packageSubpath: "mock",
    authKinds: ["ambient"],
    description: "Synthetic response provider for hermetic testing",
    envVars: PROVIDER_ENV_VARS.mock ?? [],
  },
];

export function getShippedProvider(id: string): ShippedProviderDescriptor | undefined {
  const norm = id.toLowerCase();
  return (
    SHIPPED_PROVIDERS.find((p) => p.id === norm) ?? (norm === "kimi" ? SHIPPED_PROVIDERS.find((p) => p.id === "kimi-coding") : undefined)
  );
}

// ---------------------------------------------------------------------------
// Credential Resolution
// ---------------------------------------------------------------------------

export async function resolveCredential(provider: string, options: ProviderResolutionOptions = {}): Promise<string | undefined> {
  const id = provider.toLowerCase();
  const { credentialRef, resolver, credentialManager } = options;

  // 1. Explicit ref: env var first, then the store under the same name.
  if (credentialRef) {
    const explicit = process.env[credentialRef] ?? (resolver ? await resolver(credentialRef) : undefined);
    if (explicit) return explicit;
  }

  // 2. Stored API key (store beats ambient env). Task 5 inserts the stored OAuth lookup here.
  if (credentialManager) {
    const stored = await credentialManager.getApiKey(id);
    if (stored) return stored;
  }

  // 3. Provider env vars, through the resolver when present (its env-first read is equivalent).
  const envVars = PROVIDER_ENV_VARS[id] ?? [`${id.toUpperCase()}_API_KEY`];
  for (const v of envVars) {
    const value = resolver ? await resolver(v) : process.env[v];
    if (value) return value;
  }
  return undefined;
}

/** Stored OAuth tokens make an OAuth provider usable even without an env var or stored API key. */
async function hasStoredOAuth(providerId: string, credentialManager?: PrismCodeCredentialManager): Promise<boolean> {
  if (!credentialManager) return false;
  try {
    const stored = await credentialManager.getOAuth(providerId);
    return Boolean(stored?.access || stored?.refresh);
  } catch {
    return false;
  }
}

export async function hasUsableProvider(
  config: { model?: ModelConfig; credentialRef?: string },
  options: ProviderResolutionOptions = {},
): Promise<boolean> {
  if (!config.model?.provider) return false;
  const provider = config.model.provider.toLowerCase();
  if (provider === "mock" || provider === "ollama") return true;
  const cred = await resolveCredential(provider, {
    ...options,
    credentialRef: config.credentialRef ?? options.credentialRef,
  });
  if (cred && cred.length > 0) return true;
  return hasStoredOAuth(provider, options.credentialManager);
}

// ---------------------------------------------------------------------------
// Model Discovery & Fallback Catalog
// ---------------------------------------------------------------------------

/** Static key if any, else a fresh OAuth access token (used by live model discovery). */
async function resolveDiscoveryKey(providerId: string, credentialManager: PrismCodeCredentialManager): Promise<string | undefined> {
  const key = await credentialManager.getApiKey(providerId);
  if (key) return key;
  if (!(await hasStoredOAuth(providerId, credentialManager))) return undefined;
  const oauthProvider = await resolveOAuthProvider(providerId);
  if (!oauthProvider) return undefined;
  return createOAuthTokenSource(providerId, oauthProvider, credentialManager)();
}

export interface DiscoveredModelInfo {
  readonly model: ModelConfig;
  readonly isLive: boolean;
  readonly isStale?: boolean;
  readonly error?: string;
}

export interface ListModelsOptions {
  /** Single per-process manager; required unless `apiKey` is supplied for validation. */
  readonly credentialManager?: PrismCodeCredentialManager;
  readonly signal?: AbortSignal;
  readonly ttlMs?: number;
  /** Validate this key instead of stored/ambient credentials; raw errors surface instead of a stale catalog. */
  readonly apiKey?: string;
}

/**
 * Loads models for a provider:
 * 1. Checks provider credentials. Unauthenticated providers throw/fail closed.
 * 2. If provider has a live discovery helper (e.g. listAnthropicModels), calls it with ttlMs: 0.
 * 3. On transient error or timeout, falls back to static catalog with offline indicator.
 * 4. Never drops all models on transient error.
 */
export async function listModelsForProvider(providerId: string, options: ListModelsOptions): Promise<readonly DiscoveredModelInfo[]> {
  const norm = providerId.toLowerCase();
  const desc = getShippedProvider(norm);
  if (!desc) {
    throw new PrismCodeExecutionError(`Unknown provider "${providerId}"`);
  }

  // Ensure authenticated
  const hasCreds = options.credentialManager ? await options.credentialManager.hasCredentials(norm) : false;
  if (options.apiKey === undefined && !hasCreds && desc.authKinds.includes("api_key")) {
    throw new PrismCodeExecutionError(`Provider "${providerId}" is not authenticated. Please run /provider to set up credentials.`);
  }

  const apiKey = options.apiKey ?? (options.credentialManager ? await resolveDiscoveryKey(norm, options.credentialManager) : undefined);

  // Attempt live discovery if supported
  try {
    switch (norm) {
      case "anthropic": {
        const mod = await import("@arnilo/prism-providers/anthropic");
        if (typeof mod.listAnthropicModels === "function") {
          const models = await mod.listAnthropicModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "openai": {
        const mod = await import("@arnilo/prism-providers/openai");
        if (typeof mod.listOpenAIModels === "function") {
          const models = await mod.listOpenAIModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "google": {
        const mod = await import("@arnilo/prism-providers/google");
        if (typeof mod.listGoogleModels === "function") {
          const models = await mod.listGoogleModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "deepseek": {
        const mod = await import("@arnilo/prism-providers/deepseek");
        if (typeof mod.listDeepSeekModels === "function") {
          const models = await mod.listDeepSeekModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "xai": {
        const mod = await import("@arnilo/prism-providers/xai");
        if (typeof mod.listXaiModels === "function") {
          const models = await mod.listXaiModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "openrouter": {
        const mod = await import("@arnilo/prism-providers/openrouter");
        if (typeof mod.listOpenRouterModels === "function") {
          const models = await mod.listOpenRouterModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "ollama": {
        const mod = await import("@arnilo/prism-providers/ollama");
        if (typeof mod.listOllamaModels === "function") {
          const models = await mod.listOllamaModels({ signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "alibaba": {
        const mod = await import("@arnilo/prism-providers/alibaba");
        if (typeof mod.listAlibabaModels === "function") {
          const models = await mod.listAlibabaModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "kimi":
      case "kimi-coding": {
        const mod = await import("@arnilo/prism-providers/kimi");
        if (typeof mod.listKimiModels === "function") {
          const models = await mod.listKimiModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "commandcode": {
        const mod = await import("@arnilo/prism-providers/commandcode");
        if (typeof mod.listCommandCodeModels === "function") {
          const models = await mod.listCommandCodeModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "neuralwatt": {
        const mod = await import("@arnilo/prism-providers/neuralwatt");
        if (typeof mod.listNeuralWattModels === "function") {
          const models = await mod.listNeuralWattModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "opencode-go": {
        const mod = await import("@arnilo/prism-providers/opencode-go");
        if (typeof mod.listOpenCodeGoModels === "function") {
          const models = await mod.listOpenCodeGoModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "zai": {
        const mod = await import("@arnilo/prism-providers/zai");
        if (typeof mod.listZaiModels === "function") {
          const models = await mod.listZaiModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
      case "hyper": {
        const mod = await import("@arnilo/prism-providers/hyper");
        if (typeof mod.listHyperModels === "function") {
          const models = await mod.listHyperModels({ apiKey, signal: options.signal });
          return models.map((m) => ({ model: m, isLive: true }));
        }
        break;
      }
    }
  } catch (error) {
    // Validation path: surface the raw auth/network failure instead of masking it with the catalog.
    if (options.apiKey !== undefined) throw error;
    // Live fetch failed — fall back to static catalog with error indicator
    const errMessage = error instanceof Error ? error.message : String(error);
    const fallback = await getStaticModelsForProvider(norm);
    return fallback.map((m) => ({
      model: m,
      isLive: false,
      isStale: true,
      error: `Live refresh failed (${errMessage}); using cached catalog`,
    }));
  }

  // Fallback to static catalog
  const fallback = await getStaticModelsForProvider(norm);
  return fallback.map((m) => ({ model: m, isLive: false }));
}

export interface ProviderKeyValidation {
  readonly ok: boolean;
  /** Why the key could not be verified (auth or network error); absent when `ok`. */
  readonly reason?: string;
  /** The provider ships no discovery endpoint (or returned nothing), so nothing could be checked. */
  readonly unverifiable?: boolean;
}

/**
 * Verifies an API key against the provider's live model-list endpoint before it is stored.
 * Returns `ok: true` with `unverifiable: true` when the provider has no endpoint to check against.
 * Never returns or logs the key.
 */
export async function validateProviderKey(
  providerId: string,
  apiKey: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProviderKeyValidation> {
  const norm = providerId.toLowerCase();
  if (!getShippedProvider(norm)) {
    return { ok: false, reason: `Unknown provider "${providerId}"` };
  }
  try {
    const models = await listModelsForProvider(norm, { apiKey, signal: options.signal });
    return models.length > 0 ? { ok: true } : { ok: true, unverifiable: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Loads the shipped (offline) catalog for a provider. Providers whose catalogs are
 * host- or region-defined (Azure deployments, Bedrock profiles, Vertex endpoints,
 * OpenRouter/DashScope live-only, local Ollama) return an empty list — never a fake
 * `"default"` entry.
 */
export async function getStaticModelsForProvider(providerId: string): Promise<readonly ModelConfig[]> {
  const norm = providerId.toLowerCase();
  switch (norm) {
    case "anthropic": {
      const mod = await import("@arnilo/prism-providers/anthropic");
      return mod.anthropicModels;
    }
    case "openai": {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.openAIModels;
    }
    case "openai-codex": {
      const mod = await import("@arnilo/prism-providers/openai");
      return mod.openAICodexModels;
    }
    case "google": {
      const mod = await import("@arnilo/prism-providers/google");
      return mod.googleModels;
    }
    case "deepseek": {
      const mod = await import("@arnilo/prism-providers/deepseek");
      return mod.deepseekModels;
    }
    case "xai": {
      const mod = await import("@arnilo/prism-providers/xai");
      return mod.xaiModels;
    }
    case "kimi":
    case "kimi-coding": {
      const mod = await import("@arnilo/prism-providers/kimi");
      return mod.kimiCodingModels;
    }
    case "moonshot": {
      const mod = await import("@arnilo/prism-providers/kimi");
      return mod.moonshotKimiModels;
    }
    case "clinepass": {
      const mod = await import("@arnilo/prism-providers/clinepass");
      return mod.clinePassModels;
    }
    case "commandcode": {
      const mod = await import("@arnilo/prism-providers/commandcode");
      return mod.commandCodeModels;
    }
    case "neuralwatt": {
      const mod = await import("@arnilo/prism-providers/neuralwatt");
      return mod.neuralWattModels;
    }
    case "opencode-go": {
      const mod = await import("@arnilo/prism-providers/opencode-go");
      return mod.openCodeGoModels;
    }
    case "typesafe": {
      const mod = await import("@arnilo/prism-providers/typesafe");
      return mod.typeSafeModels;
    }
    case "laya": {
      const mod = await import("@arnilo/prism-providers/laya");
      return mod.layaModels;
    }
    case "zai": {
      const mod = await import("@arnilo/prism-providers/zai");
      return mod.zaiModels;
    }
    case "hyper": {
      const mod = await import("@arnilo/prism-providers/hyper");
      return mod.hyperModels;
    }
    case "mock": {
      return [
        {
          provider: "mock",
          model: "default",
          displayName: "Mock Default Model",
          capabilities: {
            reasoning: true,
            thinkingLevels: ["none", "low", "medium", "high"],
          },
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Offline-test seam for the shipped `mock` provider: `PRISM_CODE_MOCK_SCRIPT` names a JSON file of
 * scripted provider turns (`ProviderEvent[][]`). Each `generate` call consumes one turn; once the
 * script is exhausted the provider emits a bare `done`. Used by the PTY end-to-end harness so the
 * built binary can exercise tool calls, approvals, and aborts without a network or a credential.
 */
function readMockScript(path: string): ProviderEvent[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new PrismCodeExecutionError(`mock script ${path} could not be read: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new PrismCodeExecutionError(`mock script ${path} must be a non-empty JSON array of provider events or turns`);
  }
  const turns = Array.isArray(parsed[0]) ? (parsed as ProviderEvent[][]) : [parsed as ProviderEvent[]];
  if (!turns.every((turn) => Array.isArray(turn))) {
    throw new PrismCodeExecutionError(`mock script ${path} must list provider events per turn`);
  }
  return turns;
}

function createMockScriptProvider(turns: readonly ProviderEvent[][]): AIProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate(request) {
      const events = turns[turn++] ?? [{ type: "done" as const }];
      for (const event of events) {
        if (request.signal?.aborted) throw request.signal.reason;
        yield event;
      }
    },
  };
}

/**
 * Catalog default for a provider: the descriptor's literal when shipped, else the first
 * catalog entry. Returns undefined when the provider ships no offline catalog.
 */
export async function defaultModelForProvider(providerId: string): Promise<ModelConfig | undefined> {
  const desc = getShippedProvider(providerId);
  if (!desc) return undefined;
  const catalog = await getStaticModelsForProvider(desc.id);
  if (desc.defaultModel) {
    return catalog.find((m) => m.model === desc.defaultModel) ?? catalog[0] ?? { provider: desc.id, model: desc.defaultModel };
  }
  return catalog[0];
}

/**
 * Startup auto-detection: first provider (descriptor priority order) with a stored,
 * OAuth, or ambient credential and a known catalog default model.
 */
export async function autoDetectProvider(credentialManager: PrismCodeCredentialManager): Promise<ModelConfig | undefined> {
  const candidates = SHIPPED_PROVIDERS.filter((p) => p.autoDetectPriority !== undefined).sort(
    (a, b) => (a.autoDetectPriority ?? 0) - (b.autoDetectPriority ?? 0),
  );
  for (const desc of candidates) {
    if (!(await credentialManager.hasCredentials(desc.id))) continue;
    const model = await defaultModelForProvider(desc.id);
    if (!model) continue;
    return { provider: desc.id, model: model.model, displayName: model.displayName };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Thinking Levels & Model-Aware Effort Control
// ---------------------------------------------------------------------------

/**
 * Returns declared thinking levels for a model:
 * - If capabilities.reasoning === false: returns undefined (reasoning is off).
 * - If capabilities.thinkingLevels declared: returns those levels.
 * - If capabilities.thinkingLevels not declared: returns undefined (unavailable).
 */
export function getModelThinkingLevels(model: Pick<ModelConfig, "capabilities">): readonly string[] | undefined {
  if (model.capabilities?.reasoning === false) {
    return undefined;
  }
  const levels = model.capabilities?.thinkingLevels;
  if (!levels || levels.length === 0) {
    return undefined;
  }
  return levels;
}

/**
 * Shift+Tab effort cycling helper:
 * - Non-reasoning models show 'off' and do not cycle.
 * - When capability declares no levels, do not invent a list — return 'unavailable' and do not cycle.
 * - Declared levels cycle in declared order and wrap (including 'none' only if declared).
 */
export function cycleThinkingLevel(model: Pick<ModelConfig, "capabilities">, currentEffort: string): string {
  if (model.capabilities?.reasoning === false) {
    return "off";
  }
  const levels = getModelThinkingLevels(model);
  if (!levels || levels.length === 0) {
    return "unavailable";
  }

  const idx = levels.indexOf(currentEffort);
  if (idx === -1) {
    return levels[0] ?? "off";
  }
  const nextIdx = (idx + 1) % levels.length;
  return levels[nextIdx] ?? levels[0] ?? "off";
}

/**
 * Revalidates effort level against a new model:
 * - Non-reasoning: 'off'
 * - Undeclared levels: 'unavailable'
 * - Current effort supported: unchanged
 * - Otherwise: first declared level or 'none' if present
 */
export function validateThinkingLevel(model: Pick<ModelConfig, "capabilities">, currentEffort: string): string {
  if (model.capabilities?.reasoning === false) {
    return "off";
  }
  const levels = getModelThinkingLevels(model);
  if (!levels || levels.length === 0) {
    return "unavailable";
  }
  if (levels.includes(currentEffort)) {
    return currentEffort;
  }
  return levels[0] ?? "unavailable";
}

// ---------------------------------------------------------------------------
// Dynamic Provider Instantiation
// ---------------------------------------------------------------------------

export async function resolveProvider(model: ModelConfig, options: ProviderResolutionOptions = {}): Promise<AIProvider> {
  const providerId = model.provider.toLowerCase();

  if (providerId === "mock") {
    const scriptPath = process.env.PRISM_CODE_MOCK_SCRIPT;
    if (scriptPath) return createMockScriptProvider(readMockScript(scriptPath));
    return createMockProvider([providerTextDelta("Mock response"), providerDone()]);
  }

  const desc = getShippedProvider(providerId);
  if (!desc?.create) {
    throw new PrismCodeExecutionError(`unsupported provider "${model.provider}". Run /provider to choose a supported provider.`);
  }

  const { credentialRef } = options;
  const apiKey = (await resolveCredential(providerId, options)) ?? "";
  let accessToken: (() => Promise<string | undefined>) | undefined;

  // Stored OAuth (step 3 of the chain) always becomes a refreshing token source, never a frozen string.
  if (!apiKey && options.credentialManager && (await hasStoredOAuth(providerId, options.credentialManager))) {
    const oauthProvider = await resolveOAuthProvider(providerId);
    if (oauthProvider) accessToken = createOAuthTokenSource(providerId, oauthProvider, options.credentialManager);
  }

  const requiresKey = desc.authKinds.includes("api_key") || desc.authKinds.includes("oauth");

  if (requiresKey && !apiKey && !accessToken) {
    if (credentialRef) {
      throw new PrismCodeExecutionError(
        `credentialRef "${credentialRef}" was not found in environment or secret store for provider "${providerId}"`,
      );
    }
    const envVars = PROVIDER_ENV_VARS[providerId] ?? [`${providerId.toUpperCase()}_API_KEY`];
    throw new PrismCodeExecutionError(
      `no API key found for provider "${providerId}". Please set ${envVars[0]} or specify credentialRef in config.`,
    );
  }

  return desc.create({ apiKey, model, ...(accessToken ? { accessToken } : {}) });
}

// ---------------------------------------------------------------------------
// Provider Cache
// ---------------------------------------------------------------------------

/**
 * One provider instance per provider id, shared by the agent definition, per-run overrides,
 * `/compact`, and the OM coordinator. Construction happens on `prime()`; `get()` stays
 * synchronous because core's `ProviderResolver` is synchronous.
 */
export interface ProviderCache {
  /** Synchronous read for `ProviderResolver`; `undefined` until primed. */
  get(model: Pick<ModelConfig, "provider">): AIProvider | undefined;
  /** Resolves (at most once per provider id, concurrent calls share one attempt) and caches. */
  prime(model: ModelConfig): Promise<AIProvider>;
  /** Host-supplied instance (tests/overrides); skips credential resolution for that id. */
  seed(providerId: string, provider: AIProvider): void;
  /** Drops every instance and in-flight attempt (credential changes, `/logout`). */
  clear(): void;
  readonly size: number;
}

/** Builds a {@link ProviderCache} over one credential source set. */
export function createProviderCache(options: ProviderResolutionOptions = {}): ProviderCache {
  const instances = new Map<string, AIProvider>();
  const inflight = new Map<string, Promise<AIProvider>>();

  return {
    get: (model) => instances.get(model.provider),
    get size() {
      return instances.size;
    },
    seed: (providerId, provider) => {
      instances.set(providerId, provider);
      inflight.delete(providerId);
    },
    clear: () => {
      instances.clear();
      inflight.clear();
    },
    async prime(model) {
      const key = model.provider;
      const cached = instances.get(key);
      if (cached) return cached;

      const pending = inflight.get(key);
      if (pending) return pending;

      const attempt = resolveProvider(model, options).then(
        (provider) => {
          instances.set(key, provider);
          inflight.delete(key);
          return provider;
        },
        (error: unknown) => {
          inflight.delete(key);
          throw error;
        },
      );
      inflight.set(key, attempt);
      return attempt;
    },
  };
}

// ---------------------------------------------------------------------------
// Model Catalog Enrichment
// ---------------------------------------------------------------------------

/**
 * Conservative limits assumed for a model that ships no catalog entry (host-defined model ids for
 * Azure/Bedrock/Vertex, or a model newer than this build). A small window is the safe direction:
 * compaction triggers earlier rather than overflowing the real one. Documented in `docs/prism-code.md`.
 */
export const UNKNOWN_MODEL_LIMITS = Object.freeze({ contextWindow: 32_000, maxOutputTokens: 4_096 });

export interface ModelEnrichment {
  readonly model: ModelConfig;
  /** The catalog had no entry for the model, so {@link UNKNOWN_MODEL_LIMITS} were applied. */
  readonly usedDefaults: boolean;
}

/**
 * Fills in limits/capabilities for a selection from the provider's shipped catalog, so effort levels
 * and the compaction trigger get real numbers. Catalog order: the shipped static catalog only; live
 * discovery happens in `/model`. A selection that already has both limits and capabilities is
 * returned untouched; one with only capabilities (live discovery) still gains catalog limits,
 * because the compaction trigger resolves the model's input cap and cannot work without them.
 */
export async function enrichModelConfig(model: ModelConfig): Promise<ModelEnrichment> {
  if (model.limits && model.capabilities) {
    return { model, usedDefaults: false };
  }

  const catalog = await getStaticModelsForProvider(model.provider);
  const described = catalog.find((entry) => entry.model === model.model);
  // A catalog entry may describe capabilities without limits (and live discovery may pass only
  // capabilities); the compaction trigger still needs a resolvable input cap, so fill them in.
  const limits = model.limits ?? described?.limits ?? UNKNOWN_MODEL_LIMITS;
  return { model: { ...described, ...model, limits }, usedDefaults: !described };
}
