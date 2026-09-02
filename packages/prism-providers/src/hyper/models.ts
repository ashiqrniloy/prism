import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  type ModelCost,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Official Hyper API base (`/chat/completions`, `/messages`, `/responses`, `/models`, `/credits`). */
export const HYPER_DEFAULT_BASE_URL = "https://hyper.charm.land/v1";

export type HyperRoute = "openai" | "anthropic" | "responses";

export interface HyperModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "hyper";
  readonly compat?: JsonObject & {
    /** Route selector: `"anthropic"` → `/v1/messages`; `"responses"` → `/v1/responses`
     *  (OpenAI-standard pass-through, Codex-style clients); default `"openai"` → `/v1/chat/completions`. */
    readonly route?: HyperRoute;
    /** Replay prior thinking (Anthropic thinking blocks / OpenAI `reasoning_content`). */
    readonly preserveThinking?: boolean;
    /** Upstream `reasoning_effort` default (model `default_effort_level` from the live catalog). */
    readonly reasoning_effort?: string;
    /** Documented effort values for this model (from `/v1/models` `reasoning.effort_levels`); stripped before the wire. */
    readonly effortLevels?: readonly string[];
    /** Upstream Chat Completions `thinking` object passthrough. */
    readonly thinking?: boolean | JsonObject;
  };
}

export interface ListHyperModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * Hyper `GET /v1/models` entry — public, no auth required. Rich payload:
 * limits, vision, reasoning effort levels + default, and per-Mtok pricing
 * incl. cache create/hit.
 * @see https://hyper.charm.land/docs
 */
export interface HyperModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
  readonly display_name?: string;
  readonly context_window?: number;
  readonly max_output_tokens?: number;
  readonly capabilities?: { readonly vision?: boolean };
  readonly reasoning?: {
    readonly effort_levels?: readonly { readonly value?: string; readonly display?: string }[];
    readonly default_effort_level?: string;
  };
  readonly pricing?: { readonly input?: number; readonly output?: number; readonly cache_create?: number; readonly cache_hit?: number };
}

interface HyperModelsResponse {
  readonly object?: string;
  readonly data?: readonly HyperModelEntry[];
}

/**
 * Route + cache-kind derivation from the live catalog pricing shape (docs-verified
 * snapshot, 2026-07):
 *
 * - `cache_create: 0`, `cache_hit > 0` — implicit prefix cache, free writes,
 *   discounted hits (DeepSeek / GLM-5.2+ / Kimi K2.6+ / MiniMax M3 / Qwen 3.7+).
 *   No wire fields; caching works by byte-stable prefix reuse.
 * - Anthropic-shaped explicit-write pricing (`cache_create = 1.25× input`,
 *   `cache_hit = 0.1× input`) — today only `qwen3.6-*` — served on the
 *   `/v1/messages` route where `cache_control` is a standard Anthropic parameter.
 * - `cache_create = 0.5× input`, `cache_hit: 0` (gemma-4, glm-5, glm-5.1,
 *   gpt-oss-120b, kimi-k2.5, llama-*, minimax-m2.7, qwen3-coder, qwen3-next) —
 *   billed cache writes, zero read price. No cache knob is documented for the
 *   chat route; stays implicit with the write fee recorded in `cost.cacheWrite`.
 *
 * The `"responses"` route is never auto-selected here — it is an explicit
 * `compat.route` opt-in by callers who bring their own Responses-shaped model
 * metadata (Codex-style clients).
 */
export function routeForHyperModel(modelId: string): HyperRoute {
  return modelId.toLowerCase().startsWith("qwen3.6-") ? "anthropic" : "openai";
}

function cacheKindForHyperModel(route: HyperRoute): ModelConfig["cache"] {
  return route === "anthropic" ? { kind: "cache_control" as const, maxBreakpoints: 4 } : { kind: "implicit" as const };
}

export function defineHyperModel(config: HyperModelConfig): ModelConfig {
  const route = (config.compat?.route ?? routeForHyperModel(config.model)) as HyperRoute;
  return {
    ...config,
    provider: "hyper",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
    cache: config.cache ?? cacheKindForHyperModel(route),
    compat: {
      preserveThinking: true,
      ...config.compat,
      route: config.compat?.route ?? route,
    } as HyperModelConfig["compat"],
  };
}

