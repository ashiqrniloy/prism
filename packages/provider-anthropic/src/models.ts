import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Official Claude API Messages base. */
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

/** Anthropic Messages API version header value. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

export interface AnthropicModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "anthropic" | string;
  readonly compat?: JsonObject & {
    /** Official Messages `thinking` object or boolean enable/disable. */
    readonly thinking?: boolean | JsonObject;
    /** Official adaptive-thinking `effort` (low/medium/high/…). */
    readonly effort?: string;
    /** Portable alias accepted as `effort`. */
    readonly reasoning_effort?: string;
    /** Replay prior thinking blocks on the next turn. */
    readonly preserveThinking?: boolean;
  };
}

export interface ListAnthropicModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to `https://api.anthropic.com/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/** Sparse official `GET /v1/models` entry. */
export interface AnthropicModelEntry {
  readonly id: string;
  readonly display_name?: string;
  readonly created_at?: string;
  readonly type?: string;
  readonly max_input_tokens?: number;
  readonly max_tokens?: number;
}

interface AnthropicModelsResponse {
  readonly data?: readonly AnthropicModelEntry[];
  readonly has_more?: boolean;
  readonly first_id?: string;
  readonly last_id?: string;
}

export function defineAnthropicModel(config: AnthropicModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "anthropic",
    capabilities: {
      input: ["text", "image", "document", "file"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
    cache: config.cache ?? {
      kind: "cache_control",
      longRetention: true,
    },
    compat: {
      preserveThinking: true,
      ...config.compat,
    },
  };
}

/**
 * Caller-gated Claude model discovery via official `GET /v1/models`.
 * Never invoked by `createAnthropicProviderPackage` — hosts call this and pass
 * results via `models:` (or register themselves).
 * @see https://docs.anthropic.com/en/api/models-list
 */
export async function listAnthropicModels(options: ListAnthropicModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "anthropic";
  const baseUrl = (options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      ...options.headers,
      "anthropic-version": ANTHROPIC_API_VERSION,
      ...(token ? { "x-api-key": token } : {}),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Anthropic model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as AnthropicModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("Anthropic model discovery response missing data array");
  return payload.data.map((entry) => mapAnthropicModel(entry, { provider }));
}

/**
 * Map a sparse official `/models` entry to Prism `ModelConfig`.
 * Capabilities/limits are heuristic when the payload omits them.
 */
export function mapAnthropicModel(
  entry: AnthropicModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Anthropic model entry missing id");
  }
  const id = entry.id;
  return defineAnthropicModel({
    provider: options.provider ?? "anthropic",
    model: id,
    displayName: entry.display_name ?? id,
    limits: cleanLimits({
      contextWindow: entry.max_input_tokens,
      maxOutputTokens: entry.max_tokens,
    }),
    compat: cleanJson({
      preserveThinking: true,
      anthropic: cleanJson({
        created_at: entry.created_at,
        type: entry.type,
      }),
      ...thinkingDefaultsForModel(id),
    }),
  });
}

/** Featured offline bootstrap aliases — refresh via `listAnthropicModels()`. */
export const anthropicModels = [
  defineAnthropicModel({
    model: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    compat: {
      preserveThinking: true,
      thinking: { type: "adaptive" },
      effort: "high",
    },
    cost: { input: 5, output: 25 },
  }),
  defineAnthropicModel({
    model: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    compat: {
      preserveThinking: true,
      thinking: { type: "adaptive" },
      effort: "high",
    },
    cost: { input: 3, output: 15 },
  }),
  defineAnthropicModel({
    model: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    limits: { contextWindow: 200_000, maxOutputTokens: 64_000 },
    compat: {
      preserveThinking: true,
      // Manual extended thinking still supported on Haiku 4.5.
      thinking: { type: "enabled", budget_tokens: 10_000 },
    },
    cost: { input: 1, output: 5 },
  }),
  defineAnthropicModel({
    model: "claude-fable-5",
    displayName: "Claude Fable 5",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    compat: {
      preserveThinking: true,
      thinking: { type: "adaptive" },
    },
    cost: { input: 10, output: 50 },
  }),
] as const satisfies readonly ModelConfig[];

function thinkingDefaultsForModel(modelId: string): JsonObject {
  const id = modelId.toLowerCase();
  if (id.includes("haiku-4-5") || id.includes("haiku-4.5")) {
    return { thinking: { type: "enabled", budget_tokens: 10_000 } };
  }
  if (
    id.includes("opus-4-8")
    || id.includes("opus-4-7")
    || id.includes("sonnet-5")
    || id.includes("fable-5")
    || id.includes("mythos")
  ) {
    return { thinking: { type: "adaptive" }, effort: "high" };
  }
  return {};
}

function cleanLimits(value: Record<string, unknown>): ModelConfig["limits"] | undefined {
  const entries = Object.entries(value).filter(([, item]) => typeof item === "number");
  return entries.length > 0 ? Object.fromEntries(entries) as ModelConfig["limits"] : undefined;
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
