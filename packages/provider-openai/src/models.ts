import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH } from "./cache.js";

export interface OpenAIModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "openai" | "openai-codex" | string;
  readonly compat?: JsonObject & {
    readonly api?: "openai-responses" | "openai-codex-responses" | string;
    /** Official Responses `reasoning` object (`effort`, `summary`, …). */
    readonly reasoning?: JsonObject;
  };
}

export interface ListOpenAIModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Defaults to `"openai"`. Codex subscription models are not listed by `api.openai.com`. */
  readonly provider?: string;
}

export interface OpenAIModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface OpenAIModelsResponse {
  readonly object?: string;
  readonly data?: readonly OpenAIModelEntry[];
}

export function defineOpenAIModel(config: OpenAIModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "openai",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      ...config.capabilities,
    },
    cache: config.cache ?? {
      kind: "openai_key",
      longRetention: true,
      maxKeyLength: OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
    },
    compat: {
      api: "openai-responses",
      ...config.compat,
    },
  };
}

/**
 * Caller-gated OpenAI model discovery via official `GET /models`.
 * Never invoked by `createOpenAIProviderPackage` — hosts call this and pass
 * results via `models:` (or register themselves).
 * @see https://developers.openai.com/api/reference/resources/models/methods/list
 */
export async function listOpenAIModels(options: ListOpenAIModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "openai";
  const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`OpenAI model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as OpenAIModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("OpenAI model discovery response missing data array");
  return payload.data.map((entry) => mapOpenAIModel(entry, { provider }));
}

/**
 * Map a sparse official `/models` entry to Prism `ModelConfig`.
 * Official payload is id/created/owned_by only — capabilities/cache are heuristic.
 */
export function mapOpenAIModel(entry: OpenAIModelEntry, options: { readonly provider?: string } = {}): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("OpenAI model entry missing id");
  }
  const id = entry.id;
  const reasoning = looksLikeReasoningModel(id);
  const longRetention = supportsExtendedPromptCacheRetention(id);
  return defineOpenAIModel({
    provider: options.provider ?? "openai",
    model: id,
    displayName: id,
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
    },
    cache: {
      kind: "openai_key",
      longRetention,
      maxKeyLength: OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
    },
    compat: cleanJson({
      api: "openai-responses",
      openai: cleanJson({
        owned_by: entry.owned_by,
        created: entry.created,
      }),
    }),
  });
}

/** Featured offline bootstrap aliases only — refresh via `listOpenAIModels()`. */
export const openAIModels = [
  defineOpenAIModel({
    model: "gpt-5.1",
    displayName: "GPT-5.1",
    capabilities: {
      input: ["text", "image", "audio", "file", "document"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
    },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    cache: { kind: "openai_key", longRetention: true, maxKeyLength: OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH },
    compat: { api: "openai-responses" },
  }),
] as const satisfies readonly ModelConfig[];

/** Codex subscription featured aliases — not returned by `api.openai.com/v1/models`. */
export const openAICodexModels = [
  {
    provider: "openai-codex",
    model: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
    },
    limits: { contextWindow: 400_000, maxOutputTokens: 128_000 },
    compat: { api: "openai-codex-responses" },
  },
] as const satisfies readonly ModelConfig[];

/**
 * Models that accept `prompt_cache_retention: "24h"` (pre-GPT-5.6 families).
 * GPT-5.6+ uses `prompt_cache_options` / breakpoints instead — keep longRetention false there.
 * @see https://developers.openai.com/api/docs/guides/prompt-caching
 */
function supportsExtendedPromptCacheRetention(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes("gpt-5.6") || id.includes("gpt-5.7") || id.includes("gpt-5.8") || id.includes("gpt-5.9")) {
    return false;
  }
  return (
    id.includes("gpt-5.5")
    || id.includes("gpt-5.4")
    || id.includes("gpt-5.2")
    || id.includes("gpt-5.1")
    || id.includes("gpt-5")
    || id.includes("gpt-4.1")
  );
}

function looksLikeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("gpt-5") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4") || id.includes("codex");
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
