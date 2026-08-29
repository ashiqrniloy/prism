import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";

/**
 * Ollama OpenAI-compatible deployment presets.
 * - `cloud`: Ollama Cloud (`https://ollama.com`), authenticated with an ollama.com API key.
 * - `local`: a local `ollama serve` instance (`http://localhost:11434`), typically unauthenticated.
 * @see https://docs.ollama.com/api/openai-compatibility
 */
export type OllamaBasePreset = "cloud" | "local";

const OLLAMA_BASE_URLS: Record<OllamaBasePreset, string> = {
  cloud: "https://ollama.com/v1",
  local: "http://localhost:11434/v1",
};

/** Default OpenAI-compatible base (Ollama Cloud). */
export const DEFAULT_OLLAMA_BASE_URL = OLLAMA_BASE_URLS.cloud;

/**
 * Resolve an OpenAI-compatible base URL (includes the `/v1` segment). An explicit
 * `baseUrl` wins; otherwise a named `preset` selects cloud or local. Chat completions
 * are `POST {base}/chat/completions`; discovery is `GET {base}/models`.
 */
export function ollamaBaseUrl(options: { readonly baseUrl?: string; readonly preset?: OllamaBasePreset } = {}): string {
  const base = options.baseUrl ?? OLLAMA_BASE_URLS[options.preset ?? "cloud"];
  return trimTrailingSlashes(base);
}

export interface OllamaModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "ollama";
  readonly compat?: JsonObject & {
    readonly route?: "openai";
    /** Reasoning effort (`reasoning_effort`); omitted on the wire unless set. */
    readonly reasoning_effort?: string;
  };
}

export interface ListOllamaModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `cloud`. */
  readonly preset?: OllamaBasePreset;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Official Ollama OpenAI-compatible `GET {base}/models` entry. `created` is the last
 * modified timestamp and `owned_by` is the publishing username or `library`.
 * @see https://docs.ollama.com/api/openai-compatibility
 */
export interface OllamaModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface OllamaModelsResponse {
  readonly object?: string;
  readonly data?: readonly OllamaModelEntry[];
}

export function defineOllamaModel(config: OllamaModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "ollama",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: looksLikeReasoningModel(config.model),
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
  };
}

/**
 * Caller-gated Ollama model discovery via the OpenAI-compatible `GET {base}/models`.
 * Never invoked by `createOllamaProviderPackage` — hosts call this and pass results via
 * `models:` (or register themselves). No hard-coded model catalog ships with the package:
 * available models vary by cloud account or local pull, so discovery is the source of
 * truth. (The native `GET {base}/api/tags` endpoint is an alternate catalog source;
 * Prism uses the OpenAI-compatible route for a uniform shape.)
 */
export async function listOllamaModels(options: ListOllamaModelsOptions = {}): Promise<ModelConfig[]> {
  const baseUrl = ollamaBaseUrl(options);
  const token = await resolveCredentialValue(options.apiKey, { provider: "ollama", name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Ollama model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = await readBoundedResponseJson<OllamaModelsResponse>(response);
  if (!Array.isArray(payload.data)) throw new Error("Ollama model discovery response missing data array");
  return payload.data.map((entry) => mapOllamaModel(entry));
}

/** Map an official Ollama `/v1/models` entry to a Prism `ModelConfig` (OpenAI route). */
export function mapOllamaModel(entry: OllamaModelEntry): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Ollama model entry missing id");
  }
  const id = entry.id;
  const vision = looksLikeVisionModel(id);
  return defineOllamaModel({
    model: id,
    displayName: id,
    capabilities: {
      input: vision ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning: looksLikeReasoningModel(id),
      tools: true,
      streaming: true,
    },
    compat: cleanJson({
      route: "openai",
      ollama: cleanJson({ owned_by: entry.owned_by, created: entry.created }),
    }),
  });
}

function looksLikeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("gpt-oss") ||
    id.includes("deepseek-r1") ||
    id.startsWith("qwq") ||
    id.startsWith("qvq") ||
    id.includes("-thinking") ||
    id.includes("reasoning")
  );
}

function looksLikeVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("llava") ||
    id.includes("bakllava") ||
    id.includes("moondream") ||
    id.includes("minicpm-v") ||
    id.includes("llama-vision") ||
    id.includes("llama3.2-vision") ||
    id.includes("-vl") ||
    id.includes("vision")
  );
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
