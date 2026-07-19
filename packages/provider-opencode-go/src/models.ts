import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  type ModelCost,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Official OpenCode Go API base (`/chat/completions`, `/messages`, `/models`). */
export const OPENCODE_GO_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

export type OpenCodeGoRoute = "openai" | "anthropic";

export interface OpenCodeGoModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "opencode-go";
  readonly compat?: JsonObject & {
    /** Dual-route selector: `"anthropic"` → `/messages`; default `"openai"` → `/chat/completions`. */
    readonly route?: OpenCodeGoRoute;
    /** Replay prior thinking (Anthropic thinking blocks / OpenAI `reasoning_content`). */
    readonly preserveThinking?: boolean;
    /** Upstream passthrough for Chat Completions models that accept effort (e.g. Kimi K3). */
    readonly reasoning_effort?: string;
    /** Upstream passthrough for Chat Completions thinking objects (e.g. Kimi K2.x / GLM). */
    readonly thinking?: boolean | JsonObject;
    /** Upstream OpenAI-style `reasoning` object when the gateway forwards it. */
    readonly reasoning?: JsonObject;
  };
}

export interface ListOpenCodeGoModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://opencode.ai/zen/go/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * Sparse official `GET /zen/go/v1/models` entry (`id` / `object` / `created` / `owned_by`).
 * @see https://opencode.ai/docs/go/
 */
export interface OpenCodeGoModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface OpenCodeGoModelsResponse {
  readonly object?: string;
  readonly data?: readonly OpenCodeGoModelEntry[];
}

export function defineOpenCodeGoModel(config: OpenCodeGoModelConfig): ModelConfig {
  const route = (config.compat?.route ?? routeForOpenCodeGoModel(config.model)) as OpenCodeGoRoute;
  const cache =
    config.cache
    ?? (route === "anthropic"
      ? { kind: "cache_control" as const, longRetention: true, maxBreakpoints: 4 }
      : { kind: "implicit" as const });
  return {
    ...config,
    provider: "opencode-go",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: route === "openai" ? "json_schema" : undefined,
      ...config.capabilities,
    },
    cache,
    compat: {
      preserveThinking: true,
      ...config.compat,
      route: config.compat?.route ?? route,
    },
  };
}

/**
 * Official docs endpoint table: MiniMax + Qwen use Anthropic Messages; all other
 * Go models use OpenAI-compatible Chat Completions.
 * @see https://opencode.ai/docs/go/
 */
export function routeForOpenCodeGoModel(modelId: string): OpenCodeGoRoute {
  const id = modelId.toLowerCase();
  if (id.startsWith("minimax-") || id.startsWith("qwen")) return "anthropic";
  return "openai";
}

/**
 * Caller-gated OpenCode Go model discovery via official `GET /models`.
 * Never invoked by `createOpenCodeGoProviderPackage` — hosts call this and pass
 * results via `models:` (or register themselves). Payload is sparse; route /
 * limits / cache kind are inferred from the official Go docs endpoint table.
 * @see https://opencode.ai/docs/go/
 */
