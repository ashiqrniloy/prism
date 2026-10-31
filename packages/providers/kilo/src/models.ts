import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  type ModelCost,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/provider-kit";

/** Kilo AI Gateway base: `/chat/completions`, `/responses`, `/messages`, `/models`. */
export const KILO_DEFAULT_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";

/** Public catalog the static costs were read from (2026-10-31). */
export const KILO_PRICING_SOURCE = "https://ai-gateway.kilo.ai/api/v1/models";

/** Wire that serves a model. `anthropic` is Messages, `responses` is Responses, `chat` is Chat Completions. */
export type KiloRoute = "chat" | "responses" | "messages";

/** Catalog value that stamps a route (Kilo nests it under `opencode`). */
export function routeFromAiSdkProvider(value: string | undefined): KiloRoute {
  if (value === "anthropic") return "messages";
  if (value === "openai") return "responses";
  return "chat";
}

/** Route for a model: an explicit `compat.route` wins, else the stamped `ai_sdk_provider`, else Chat. */
export function routeForKiloModel(model: Pick<ModelConfig, "compat">): KiloRoute {
  const pinned = model.compat?.route;
  if (pinned === "chat" || pinned === "responses" || pinned === "messages") return pinned;
  // Hosts and the conformance replayer name the wire by codec family.
  if (pinned === "openai") return "chat";
  if (pinned === "anthropic") return "messages";
  const stamped = model.compat?.aiSdkProvider;
  return routeFromAiSdkProvider(typeof stamped === "string" ? stamped : undefined);
}

export interface KiloModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "kilo";
  readonly compat?: JsonObject & {
    readonly route?: KiloRoute;
    readonly aiSdkProvider?: string;
    readonly isFree?: boolean;
    readonly mayTrainOnYourPrompts?: boolean;
    readonly aliasTarget?: string;
    readonly pricing_source?: string;
    readonly preserveThinking?: boolean;
    readonly thinkingFamily?: string;
  };
}

export interface KiloModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly top_provider?: { readonly max_completion_tokens?: number | null };
  readonly architecture?: { readonly input_modalities?: readonly string[]; readonly output_modalities?: readonly string[] };
  readonly supported_parameters?: readonly string[];
  readonly pricing?: Readonly<Record<string, string | number>>;
  readonly opencode?: { readonly ai_sdk_provider?: string };
  readonly isFree?: boolean;
  readonly mayTrainOnYourPrompts?: boolean;
  readonly alias_target?: string;
}

export interface ListKiloModelsOptions {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly organizationId?: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** Catalog is large enough that the default completion-body cap does not apply. */
const KILO_CATALOG_BYTES = 4_194_304;

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function rate(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : undefined;
}

/** Maps one catalog row. `pricing.*` is per token; `ModelCost` is per million. */
export function mapKiloModel(entry: KiloModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || !entry.id.trim()) throw new Error("Kilo model entry missing id");
  const params = entry.supported_parameters ?? [];
  const pricing = entry.pricing;
  const rates = {
    input: rate(pricing?.prompt),
    output: rate(pricing?.completion),
    cacheRead: rate(pricing?.input_cache_read),
    cacheWrite: rate(pricing?.input_cache_write),
  };
  const cost = Object.values(rates).some((value) => value !== undefined)
    ? ({ currency: "USD", ...Object.fromEntries(Object.entries(rates).filter(([, value]) => value !== undefined)) } as ModelCost)
    : undefined;
  const route = routeFromAiSdkProvider(entry.opencode?.ai_sdk_provider);
  return {
    provider: options.provider ?? "kilo",
    model: entry.id,
    displayName: entry.name ?? entry.id,
    capabilities: {
      input: (entry.architecture?.input_modalities as ModelConfig["capabilities"] extends { input?: infer T } ? T : never) ?? ["text"],
      output: (entry.architecture?.output_modalities as ModelConfig["capabilities"] extends { output?: infer T } ? T : never) ?? ["text"],
      // Kilo's own `supportsTools` treats an empty list as tool-capable.
      tools: params.length === 0 || params.includes("tools"),
      reasoning: params.includes("reasoning") || params.includes("reasoning_effort") || params.includes("include_reasoning"),
      structuredOutput: params.includes("structured_outputs") || params.includes("response_format") ? "json_schema" : false,
      streaming: true,
    },
    limits: {
      ...(positive(entry.context_length) !== undefined ? { contextWindow: entry.context_length } : {}),
      ...(positive(entry.top_provider?.max_completion_tokens) !== undefined
        ? { maxOutputTokens: positive(entry.top_provider?.max_completion_tokens) }
        : {}),
    },
    ...(cost !== undefined ? { cost } : {}),
    cache: route === "messages" ? { kind: "cache_control", maxBreakpoints: 4, longRetention: false } : { kind: "implicit" },
    compat: {
      route,
      ...(entry.opencode?.ai_sdk_provider ? { aiSdkProvider: entry.opencode.ai_sdk_provider } : {}),
      ...(entry.isFree === true ? { isFree: true } : {}),
      ...(entry.mayTrainOnYourPrompts === true ? { mayTrainOnYourPrompts: true } : {}),
      ...(entry.alias_target ? { aliasTarget: entry.alias_target } : {}),
      preserveThinking: true,
      ...(route === "responses" ? { thinkingFamily: "openai_reasoning" } : {}),
      ...(route === "messages" ? { thinkingFamily: "reasoning_effort" } : {}),
      ...(route === "chat" ? { thinkingFamily: "openai_reasoning" } : {}),
    },
  };
}

