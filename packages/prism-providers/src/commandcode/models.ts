import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Official Command Code Provider API base (`/chat/completions`, `/messages`, `/models`). */
export const COMMAND_CODE_DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";

export type CommandCodeRoute = "openai" | "anthropic";

export interface CommandCodeModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "commandcode";
  readonly compat?: JsonObject & {
    /** Dual-route selector: `"anthropic"` → `/messages`; default `"openai"` → `/chat/completions`. */
    readonly route?: CommandCodeRoute;
    /** Replay prior thinking (Anthropic thinking blocks / OpenAI `reasoning_content`). */
    readonly preserveThinking?: boolean;
    /** Cost provenance caveat, e.g. `docs:pricing-limits (mean per-provider)`. Stripped before the wire. */
    readonly pricing_source?: string;
  };
}

export interface ListCommandCodeModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://api.commandcode.ai/provider/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * Command Code `GET /provider/v1/models` entry — public, no auth required.
 * Sparse payload: id + context window only (no pricing/capabilities).
 * @see https://commandcode.ai/docs/provider
 */
export interface CommandCodeModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
  readonly name?: string;
  readonly context_length?: number;
}

interface CommandCodeModelsResponse {
  readonly object?: string;
  readonly data?: readonly CommandCodeModelEntry[];
}

/**
 * Server-enforced route split: `claude-*` ids only exist on `/messages`;
 * everything else lives on `/chat/completions` (the API rejects a model sent to
 * the wrong endpoint with 400). See https://commandcode.ai/docs/provider.
 */
export function routeForCommandCodeModel(modelId: string): CommandCodeRoute {
  return modelId.toLowerCase().startsWith("claude-") ? "anthropic" : "openai";
}

function cacheKindForCommandCodeModel(route: CommandCodeRoute): ModelConfig["cache"] {
  return route === "anthropic"
    ? { kind: "cache_control" as const, maxBreakpoints: 4 }
    : { kind: "implicit" as const };
}

export function defineCommandCodeModel(config: CommandCodeModelConfig): ModelConfig {
  const route = (config.compat?.route ?? routeForCommandCodeModel(config.model)) as CommandCodeRoute;
  return {
    ...config,
    provider: "commandcode",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
    cache: config.cache ?? cacheKindForCommandCodeModel(route),
    compat: {
      preserveThinking: true,
      ...config.compat,
      route: config.compat?.route ?? route,
    } as CommandCodeModelConfig["compat"],
  };
}

/**
 * Caller-gated Command Code model discovery via the public
 * `GET /provider/v1/models` endpoint. Never invoked by
 * `createCommandCodeProviderPackage` — hosts call this and pass results via
 * `models:`. Public endpoint: no auth header is emitted when no key resolves.
 * @see https://commandcode.ai/docs/provider
 */
export async function listCommandCodeModels(options: ListCommandCodeModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "commandcode";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? COMMAND_CODE_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Command Code model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<CommandCodeModelsResponse>(response);
  if (!Array.isArray(payload.data)) throw new Error("Command Code model discovery response missing data array");
  return payload.data.map((entry) => mapCommandCodeModel(entry, { provider }));
}

/**
 * Map a live `/provider/v1/models` entry to Prism `ModelConfig` — route from id
 * (`claude-*` → anthropic), context window from the endpoint. The endpoint
 * carries no pricing/capabilities, so matching featured entries apply their
 * docs-verified metadata (cost, cache kind, capabilities); unknown ids get
 * route + implicit cache only.
 */
export function mapCommandCodeModel(entry: CommandCodeModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Command Code model entry missing id");
  }
  const route = routeForCommandCodeModel(entry.id);
  const featured = FEATURED_META.get(entry.id);
  return defineCommandCodeModel({
    provider: (options.provider as "commandcode" | undefined) ?? "commandcode",
    model: entry.id,
    displayName: entry.name ?? entry.id,
    capabilities: featured?.capabilities,
    limits: { contextWindow: typeof entry.context_length === "number" ? entry.context_length : heuristicsForCommandCodeModel(entry.id) },
    cost: featured?.cost,
    compat: featured?.compat,
    // Discovery entries without a featured match still get the route-derived cache kind.
    ...(featured ? {} : { cache: cacheKindForCommandCodeModel(route) }),
  });
}

type FeaturedMeta = Omit<CommandCodeModelConfig, "provider" | "model"> & { readonly model: string; readonly route?: CommandCodeRoute };

/**
 * Featured offline bootstrap catalog — curated from the Command Code docs
 * pricing table (https://commandcode.ai/docs/resources/pricing-limits) with
 * ids/context windows from the live `GET /provider/v1/models` snapshot
 * (2026-09). Prices are USD per 1M tokens. Caveats recorded via
 * `compat.pricing_source`:
 *
 * - Open-source models are routed across multiple upstream providers; the
 *   docs list the **mean per-provider price** (actual cost may vary slightly).
 * - DeepSeek rates are the **off-peak** rates (17h/day); peak (7h/day:
 *   01–04 & 06–10 UTC) is 2×.
 * - Deal pricing already applied (MiniMax M3 −50%, MiMo 98/99% off).
 *
 * Cache kinds: `claude-*` → `cache_control`; GPT-5.6/others → `implicit` until
 * the Task 5 live probe verifies explicit-cache passthrough (docs list a cache
 * write price, recorded in `cost.cacheWrite`, but the wire field is
 * unverified).
 */
