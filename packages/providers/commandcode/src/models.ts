import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  type ModelCost,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText, type ThinkingCompatFamily } from "@arnilo/prism/provider-kit";

/** Official Command Code Provider API base (`/chat/completions`, `/responses`, `/messages`, `/models`). */
export const COMMAND_CODE_DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";

/** Pricing page the static catalog costs were read from. */
export const COMMAND_CODE_PRICING_SOURCE = "https://commandcode.ai/docs/resources/pricing-limits";

/**
 * Wire that serves a model. `openai` is Chat Completions, `responses` is the OpenAI
 * Responses shape, `anthropic` is the Anthropic Messages shape.
 */
export type CommandCodeRoute = "openai" | "responses" | "anthropic";

/** `supported_endpoints` value that advertises the Responses wire. */
export const COMMAND_CODE_RESPONSES_ENDPOINT = "/responses";

export interface CommandCodeModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "commandcode";
  readonly compat?: JsonObject & {
    /** Route selector: `"anthropic"` → `/messages`, `"responses"` → `/responses`, default `"openai"` → `/chat/completions`. */
    readonly route?: CommandCodeRoute;
    /** Replay prior thinking (Anthropic thinking blocks / OpenAI `reasoning_content`). */
    readonly preserveThinking?: boolean;
    /** Upstream passthrough for Chat Completions models that accept `reasoning_effort`. */
    readonly reasoning_effort?: string;
    /** Upstream OpenAI-style `reasoning` object (`{"effort":"high"}`, Responses wire). */
    readonly reasoning?: JsonObject;
    /** Page the static costs were read from. */
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
 * Official `GET /provider/v1/models` entry (measured 2026-10-28): `id`, `object`,
 * `created`, `owned_by`, `name`, `context_length`, and the routes that answer the
 * model. A catalog that omits `supported_endpoints` is still usable.
 */
export interface CommandCodeModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly supported_endpoints?: readonly string[];
}

interface CommandCodeModelsResponse {
  readonly object?: string;
  readonly data?: readonly CommandCodeModelEntry[];
}

export interface CommandCodeModelFamily {
  readonly reasoning: boolean;
  readonly vision: boolean;
  /** Published reasoning efforts, when the family is known to accept `reasoning_effort`. */
  readonly efforts?: readonly string[];
}

/**
 * Capability rules per model family, from the live probes in plan 205 Task 1b and the
 * reference catalog's published efforts (pi-commandcode-provider 0.7.10, 2026-10-23).
 * The gateway catalog carries no capability fields, so an unknown family stays text-only
 * and declares no reasoning rather than guessing — the same degradation the reference
 * catalog documents for models published after its snapshot.
 */