export async function listOpenCodeGoModels(options: ListOpenCodeGoModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "opencode-go";
  const baseUrl = (options.baseUrl ?? OPENCODE_GO_DEFAULT_BASE_URL).replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`OpenCode Go model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as OpenCodeGoModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("OpenCode Go model discovery response missing data array");
  return payload.data.map((entry) => mapOpenCodeGoModel(entry, { provider }));
}

/**
 * Map a sparse official `/models` entry to Prism `ModelConfig`.
 * Official payload is id/created/owned_by only — route/cache/limits are heuristic
 * from the docs endpoint + featured metadata tables.
 */
export function mapOpenCodeGoModel(
  entry: OpenCodeGoModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("OpenCode Go model entry missing id");
  }
  const id = entry.id;
  const featured = FEATURED_BY_ID.get(id);
  if (featured) {
    return defineOpenCodeGoModel({
      provider: (options.provider as "opencode-go" | undefined) ?? "opencode-go",
      model: id,
      displayName: featured.displayName,
      capabilities: featured.capabilities,
      limits: featured.limits,
      cost: featured.cost,
      compat: { route: featured.route, preserveThinking: true, ...featured.compat },
    });
  }
  const route = routeForOpenCodeGoModel(id);
  const meta = heuristicsForOpenCodeGoModel(id);
  return defineOpenCodeGoModel({
    provider: (options.provider as "opencode-go" | undefined) ?? "opencode-go",
    model: id,
    displayName: id,
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: route === "openai" ? "json_schema" : undefined,
    },
    limits: meta.limits,
    cost: meta.cost,
    compat: { route, preserveThinking: true },
  });
}

interface FeaturedMeta {
  readonly model: string;
  readonly displayName: string;
  readonly route: OpenCodeGoRoute;
  readonly limits: NonNullable<ModelConfig["limits"]>;
  readonly cost?: ModelCost;
  readonly capabilities?: ModelConfig["capabilities"];
  readonly compat?: OpenCodeGoModelConfig["compat"];
}

/**
 * Docs-verified featured aliases (offline bootstrap). Official Go list is open
 * coding models only — not Zen GPT/Claude ids. Pricing from the official Go
 * usage table; context/output limits cross-checked against Pi secondary metadata
 * when official docs omit them.
 * @see https://opencode.ai/docs/go/
 */
const FEATURED: readonly FeaturedMeta[] = [
  {
    model: "grok-4.5",
    displayName: "Grok 4.5 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 500_000, maxOutputTokens: 500_000 },
    cost: { input: 2, output: 6, cacheRead: 0.5, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "glm-5.2",
    displayName: "GLM-5.2 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 131_072 },
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, currency: "USD", unit: "per_million_tokens" },
    compat: { thinking: { type: "enabled" }, reasoning_effort: "max" },
  },
  {
    model: "glm-5.1",
    displayName: "GLM-5.1 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 202_752, maxOutputTokens: 32_768 },
    cost: { input: 1.4, output: 4.4, cacheRead: 0.26, currency: "USD", unit: "per_million_tokens" },
    compat: { thinking: { type: "enabled" } },
  },
  {
    model: "kimi-k3",
    displayName: "Kimi K3 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 131_072 },
    cost: { input: 3, output: 15, cacheRead: 0.3, currency: "USD", unit: "per_million_tokens" },
    compat: { reasoning_effort: "max" },
  },
  {
    model: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 262_144, maxOutputTokens: 262_144 },
    cost: { input: 0.95, output: 4, cacheRead: 0.19, currency: "USD", unit: "per_million_tokens" },
    // Thinking always-on upstream — omit thinking body default; preserve for replay.
  },
  {
    model: "kimi-k2.6",
    displayName: "Kimi K2.6 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 262_144, maxOutputTokens: 65_536 },
    cost: { input: 0.95, output: 4, cacheRead: 0.16, currency: "USD", unit: "per_million_tokens" },
    compat: { thinking: { type: "enabled" } },
  },
  {
    model: "mimo-v2.5",
    displayName: "MiMo-V2.5 via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "mimo-v2.5-pro",
    displayName: "MiMo-V2.5-Pro via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 128_000 },
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "minimax-m3",
    displayName: "MiniMax M3 via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 131_072 },
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "document", "file"], output: ["text"], reasoning: true, tools: true, streaming: true },
  },
  {
    model: "minimax-m2.7",
    displayName: "MiniMax M2.7 via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 204_800, maxOutputTokens: 131_072 },
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "document", "file"], output: ["text"], reasoning: true, tools: true, streaming: true },
  },
  {
    model: "minimax-m2.5",
    displayName: "MiniMax M2.5 via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 204_800, maxOutputTokens: 131_072 },
    cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "document", "file"], output: ["text"], reasoning: true, tools: true, streaming: true },
  },
  {
    model: "qwen3.7-max",
    displayName: "Qwen3.7 Max via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 65_536 },
    cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "qwen3.7-plus",
    displayName: "Qwen3.7 Plus via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 65_536 },
    cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "qwen3.6-plus",
    displayName: "Qwen3.6 Plus via OpenCode Go",
    route: "anthropic",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 65_536 },
    cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
    cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, currency: "USD", unit: "per_million_tokens" },
  },
  {
    model: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash via OpenCode Go",
    route: "openai",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 },
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, currency: "USD", unit: "per_million_tokens" },
  },
];

const FEATURED_BY_ID = new Map(FEATURED.map((entry) => [entry.model, entry]));

/**
 * Featured offline bootstrap catalog — docs-verified official Go model ids with
 * dual-route `compat.route`. Prefer `listOpenCodeGoModels()` for the live set.
 */
export const openCodeGoModels = FEATURED.map((entry) =>
  defineOpenCodeGoModel({
    model: entry.model,
    displayName: entry.displayName,
    capabilities: entry.capabilities,
    limits: entry.limits,
    cost: entry.cost,
    compat: { route: entry.route, preserveThinking: true, ...entry.compat },
  }),
) as readonly ModelConfig[];

function heuristicsForOpenCodeGoModel(id: string): {
  readonly limits: NonNullable<ModelConfig["limits"]>;
  readonly cost?: ModelCost;
} {
  const lower = id.toLowerCase();
  if (lower.startsWith("minimax-")) {
    return {
      limits: { contextWindow: 204_800, maxOutputTokens: 131_072 },
      cost: { input: 0.3, output: 1.2, cacheRead: 0.06, currency: "USD", unit: "per_million_tokens" },
    };
  }
  if (lower.startsWith("qwen")) {
    return {
      limits: { contextWindow: 1_000_000, maxOutputTokens: 65_536 },
    };
  }
  if (lower.startsWith("kimi-")) {
    return {
      limits: { contextWindow: 262_144, maxOutputTokens: 65_536 },
    };
  }
  if (lower.startsWith("glm-")) {
    return {
      limits: { contextWindow: 200_000, maxOutputTokens: 32_768 },
    };
  }
  if (lower.startsWith("deepseek-") || lower.startsWith("mimo-")) {
    return {
      limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    };
  }
  return { limits: { contextWindow: 200_000, maxOutputTokens: 64_000 } };
}
