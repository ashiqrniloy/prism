import { redactSecrets, type ModelConfig } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText, type SecretSource } from "@arnilo/prism/provider-kit";

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

/** The catalog is one large listing (~470 models, >64 KiB); the request-body default cap is for completions. */
const OPENROUTER_CATALOG_BYTES = 4_194_304;

export interface OpenRouterModelEntry {
  readonly id: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly top_provider?: { readonly max_completion_tokens?: number | null };
  readonly architecture?: { readonly input_modalities?: readonly string[]; readonly output_modalities?: readonly string[] };
  readonly supported_parameters?: readonly string[];
  readonly pricing?: Readonly<Record<string, string | number>>;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
function rate(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : undefined;
}

/** Cache support is derived from the model family, not a nonexistent catalog cache field. */
export function mapOpenRouterModel(entry: OpenRouterModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || !entry.id.trim()) throw new Error("OpenRouter model entry missing id");
  const params = entry.supported_parameters ?? [];
  const anthropic = entry.id.startsWith("anthropic/");
  const pricing = entry.pricing;
  const rates = {
    input: rate(pricing?.prompt),
    output: rate(pricing?.completion),
    cacheRead: rate(pricing?.input_cache_read),
    cacheWrite: rate(pricing?.input_cache_write),
  };
  const cost = Object.values(rates).some((value) => value !== undefined)
    ? { currency: "USD", ...Object.fromEntries(Object.entries(rates).filter(([, value]) => value !== undefined)) }
    : undefined;
  return {
    provider: options.provider ?? "openrouter",
    model: entry.id,
    displayName: entry.name ?? entry.id,
    capabilities: {
      input: entry.architecture?.input_modalities ?? ["text"],
      output: entry.architecture?.output_modalities ?? ["text"],
      tools: params.includes("tools"),
      reasoning: params.includes("reasoning") || params.includes("reasoning_effort"),
      structuredOutput: params.includes("structured_outputs") ? "json_schema" : false,
      streaming: true,
    },
    limits: { contextWindow: positive(entry.context_length), maxOutputTokens: positive(entry.top_provider?.max_completion_tokens) },
    cost,
    cache: anthropic ? { kind: "cache_control", maxBreakpoints: 4, longRetention: true } : { kind: "implicit" },
    compat: { thinkingFamily: "openai_reasoning", preserveThinking: true, ...(anthropic ? { cacheControl: "anthropic-blocks" } : {}) },
  };
}

/** Conservative snapshot: smallest tool-capable free-pool window, not the router's advertised window. */
export const openRouterModels: readonly ModelConfig[] = [
  {
    ...mapOpenRouterModel({
      id: "openrouter/free",
      name: "OpenRouter Free",
      context_length: 65536,
      supported_parameters: ["tools", "reasoning", "structured_outputs"],
      pricing: { prompt: "0", completion: "0" },
    }),
  },
];

export interface ListOpenRouterModelsOptions {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

export async function listOpenRouterModels(options: ListOpenRouterModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "openrouter";
  const token = await options.apiKey?.();
  const response = await (options.fetch ?? fetch)(`${(options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "")}/models`, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`OpenRouter model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<{ data?: OpenRouterModelEntry[] }>(response, { maxResponseBodyBytes: OPENROUTER_CATALOG_BYTES });
  if (!Array.isArray(payload.data)) throw new Error("OpenRouter model discovery response missing data array");
  return payload.data.map((entry) => mapOpenRouterModel(entry, { provider }));
}