/**
 * Caller-gated Hyper model discovery via the public `GET /models` endpoint.
 * Never invoked by `createHyperProviderPackage` — hosts call this and pass
 * results via `models:` (or register themselves). Public endpoint: no auth
 * header is emitted when no key resolves.
 * @see https://hyper.charm.land/docs
 */
export async function listHyperModels(options: ListHyperModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "hyper";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? HYPER_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Hyper model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<HyperModelsResponse>(response);
  if (!Array.isArray(payload.data)) throw new Error("Hyper model discovery response missing data array");
  return payload.data.map((entry) => mapHyperModel(entry, { provider }));
}

/**
 * Map a live `/v1/models` entry to Prism `ModelConfig` — limits, vision,
 * reasoning effort default, and per-Mtok pricing incl. cache create/hit, with
 * route + cache kind derived from the pricing shape.
 */
export function mapHyperModel(entry: HyperModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Hyper model entry missing id");
  }
  const route = routeForHyperModel(entry.id);
  const vision = entry.capabilities?.vision === true;
  const efforts = entry.reasoning?.effort_levels?.map((level) => level.value).filter((value): value is string => typeof value === "string");
  const defaultEffort = entry.reasoning?.default_effort_level;
  const pricing = entry.pricing ?? {};
  const heuristics = heuristicsForHyperModel(entry.id);
  return defineHyperModel({
    provider: (options.provider as "hyper" | undefined) ?? "hyper",
    model: entry.id,
    displayName: entry.display_name ?? entry.id,
    capabilities: {
      input: vision ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
    },
    limits: {
      contextWindow: typeof entry.context_window === "number" ? entry.context_window : heuristics.limits.contextWindow,
      maxOutputTokens: typeof entry.max_output_tokens === "number" ? entry.max_output_tokens : heuristics.limits.maxOutputTokens,
    },
    cost: costFromHyperPricing(pricing),
    compat: {
      route,
      preserveThinking: true,
      ...(efforts && efforts.length > 0 ? { effortLevels: efforts } : {}),
      ...(defaultEffort ? { reasoning_effort: defaultEffort } : {}),
    },
  });
}