export function defineKiloModel(config: KiloModelConfig): ModelConfig {
  const route = config.compat?.route ?? routeForKiloModel(config as Pick<ModelConfig, "compat">);
  return {
    ...config,
    provider: "kilo",
    cache:
      config.cache ?? (route === "messages" ? { kind: "cache_control", maxBreakpoints: 4, longRetention: false } : { kind: "implicit" }),
    compat: {
      ...config.compat,
      route,
      preserveThinking: true,
      pricing_source: KILO_PRICING_SOURCE,
    },
  };
}

interface Featured {
  readonly model: string;
  readonly displayName: string;
  readonly route: KiloRoute;
  readonly limits: NonNullable<ModelConfig["limits"]>;
  readonly cost: ModelCost;
  readonly capabilities: ModelConfig["capabilities"];
}

/**
 * Offline bootstrap: one exemplar per wire from the 2026-10-31 catalog. All three are paid
 * on the reference account; the free `nvidia/nemotron-3.5-super-vl:free` row below keeps a
 * keyless install usable and is the model the wire fixtures were captured on.
 */
const FEATURED: readonly Featured[] = [
  {
    model: "google/gemma-4-26b-a4b-it",
    displayName: "Gemma 4 26B A4B via Kilo",
    route: "chat",
    limits: { contextWindow: 262_144, maxOutputTokens: 235_929 },
    cost: { input: 0.01, output: 0.03, cacheRead: 0.005, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "image", "video"], output: ["text"], tools: true, reasoning: true, structuredOutput: "json_schema" },
  },
  {
    model: "openai/gpt-6-luna",
    displayName: "GPT-6 Luna via Kilo",
    route: "responses",
    limits: { contextWindow: 1_050_000, maxOutputTokens: 128_000 },
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "image"], output: ["text"], tools: true, reasoning: true, structuredOutput: "json_schema" },
  },
  {
    model: "anthropic/claude-haiku-5.5",
    displayName: "Claude Haiku 5.5 via Kilo",
    route: "messages",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, currency: "USD", unit: "per_million_tokens" },
    capabilities: { input: ["text", "image"], output: ["text"], tools: true, reasoning: true },
  },
  {
    model: "nvidia/nemotron-3.5-super-vl:free",
    displayName: "Nemotron 3.5 Super VL (free)",
    route: "chat",
    limits: { contextWindow: 1_000_000 },
    cost: { input: 0, output: 0, currency: "USD", unit: "per_million_tokens" },
    capabilities: {
      input: ["text", "image", "video"],
      output: ["text"],
      tools: true,
      reasoning: true,
      structuredOutput: "json_schema",
    },
  },
];

export const kiloModels = FEATURED.map((entry) =>
  defineKiloModel({
    model: entry.model,
    displayName: entry.displayName,
    limits: entry.limits,
    cost: entry.cost,
    capabilities: entry.capabilities,
    compat: { route: entry.route, ...(entry.model.endsWith(":free") ? { isFree: true } : {}) },
  }),
) as readonly ModelConfig[];

export async function listKiloModels(options: ListKiloModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "kilo";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? KILO_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const path = options.organizationId
    ? `${baseUrl}/organizations/${encodeURIComponent(options.organizationId)}/models`
    : `${baseUrl}/models`;
  const response = await (options.fetch ?? fetch)(path, {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.organizationId ? { "X-KILOCODE-ORGANIZATIONID": options.organizationId } : {}),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Kilo model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<{ data?: KiloModelEntry[] }>(response, { maxResponseBodyBytes: KILO_CATALOG_BYTES });
  if (!Array.isArray(payload.data)) throw new Error("Kilo model discovery response missing data array");
  return payload.data.map((entry) => mapKiloModel(entry, { provider }));
}