const COMMAND_CODE_FAMILIES: readonly { readonly matches: (name: string) => boolean; readonly family: CommandCodeModelFamily }[] = [
  // Claude 5.x: Messages wire only, reasoning (adaptive thinking), image input — haiku-5-5 verified live.
  {
    matches: (name) => name.startsWith("claude-"),
    family: { reasoning: true, vision: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  },
  // GPT-5.6: Responses-capable, reasoning + image input — luna verified live.
  {
    matches: (name) => name.startsWith("gpt-5.6"),
    family: { reasoning: true, vision: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  },
  // DeepSeek V4: reasoning with low/high/max — flash-fast verified live (`reasoning_effort: high`).
  { matches: (name) => name.startsWith("deepseek-v4"), family: { reasoning: true, vision: false, efforts: ["low", "high", "max"] } },
  // Vision variants (e.g. `deepseek-v4-flash-vision-exp`, verified live on the Responses wire).
  { matches: (name) => name.includes("vision"), family: { reasoning: true, vision: true } },
  // Free reasoning exemplars used by the probes: beam has efforts low…max, glyph has none published.
  { matches: (name) => name.startsWith("beam") || name.startsWith("glyph"), family: { reasoning: true, vision: false } },
];

/** Family rules for a model id; the vendor prefix (`deepseek/…`) is not part of the name. */
export function commandCodeFamily(modelId: string): CommandCodeModelFamily | undefined {
  const name = modelId.toLowerCase().split("/").pop() ?? modelId.toLowerCase();
  return COMMAND_CODE_FAMILIES.find((entry) => entry.matches(name))?.family;
}

/** Published max output tokens for the models where a live error body or the reference catalog states them. */
const COMMAND_CODE_MAX_OUTPUT: Readonly<Record<string, number>> = {
  "claude-haiku-5-5": 128_000, // measured: `max_tokens: 10000000 > 128000, which is the maximum allowed …`
};

/**
 * Resolves a model to the Provider API wire that serves it (plan 205 Task 1 (b)).
 *
 * Claude models answer on `/messages` only. Every other model answers on
 * `/chat/completions`, and `/provider/v1/models` advertises which of them also serve
 * `/responses`; those use the OpenAI Responses wire. Without endpoint metadata the model
 * keeps Chat Completions, which every non-Claude model serves, so a catalog that omits
 * the field never breaks. An explicit `compat.route` always wins (see `createRoutedProvider`).
 */
export function routeForCommandCodeModel(modelId: string, supportedEndpoints?: readonly string[]): CommandCodeRoute {
  if (modelId.toLowerCase().startsWith("claude-")) return "anthropic";
  // Beam requires plain reasoning_content on tool follow-ups; the Responses bridge loses it.
  if (modelId === "reflection/beam:free") return "openai";
  return supportedEndpoints?.includes(COMMAND_CODE_RESPONSES_ENDPOINT) ? "responses" : "openai";
}

/** Per-route thinking family: the wire field each route reads for a host thinking level. */
function thinkingFamilyForRoute(route: CommandCodeRoute): ThinkingCompatFamily | undefined {
  if (route === "responses") return "openai_reasoning"; // `reasoning: {effort}`
  if (route === "anthropic") return "reasoning_effort"; // `output_config: {effort}`
  return "reasoning_effort"; // `reasoning_effort`
}

export function defineCommandCodeModel(config: CommandCodeModelConfig): ModelConfig {
  const route = (config.compat?.route ?? routeForCommandCodeModel(config.model)) as CommandCodeRoute;
  const family = commandCodeFamily(config.model);
  const cache =
    config.cache ??
    (route === "anthropic" ? { kind: "cache_control" as const, longRetention: false, maxBreakpoints: 4 } : { kind: "implicit" as const });
  return {
    ...config,
    provider: "commandcode",
    capabilities: {
      input: family?.vision ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning: family?.reasoning ?? false,
      tools: true,
      streaming: true,
      ...(family?.efforts ? { thinkingLevels: family.efforts } : {}),
      ...config.capabilities,
    },
    cache,
    compat: {
      ...(thinkingFamilyForRoute(route) ? { thinkingFamily: thinkingFamilyForRoute(route) } : {}),
      preserveThinking: true,
      ...config.compat,
      route: config.compat?.route ?? route,
      pricing_source: COMMAND_CODE_PRICING_SOURCE,
    },
  };
}

/**
 * Caller-gated Command Code model discovery via official `GET /models`.
 * Never invoked by the package shell — hosts call this and pass the result via
 * `models:` (or the package's `models()` does it when no static catalog is configured).
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
 * Models whose upstream accepts image input (reference: installed pi-commandcode-provider
 * 0.7.10 `MODEL_INPUT_MODALITIES`, read 2026-10-28). `GET /models` advertises endpoints and
 * windows only, so the modality has to be declared here or the kernel codecs refuse images.
 */
const VISION_MODELS: ReadonlySet<string> = new Set([
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-haiku-4-5-20251001",
  "claude-haiku-5-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "deepseek/deepseek-v4-flash-vision-exp",
  "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash-fast",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.5-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "google/gemini-4-argon",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "meta/muse-spark-1.1",
  "meta/muse-spark-1.2",
  "meta/muse-spark-1.2-contributor",
  "meta/muse-spark-1.3",
  "meta/muse-spark-1.3-contributor",
  "meta/muse-spark-open",
  "meta/muse-wonder-1.0",
  "minimax/minimax-m3.1-flash",
  "MiniMaxAI/MiniMax-M3",
  "mistral/mistral-large-4",
  "moonshotai/Kimi-K2.5",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.7-Code-Highspeed",
  "moonshotai/Kimi-K3",
  "nvidia/nemotron-3.5-super-vl",
  "ornith/ornith-1.5-122b",
  "Qwen/Qwen3.6-Plus",
  "Qwen/Qwen3.7-Flash",
  "Qwen/Qwen3.7-Plus",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-Flash",
  "Qwen/Qwen3.8-Max",
  "Qwen/Qwen3.8-Max-0902",
  "Qwen/Qwen3.8-Max-Prime",
  "Qwen/Qwen3.8-Omni-Flash",
  "sakana/fugu-ultra",
  "stepfun/Step-3.7-Flash",
  "stepfun/Step-5-Preview",
  "thinkingmachines/inkling",
  "thinkingmachines/inkling-small",
  "xai/grok-4.5",
  "xai/grok-4.6",
  "xai/grok-4.7",
  "xiaomi/mimo-v2.6-flash",
  "xiaomi/mimo-v2.6-pro",
  "xiaomi/mimo-v2.6-pro-ultraspeed",
  "z-ai/glm-5.3-flash",
  "z-ai/glm-5.3-flashx",
]);

/** Maps a published `/models` entry; `context_length` becomes `limits.contextWindow`. */
export function mapCommandCodeModel(entry: CommandCodeModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Command Code model entry missing id");
  }
  const contextWindow =
    typeof entry.context_length === "number" && Number.isFinite(entry.context_length) && entry.context_length > 0
      ? entry.context_length
      : undefined;
  const maxOutputTokens = COMMAND_CODE_MAX_OUTPUT[entry.id];
  return defineCommandCodeModel({
    provider: (options.provider as "commandcode" | undefined) ?? "commandcode",
    model: entry.id,
    ...(typeof entry.name === "string" && entry.name ? { displayName: entry.name } : {}),
    limits: {
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    },
    ...(VISION_MODELS.has(entry.id) ? { capabilities: { input: ["text", "image"] } } : {}),
    compat: { route: routeForCommandCodeModel(entry.id, entry.supported_endpoints) },
  });
}

interface FeaturedMeta {
  readonly model: string;
  readonly displayName: string;
  readonly route: CommandCodeRoute;
  readonly limits: NonNullable<ModelConfig["limits"]>;
  readonly cost: ModelCost;
  readonly capabilities?: ModelConfig["capabilities"];
}

/**
 * Offline bootstrap catalog: the three live exemplars from plan 205, one per wire.
 * Costs are the published rates (USD per million tokens) read 2026-10-23; renewal and
 * peak/off-peak variants are noted in the README, not modelled. Windows come from
 * `GET /models`, max output from the live error bodies in Task 1b.
 */
const FEATURED: readonly FeaturedMeta[] = [
  {
    // Chat-only in the live catalog (2026-10-28) and verified for text, tools, JSON Schema and image
    // input. `deepseek/deepseek-v4-flash-fast`, the model the plan named, now answers 404 from its
    // upstream and is not shipped in the static catalog.
    model: "minimax/minimax-m3.1-flash",
    displayName: "MiniMax M3.1 Flash via Command Code",
    route: "openai",
    limits: { contextWindow: 1_000_000 },
    cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "image"], structuredOutput: "json_schema" },
  },
  {
    model: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna via Command Code",
    route: "responses",
    limits: { contextWindow: 1_050_000 },
    cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "image"], structuredOutput: "json_schema" },
  },
  {
    model: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5 via Command Code",
    route: "anthropic",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, currency: "USD", unit: "per_million_tokens" },
  },
];

/**
 * Featured offline bootstrap catalog. Prefer `listCommandCodeModels()` for the live set:
 * it covers every model the account can reach and carries the advertised window.
 */
export const commandCodeModels = FEATURED.map((entry) =>
  defineCommandCodeModel({
    model: entry.model,
    displayName: entry.displayName,
    limits: entry.limits,
    cost: entry.cost,
    capabilities: entry.capabilities,
    compat: { route: entry.route, preserveThinking: true },
  }),
) as readonly ModelConfig[];
