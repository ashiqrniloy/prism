import {
  type CredentialValueSource,
  type JsonObject,
  type JsonValue,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import {
  providerHttpError,
  readBoundedResponseJson,
  readBoundedResponseText,
  readRetryAfterMs,
  snapThinkingLevel,
  type ThinkingCompatFamily,
} from "@arnilo/prism/provider-kit";

/** Ollama Cloud host root; the native route uses `/api/chat`, the compat route `/v1/chat/completions`. */
export const OLLAMA_CLOUD_DEFAULT_BASE_URL = "https://ollama.com";

export type OllamaCloudRoute = "native" | "openai";

export interface OllamaCloudModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "ollama-cloud";
  readonly compat?: JsonObject & {
    /** Dual-route selector; a per-model value wins over the package `route` config. */
    readonly route?: OllamaCloudRoute;
    /** Native `think` values from `/api/show` (`[false,true]` or named levels). */
    readonly thinkingValues?: JsonValue;
    /** `/api/show` default thinking value. */
    readonly thinkingDefault?: JsonValue;
    readonly thinkingFamily?: ThinkingCompatFamily;
    readonly preserveThinking?: boolean;
  };
}

export interface ListOllamaCloudModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/** Sparse `/api/tags` entry. Cloud adds `capabilities`; the other fields are the local shape. */
export interface OllamaCloudModelEntry {
  readonly name?: string;
  readonly model?: string;
  readonly modified_at?: string;
  readonly size?: number;
  readonly digest?: string;
  readonly details?: JsonObject;
  readonly capabilities?: readonly string[];
}

/** `/api/show` reply fields this package reads. */
export interface OllamaCloudShowEntry {
  readonly capabilities?: readonly string[];
  readonly details?: JsonObject;
  readonly model_info?: Readonly<Record<string, unknown>>;
  readonly thinking?: { readonly values?: readonly JsonValue[]; readonly default?: JsonValue } | null;
}

interface OllamaCloudTagsResponse {
  readonly models?: readonly OllamaCloudModelEntry[];
}

const FULL_THINKING_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Portable levels for the native `think` values. Boolean models accept any non-`none` level. */
export function ollamaCloudThinkingLevels(values: readonly JsonValue[] | undefined): readonly string[] | undefined {
  if (!values || values.length === 0) return undefined;
  const named = values.filter((value): value is string => typeof value === "string");
  if (named.length === 0) return FULL_THINKING_LADDER;
  return ["none", ...named];
}

/** Whether `/api/show` declares a boolean thinking toggle (`[false,true]`). */
export function ollamaCloudThinkingIsBoolean(values: readonly JsonValue[] | undefined): boolean {
  return Boolean(values?.includes(false)) && !values?.some((value) => typeof value === "string");
}

/** Native `think` value for a requested portable level; `undefined` leaves the model default alone. */
export function ollamaCloudThink(request: {
  readonly model: ModelConfig;
  readonly options?: { readonly compat?: JsonObject };
}): boolean | string | undefined {
  const raw = request.options?.compat?.thinking;
  if (typeof raw === "boolean" || typeof raw === "string") return raw;

  const effort =
    request.options?.compat?.reasoning_effort ?? request.options?.compat?.reasoningEffort ?? request.model.compat?.reasoning_effort;
  if (typeof effort !== "string" || !effort.trim()) return undefined;
  const level = effort.trim().toLowerCase();
  if (level === "none") return false;

  const values = thinkingValues(request.model);
  if (!values) return true;
  if (ollamaCloudThinkingIsBoolean(values)) return true;
  const named = values.filter((value): value is string => typeof value === "string");
  if (named.length === 0) return true;
  return String(
    snapThinkingLevel({ ...request.model, capabilities: { ...request.model.capabilities, thinkingLevels: ["none", ...named] } }, level),
  );
}