export function costFromHyperPricing(pricing: HyperModelEntry["pricing"]): ModelCost | undefined {
  if (!pricing || typeof pricing.input !== "number") return undefined;
  const cacheRead = typeof pricing.cache_hit === "number" ? (pricing.cache_hit > 0 ? pricing.cache_hit : undefined) : undefined;
  const cacheWrite = typeof pricing.cache_create === "number" ? (pricing.cache_create > 0 ? pricing.cache_create : undefined) : undefined;
  if (cacheRead === undefined && cacheWrite === undefined && typeof pricing.output !== "number") return undefined;
  return {
    input: pricing.input,
    ...(typeof pricing.output === "number" ? { output: pricing.output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    currency: "USD",
    unit: "per_million_tokens",
  };
}

type FeaturedMeta = Omit<HyperModelConfig, "provider" | "model"> & { readonly model: string; readonly route?: HyperRoute };

/**
 * Featured offline bootstrap catalog — the complete live `/v1/models` snapshot
 * (31 models, fetched 2026-07) with limits, vision, reasoning effort defaults
 * and per-Mtok pricing incl. cache create/hit. Prefer `listHyperModels()` for
 * the current live set.
 * @see https://hyper.charm.land/docs/models.html
 */
const FEATURED: readonly FeaturedMeta[] = [
  { model: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 }, cost: { input: 0.2, output: 0.4, cacheRead: 0.04, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["high", "xhigh"] } },
  { model: "deepseek-v4-flash-0731", displayName: "DeepSeek V4 Flash 0731", limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 }, cost: { input: 0.44, output: 1.32, cacheRead: 0.044, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["none", "low", "high", "max"] } },
  { model: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", limits: { contextWindow: 1_000_000, maxOutputTokens: 384_000 }, cost: { input: 2.4, output: 4.8, cacheRead: 0.2, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["high", "xhigh"] } },
  { model: "deepseek-v4-pro-0813", displayName: "DeepSeek V4 Pro 0813", limits: { contextWindow: 1_048_576, maxOutputTokens: 262_144 }, cost: { input: 1.437216, output: 4.311648, cacheRead: 0.0479072, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["none", "low", "high", "max"] } },
  { model: "gemma-4-26b-a4b-it", displayName: "Gemma 4 26B A4B", limits: { contextWindow: 256_000, maxOutputTokens: 25_600 }, cost: { input: 0.116, output: 0.38, cacheWrite: 0.058, currency: "USD", unit: "per_million_tokens" } },
  { model: "glm-5", displayName: "GLM-5", limits: { contextWindow: 202_752, maxOutputTokens: 20_275 }, cost: { input: 0.85, output: 2.774, cacheWrite: 0.425, currency: "USD", unit: "per_million_tokens" } },
  { model: "glm-5.1", displayName: "GLM-5.1", limits: { contextWindow: 202_750, maxOutputTokens: 3_276 }, cost: { input: 1.29, output: 4.22, cacheWrite: 0.645, currency: "USD", unit: "per_million_tokens" } },
  { model: "glm-5.2", displayName: "GLM-5.2", limits: { contextWindow: 1_000_000, maxOutputTokens: 32_768 }, cost: { input: 1.52432, output: 4.79072, cacheRead: 0.152432, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["high", "xhigh"] } },
  { model: "glm-5.3", displayName: "GLM-5.3", limits: { contextWindow: 1_048_576, maxOutputTokens: 262_144 }, cost: { input: 1.52432, output: 4.79072, cacheRead: 0.283088, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["low", "high", "max"] } },
  { model: "glm-5.3-flash", displayName: "GLM-5.3 Flash", limits: { contextWindow: 1_048_576, maxOutputTokens: 131_072 }, cost: { input: 0.16332, output: 0.5444, cacheRead: 0.0315752, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "high", effortLevels: ["low", "high", "max"] }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "gpt-oss-120b", displayName: "GPT-OSS 120B", limits: { contextWindow: 128_072, maxOutputTokens: 13_107 }, cost: { input: 0.188, output: 0.7, cacheWrite: 0.094, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "medium", effortLevels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] } },
  { model: "kimi-k2.5", displayName: "Kimi K2.5", limits: { contextWindow: 262_144, maxOutputTokens: 26_214 }, cost: { input: 0.5284, output: 2.785, cacheWrite: 0.2642, currency: "USD", unit: "per_million_tokens" } },
  { model: "kimi-k2.6", displayName: "Kimi K2.6", limits: { contextWindow: 262_000, maxOutputTokens: 26_214 }, cost: { input: 1.03436, output: 4.3552, cacheRead: 0.174208, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "medium", effortLevels: ["low", "medium", "high"] }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", limits: { contextWindow: 262_000, maxOutputTokens: 16_000 }, cost: { input: 1.03436, output: 4.3552, cacheRead: 0.206872, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "kimi-k3", displayName: "Kimi K3", limits: { contextWindow: 1_048_576, maxOutputTokens: 16_000 }, cost: { input: 3.2664, output: 16.332, cacheRead: 0.32664, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "max", effortLevels: ["low", "high", "max"] }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "llama-3.3-70b-instruct", displayName: "Llama 3.3 70B Instruct", limits: { contextWindow: 128_000, maxOutputTokens: 12_800 }, cost: { input: 0.6066, output: 1.0386, cacheWrite: 0.3033, currency: "USD", unit: "per_million_tokens" } },
  { model: "llama-4-maverick-17b-128e-instruct-fp8", displayName: "Llama 4 Maverick 17B 128E", limits: { contextWindow: 430_000, maxOutputTokens: 43_000 }, cost: { input: 0.274, output: 0.8992, cacheWrite: 0.137, currency: "USD", unit: "per_million_tokens" } },
  { model: "minimax-m2.7", displayName: "MiniMax M2.7", limits: { contextWindow: 262_100, maxOutputTokens: 6_553 }, cost: { input: 0.426, output: 1.62, cacheWrite: 0.213, currency: "USD", unit: "per_million_tokens" } },
  { model: "minimax-m3", displayName: "MiniMax M3", limits: { contextWindow: 512_000, maxOutputTokens: 512_000 }, cost: { input: 0.32664, output: 1.30656, cacheRead: 0.0642392, currency: "USD", unit: "per_million_tokens" }, compat: { reasoning_effort: "medium", effortLevels: ["low", "medium", "high"] }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.6-flash", displayName: "Qwen 3.6 Flash", route: "anthropic", limits: { contextWindow: 1_000_000, maxOutputTokens: 64_000 }, cost: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: 1.25, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.6-max", displayName: "Qwen 3.6 Max", route: "anthropic", limits: { contextWindow: 256_000, maxOutputTokens: 64_000 }, cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "qwen3.6-plus", displayName: "Qwen 3.6 Plus", route: "anthropic", limits: { contextWindow: 1_000_000, maxOutputTokens: 64_000 }, cost: { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.7-flash", displayName: "Qwen 3.7 Flash", limits: { contextWindow: 1_000_000, maxOutputTokens: 64_000 }, cost: { input: 0.2, output: 0.8, cacheRead: 0.04, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.7-max", displayName: "Qwen 3.7 Max", limits: { contextWindow: 1_000_000, maxOutputTokens: 64_000 }, cost: { input: 2.5, output: 7.5, cacheRead: 0.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "qwen3.7-plus", displayName: "Qwen 3.7 Plus", limits: { contextWindow: 1_000_000, maxOutputTokens: 64_000 }, cost: { input: 1.2, output: 4.8, cacheRead: 0.24, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.8-2.4t-a95b", displayName: "Qwen 3.8 2.4T A95B", limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 }, cost: { input: 2, output: 6, cacheRead: 0.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "qwen3.8-27b", displayName: "Qwen 3.8 27B", limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 }, cost: { input: 0.5, output: 3, cacheRead: 0.1, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.8-flash", displayName: "Qwen 3.8 Flash", limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 }, cost: { input: 0.15, output: 0.47, cacheRead: 0.016, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3.8-max", displayName: "Qwen 3.8 Max", limits: { contextWindow: 1_000_000, maxOutputTokens: 65_536 }, cost: { input: 2, output: 6, cacheRead: 0.25, currency: "USD", unit: "per_million_tokens" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "qwen3-coder-480b-a35b-instruct-int4-mixed-ar", displayName: "Qwen3 Coder 480B A35B", limits: { contextWindow: 106_000, maxOutputTokens: 10_600 }, cost: { input: 0.445, output: 2.145, cacheWrite: 0.2225, currency: "USD", unit: "per_million_tokens" } },
  { model: "qwen3-next-80b-a3b-instruct", displayName: "Qwen3 Next 80B A3B", limits: { contextWindow: 262_144, maxOutputTokens: 26_214 }, cost: { input: 0.1175, output: 1.136, cacheWrite: 0.05875, currency: "USD", unit: "per_million_tokens" } },
];

/**
 * Featured offline bootstrap catalog — complete live-stable Hyper model set.
 * Prefer `listHyperModels()` for the current live set.
 */
export const hyperModels = FEATURED.map((entry) =>
  defineHyperModel({
    model: entry.model,
    displayName: entry.displayName,
    capabilities: entry.capabilities,
    limits: entry.limits,
    cost: entry.cost,
    compat: { route: entry.route, preserveThinking: true, ...entry.compat } as HyperModelConfig["compat"],
  }),
) as readonly ModelConfig[];

/** Fallback metadata for discovery entries not in the featured snapshot. */
function heuristicsForHyperModel(id: string): { readonly limits: NonNullable<ModelConfig["limits"]> } {
  const lower = id.toLowerCase();
  if (lower.startsWith("deepseek-") || lower.startsWith("qwen")) {
    return { limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 } };
  }
  if (lower.startsWith("glm-")) {
    return { limits: { contextWindow: 202_752, maxOutputTokens: 32_768 } };
  }
  if (lower.startsWith("kimi-")) {
    return { limits: { contextWindow: 262_144, maxOutputTokens: 65_536 } };
  }
  if (lower.startsWith("llama-")) {
    return { limits: { contextWindow: 128_000, maxOutputTokens: 12_800 } };
  }
  return { limits: { contextWindow: 200_000, maxOutputTokens: 64_000 } };
}