const FEATURED: readonly FeaturedMeta[] = [
  // Claude tiers (Anthropic route; cache_control with write pricing)
  { model: "claude-opus-5", displayName: "Claude Opus 5", limits: { contextWindow: 1_000_000 }, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-opus-4-8", displayName: "Claude Opus 4.8", limits: { contextWindow: 1_000_000 }, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-opus-4-7", displayName: "Claude Opus 4.7", limits: { contextWindow: 1_000_000 }, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-sonnet-5", displayName: "Claude Sonnet 5", limits: { contextWindow: 1_000_000 }, cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", limits: { contextWindow: 1_000_000 }, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-fable-5-1", displayName: "Claude Fable 5.1", limits: { contextWindow: 1_000_000 }, cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-fable-5", displayName: "Claude Fable 5", limits: { contextWindow: 1_000_000 }, cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", limits: { contextWindow: 200_000 }, cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, currency: "USD", unit: "per_million_tokens" } },
  // GPT-5.6 explicit-cache candidates (chat route; implicit until probe — Task 5/9)
  { model: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", limits: { contextWindow: 1_050_000 }, cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", limits: { contextWindow: 1_050_000 }, cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "gpt-5.6-luna", displayName: "GPT-5.6 Luna", limits: { contextWindow: 1_050_000 }, cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, currency: "USD", unit: "per_million_tokens" } },
  // DeepSeek v4 (chat route; off-peak rates, peak = 2×)
  { model: "deepseek/deepseek-v4-pro", displayName: "DeepSeek V4 Pro (latest)", limits: { contextWindow: 1_000_000 }, cost: { input: 0.66, output: 1.98, cacheRead: 0.022, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (off-peak 17h/day; peak 2× 01–04 & 06–10 UTC)" } },
  { model: "deepseek/deepseek-v4-flash", displayName: "DeepSeek V4 Flash (latest)", limits: { contextWindow: 1_000_000 }, cost: { input: 0.22, output: 0.66, cacheRead: 0.007, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (off-peak 17h/day; peak 2×)" } },
  { model: "deepseek/deepseek-v4-flash-vision-exp", displayName: "DeepSeek V4 Flash Vision (exp)", limits: { contextWindow: 1_000_000 }, cost: { input: 0.22, output: 0.66, cacheRead: 0.007, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (off-peak 17h/day; peak 2×)" }, capabilities: { input: ["text", "image"], output: ["text"], reasoning: true, tools: true, streaming: true } },
  { model: "deepseek/deepseek-v4-flash-fast", displayName: "DeepSeek V4 Flash Fast", limits: { contextWindow: 1_000_000 }, cost: { input: 0.28, output: 0.56, cacheRead: 0.07, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (off-peak 17h/day; peak 2×)" } },
  // Kimi
  { model: "moonshotai/Kimi-K3", displayName: "Kimi K3", limits: { contextWindow: 1_000_000 }, cost: { input: 3, output: 15, cacheRead: 0.3, currency: "USD", unit: "per_million_tokens" } },
  { model: "moonshotai/Kimi-K2.7-Code", displayName: "Kimi K2.7 Code", limits: { contextWindow: 256_000 }, cost: { input: 0.95, output: 4, cacheRead: 0.19, currency: "USD", unit: "per_million_tokens" } },
  { model: "moonshotai/Kimi-K2.7-Code-Highspeed", displayName: "Kimi K2.7 Code HighSpeed", limits: { contextWindow: 262_000 }, cost: { input: 1.9, output: 8, cacheRead: 0.38, currency: "USD", unit: "per_million_tokens" } },
  { model: "moonshotai/Kimi-K2.6", displayName: "Kimi K2.6", limits: { contextWindow: 256_000 }, cost: { input: 0.95, output: 4, cacheRead: 0.16, currency: "USD", unit: "per_million_tokens" } },
  { model: "moonshotai/Kimi-K2.5", displayName: "Kimi K2.5", limits: { contextWindow: 256_000 }, cost: { input: 0.6, output: 3, cacheRead: 0.1, currency: "USD", unit: "per_million_tokens" } },
  // GLM
  { model: "z-ai/glm-5.3-flash", displayName: "GLM-5.3 Flash", limits: { contextWindow: 1_048_576 }, cost: { input: 0.15, output: 0.5, cacheRead: 0.03, currency: "USD", unit: "per_million_tokens" } },
  { model: "zai-org/GLM-5.3", displayName: "GLM-5.3", limits: { contextWindow: 1_000_000 }, cost: { input: 1.4, output: 4.4, cacheRead: 0.26, currency: "USD", unit: "per_million_tokens" } },
  // MiniMax M3 family (50% deal applied to M3)
  { model: "MiniMaxAI/MiniMax-M3", displayName: "MiniMax M3", limits: { contextWindow: 1_000_000 }, cost: { input: 0.3, output: 1.2, cacheRead: 0.06, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (deal −50% auto-applied)" } },
  { model: "MiniMaxAI/MiniMax-M2.7", displayName: "MiniMax M2.7", limits: { contextWindow: 200_000 }, cost: { input: 0.3, output: 1.2, cacheRead: 0.06, currency: "USD", unit: "per_million_tokens" } },
  { model: "MiniMaxAI/MiniMax-M2.5", displayName: "MiniMax M2.5", limits: { contextWindow: 200_000 }, cost: { input: 0.3, output: 1.2, cacheRead: 0.03, currency: "USD", unit: "per_million_tokens" } },
  // Qwen 3.8 family
  { model: "Qwen/Qwen3.8-Max-0902", displayName: "Qwen 3.8 Max 0902", limits: { contextWindow: 1_000_000 }, cost: { input: 2, output: 6, cacheRead: 0.25, currency: "USD", unit: "per_million_tokens" } },
  { model: "Qwen/Qwen3.8-Max", displayName: "Qwen 3.8 Max", limits: { contextWindow: 1_000_000 }, cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "Qwen/Qwen3.8-27B", displayName: "Qwen 3.8 27B", limits: { contextWindow: 262_144 }, cost: { input: 0.4, output: 3, cacheRead: 0.04, currency: "USD", unit: "per_million_tokens" } },
  { model: "Qwen/Qwen3.8-Flash", displayName: "Qwen 3.8 Flash", limits: { contextWindow: 1_000_000 }, cost: { input: 0.16, output: 0.47, cacheRead: 0.016, currency: "USD", unit: "per_million_tokens" } },
  // MiMo (deals applied)
  { model: "xiaomi/mimo-v2.5-pro", displayName: "MiMo V2.5 Pro", limits: { contextWindow: 1_000_000 }, cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (deal −99% auto-applied)" } },
  { model: "xiaomi/mimo-v2.5", displayName: "MiMo V2.5", limits: { contextWindow: 1_000_000 }, cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, currency: "USD", unit: "per_million_tokens" }, compat: { pricing_source: "docs:pricing-limits (deal −98% auto-applied)" } },
  // Gemini flash
  { model: "google/gemini-3.7-flash", displayName: "Gemini 3.7 Flash", limits: { contextWindow: 1_048_576 }, cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.08334, currency: "USD", unit: "per_million_tokens" } },
  { model: "google/gemini-3.6-flash", displayName: "Gemini 3.6 Flash", limits: { contextWindow: 1_000_000 }, cost: { input: 1.5, output: 7.5, cacheRead: 0.15, currency: "USD", unit: "per_million_tokens" } },
  { model: "google/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", limits: { contextWindow: 1_000_000 }, cost: { input: 1.5, output: 9, cacheRead: 0.15, currency: "USD", unit: "per_million_tokens" } },
  { model: "google/gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite", limits: { contextWindow: 1_000_000 }, cost: { input: 0.3, output: 2.5, cacheRead: 0.03, currency: "USD", unit: "per_million_tokens" } },
  { model: "google/gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", limits: { contextWindow: 1_000_000 }, cost: { input: 0.25, output: 1.5, cacheRead: 0.03, currency: "USD", unit: "per_million_tokens" } },
  // Grok
  { model: "xai/grok-4.6", displayName: "Grok 4.6", limits: { contextWindow: 500_000 }, cost: { input: 2, output: 6, cacheRead: 0.5, currency: "USD", unit: "per_million_tokens" } },
  { model: "xai/grok-4.5", displayName: "Grok 4.5", limits: { contextWindow: 500_000 }, cost: { input: 2, output: 6, cacheRead: 0.5, currency: "USD", unit: "per_million_tokens" } },
];

const FEATURED_META = new Map(FEATURED.map((meta) => [meta.model, meta]));

/**
 * Featured offline bootstrap catalog — curated from the live `/provider/v1/models`
 * snapshot (67 ids, 2026-09) + docs pricing table. Prefer `listCommandCodeModels()`
 * for the current live set.
 */
export const commandCodeModels = FEATURED.map((entry) =>
  defineCommandCodeModel({
    model: entry.model,
    displayName: entry.displayName,
    capabilities: entry.capabilities,
    limits: entry.limits,
    cost: entry.cost,
    compat: { route: entry.route, preserveThinking: true, ...entry.compat } as CommandCodeModelConfig["compat"],
  }),
) as readonly ModelConfig[];

/** Fallback context window for discovery entries missing `context_length`. */
function heuristicsForCommandCodeModel(id: string): number {
  const lower = id.toLowerCase();
  if (lower.startsWith("claude-")) return 200_000;
  if (lower.startsWith("gpt-")) return 400_000;
  if (lower.includes("kimi-")) return 256_000;
  return 200_000;
}