/** Thinking values from a model's `compat`, validated to the two wire forms. */
export function thinkingValues(model: ModelConfig): readonly JsonValue[] | undefined {
  const values = model.compat?.thinkingValues;
  if (!Array.isArray(values)) return undefined;
  return values.filter((value): value is JsonValue => typeof value === "boolean" || typeof value === "string");
}

/** Builds a model with the Ollama Cloud cache/thinking conventions. */
export function defineOllamaCloudModel(config: OllamaCloudModelConfig): ModelConfig {
  const thinkingValues = config.compat?.thinkingValues;
  const levels = ollamaCloudThinkingLevels(Array.isArray(thinkingValues) ? thinkingValues : undefined);
  return {
    ...config,
    provider: "ollama-cloud",
    capabilities: {
      input: ["text"],
      output: ["text"],
      streaming: true,
      ...config.capabilities,
      ...(levels ? { thinkingLevels: levels } : {}),
    },
    cache: config.cache ?? { kind: "implicit" },
    compat: {
      thinkingFamily: "reasoning_effort",
      preserveThinking: true,
      ...config.compat,
    },
  };
}

/** Task 1 (e) exemplars, with the measured windows and thinking values. */
export const ollamaCloudModels: readonly ModelConfig[] = [
  defineOllamaCloudModel({
    model: "gemma4:31b",
    displayName: "Gemma 4 31B",
    capabilities: { input: ["text", "image"], reasoning: true, tools: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 262_144 },
    compat: { thinkingValues: [false, true], thinkingDefault: false },
  }),
  defineOllamaCloudModel({
    model: "gpt-oss:20b",
    displayName: "GPT-OSS 20B",
    capabilities: { reasoning: true, tools: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 131_072 },
    compat: { thinkingValues: ["low", "medium", "high"], thinkingDefault: "medium" },
  }),
  defineOllamaCloudModel({
    model: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    capabilities: { input: ["text", "image"], reasoning: true, tools: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 1_048_576 },
    compat: { thinkingValues: [false, "low", "high", "max"], thinkingDefault: "high" },
  }),
  defineOllamaCloudModel({
    model: "kimi-k3",
    displayName: "Kimi K3",
    capabilities: { input: ["text", "image"], reasoning: true, tools: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 1_048_576 },
    compat: { thinkingValues: [false, "low", "high", "max"], thinkingDefault: "max" },
  }),
  defineOllamaCloudModel({
    model: "mistral-large-4",
    displayName: "Mistral Large 4",
    capabilities: { input: ["text", "image"], reasoning: true, tools: true, structuredOutput: "json_schema" },
    limits: { contextWindow: 1_048_576 },
  }),
];

/** Maps one `/api/tags` entry (plus its `/api/show` reply) to a Prism model. */
export function mapOllamaCloudModel(
  entry: OllamaCloudModelEntry,
  show?: OllamaCloudShowEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  const id = entry.model ?? entry.name;
  if (typeof id !== "string" || id.length === 0) throw new Error("Ollama Cloud model entry missing model id");
  const tags = entry.capabilities ?? [];
  const capabilities = show?.capabilities ?? tags;
  const thinking = show?.thinking;
  const values = thinking?.values;
  const contextWindow = contextLength(show?.model_info);
  return defineOllamaCloudModel({
    provider: (options.provider as "ollama-cloud" | undefined) ?? "ollama-cloud",
    model: id,
    displayName: id,
    capabilities: {
      input: capabilities.includes("vision") ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning: capabilities.includes("thinking"),
      tools: capabilities.includes("tools"),
      structuredOutput: "json_schema",
    },
    ...(contextWindow !== undefined ? { limits: { contextWindow } } : {}),
    ...(values
      ? { compat: { thinkingValues: [...values], ...(thinking?.default !== undefined ? { thinkingDefault: thinking.default } : {}) } }
      : {}),
  });
}

/** Reads `context_length` from any `*.context_length` key in `/api/show`'s `model_info`. */
export function contextLength(modelInfo: Readonly<Record<string, unknown>> | undefined): number | undefined {
  if (!modelInfo) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if ((key === "context_length" || key.endsWith(".context_length")) && typeof value === "number" && value > 0) return value;
  }
  return undefined;
}

/** Caller-gated discovery: one `/api/tags`, then `/api/show` per model with concurrency 4. */
export async function listOllamaCloudModels(options: ListOllamaCloudModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "ollama-cloud";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? OLLAMA_CLOUD_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const headers = {
    ...options.headers,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const tags = await requestJson<OllamaCloudTagsResponse>(options.fetch ?? fetch, `${baseUrl}/api/tags`, {
    provider,
    method: "GET",
    headers,
    secrets: [token],
    signal: options.signal,
  });
  if (!Array.isArray(tags.models)) throw new Error("Ollama Cloud model discovery response missing models array");

  const entries = tags.models;
  const models = new Array<ModelConfig>(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index]!;
      const id = entry.model ?? entry.name;
      if (!id) throw new Error("Ollama Cloud model discovery entry missing model id");
      const show = await requestJson<OllamaCloudShowEntry>(options.fetch ?? fetch, `${baseUrl}/api/show`, {
        provider,
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ model: id }),
        secrets: [token],
        signal: options.signal,
      });
      models[index] = mapOllamaCloudModel(entry, show, { provider });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  return models;
}

export interface OllamaCloudBalanceWindow {
  readonly remainingPercent: number;
  readonly resetsAt: string;
}

export interface OllamaCloudBalance {
  readonly session?: OllamaCloudBalanceWindow;
  readonly weekly?: OllamaCloudBalanceWindow;
  readonly purchasedUsd?: number;
}

export interface OllamaCloudBalanceOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/** Plan limits from `/api/balance`; never called during a model run and never returns the key. */
export async function ollamaCloudBalance(options: OllamaCloudBalanceOptions = {}): Promise<OllamaCloudBalance> {
  const provider = options.provider ?? "ollama-cloud";
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? OLLAMA_CLOUD_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const payload = await requestJson<{
    readonly included?: { readonly session?: unknown; readonly weekly?: unknown };
    readonly purchased?: { readonly balance_usd?: unknown };
  }>(options.fetch ?? fetch, `${baseUrl}/api/balance`, {
    provider,
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    secrets: [token],
    signal: options.signal,
  });
  const session = balanceWindow(payload.included?.session);
  const weekly = balanceWindow(payload.included?.weekly);
  const purchasedUsd =
    typeof payload.purchased?.balance_usd === "number" && Number.isFinite(payload.purchased.balance_usd)
      ? payload.purchased.balance_usd
      : undefined;
  return {
    ...(session ? { session } : {}),
    ...(weekly ? { weekly } : {}),
    ...(purchasedUsd !== undefined ? { purchasedUsd } : {}),
  };
}

function balanceWindow(value: unknown): OllamaCloudBalanceWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.remaining_percent !== "number" || typeof record.resets_at !== "string") return undefined;
  return { remainingPercent: record.remaining_percent, resetsAt: record.resets_at };
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  options: {
    readonly provider: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly secrets: readonly (string | undefined)[];
    readonly signal?: AbortSignal;
  },
): Promise<T> {
  const response = await fetchImpl(url, {
    method: options.method,
    headers: { ...options.headers },
    ...(options.body !== undefined ? { body: options.body } : {}),
    signal: options.signal,
  });
  if (!response.ok) {
    const bodyText = await readBoundedResponseText(response, { secrets: options.secrets });
    throw providerHttpError(
      "Ollama Cloud",
      { status: response.status, code: response.status, retryAfterMs: readRetryAfterMs(response.headers) },
      `${redactSecrets(bodyText, options.secrets)}`,
      options.secrets,
    );
  }
  return readBoundedResponseJson<T>(response, { signal: options.signal });
}
