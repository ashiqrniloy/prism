import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type JsonValue,
  type ModelConfig,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface ZaiModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "zai";
  readonly compat?: JsonObject & {
    /** Official deep-thinking switch (`boolean` or `{ type, clear_thinking? }`). */
    readonly thinking?: boolean | JsonObject;
    /** Official GLM-5.2+ effort: max | xhigh | high | medium | low | minimal | none. */
    readonly reasoning_effort?: string;
    /** Official GLM-4.6+ streaming tool-call arguments. */
    readonly tool_stream?: boolean;
    /** Official nested `thinking.clear_thinking` (also accepted at compat root). */
    readonly clear_thinking?: boolean;
    /** Prism-local: replay prior thinking as `reasoning_content` when not clearing. */
    readonly preserveThinking?: boolean;
  };
}

export interface ListZaiModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official international `https://api.z.ai/api/paas/v4`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * Sparse OpenAI-compatible `/models` entry. Z.AI does not publish a first-class
 * list-models API page; this helper follows the OpenAI-compatible convention
 * used by the Chat Completions base (`GET {baseUrl}/models`). Prefer featured
 * `zaiModels` (docs-verified) when discovery is unavailable.
 * @see https://docs.z.ai/api-reference/llm/chat-completion
 * @see https://docs.z.ai/guides/overview/overview
 */
export interface ZaiModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface ZaiModelsResponse {
  readonly object?: string;
  readonly data?: readonly ZaiModelEntry[];
}

export function defineZaiModel(config: ZaiModelConfig): ModelConfig {
  return {
    ...config,
    provider: "zai",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      ...config.capabilities,
    },
    cache: config.cache ?? { kind: "implicit" },
  };
}

/**
 * Caller-gated Z.AI model discovery via OpenAI-compatible `GET /models`.
 * Never invoked by `createZaiProviderPackage` — hosts call this and pass results
 * via `models:` (or register themselves). Official docs list model codes on the
 * Chat Completions page / overview; use featured `zaiModels` as offline bootstrap.
 */
export async function listZaiModels(options: ListZaiModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "zai";
  const baseUrl = (options.baseUrl ?? "https://api.z.ai/api/paas/v4").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Z.AI model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as ZaiModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("Z.AI model discovery response missing data array");
  return payload.data.map((entry) => mapZaiModel(entry, { provider }));
}

/**
 * Map a sparse OpenAI-compatible `/models` entry to Prism `ModelConfig`.
 * Limits / thinking defaults are inferred from official Chat Completions model codes.
 */
export function mapZaiModel(
  entry: ZaiModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Z.AI model entry missing id");
  }
  const id = entry.id;
  const limits = limitsForZaiModel(id);
  const reasoning = looksLikeReasoningModel(id);
  return defineZaiModel({
    provider: (options.provider as "zai" | undefined) ?? "zai",
    model: id,
    displayName: id,
    capabilities: {
      input: looksLikeVisionModel(id) ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
    },
    limits,
    cache: { kind: "implicit" },
    compat: cleanJson({
      ...thinkingDefaultsForModel(id),
      zai: cleanJson({
        owned_by: entry.owned_by,
        created: entry.created,
      }),
    }),
  });
}

/**
 * Featured offline bootstrap aliases — official Chat Completions model codes from
 * https://docs.z.ai/api-reference/llm/chat-completion and overview context sizes.
 * Refresh live ids via `listZaiModels()` when the OpenAI-compatible list endpoint
 * is available to the account.
 */
export const zaiModels = [
  defineZaiModel({
    model: "glm-5.2",
    displayName: "GLM-5.2",
    limits: { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true, reasoning_effort: "max", tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-5.1",
    displayName: "GLM-5.1",
    limits: { contextWindow: 200_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true, tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-5",
    displayName: "GLM-5",
    limits: { contextWindow: 200_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true, tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-5-turbo",
    displayName: "GLM-5-Turbo",
    limits: { contextWindow: 200_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true, tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-4.7",
    displayName: "GLM-4.7",
    limits: { contextWindow: 200_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    // Official: GLM-4.7 forced thinking when enabled; tool_stream supported (4.6+).
    compat: { thinking: true, tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-4.6",
    displayName: "GLM-4.6",
    limits: { contextWindow: 200_000, maxOutputTokens: 128_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true, tool_stream: true },
  }),
  defineZaiModel({
    model: "glm-4.5",
    displayName: "GLM-4.5",
    limits: { contextWindow: 128_000, maxOutputTokens: 96_000 },
    cache: { kind: "implicit" },
    compat: { thinking: true },
  }),
] as const satisfies readonly ModelConfig[];

function thinkingDefaultsForModel(modelId: string): JsonObject {
  const id = modelId.toLowerCase();
  if (!looksLikeReasoningModel(id)) return {};
  const compat: Record<string, JsonValue> = { thinking: true };
  if (supportsToolStream(id)) compat.tool_stream = true;
  // Official: reasoning_effort only for GLM-5.2+.
  if (supportsReasoningEffort(id)) compat.reasoning_effort = "max";
  return compat;
}

function limitsForZaiModel(modelId: string): ModelConfig["limits"] | undefined {
  const id = modelId.toLowerCase();
  if (id.includes("glm-5.2") || id.includes("glm-5-2")) {
    return { contextWindow: 1_000_000, maxOutputTokens: 128_000 };
  }
  if (id.includes("glm-5") || id.includes("glm-4.7") || id.includes("glm-4.6")) {
    return { contextWindow: 200_000, maxOutputTokens: 128_000 };
  }
  if (id.includes("glm-4.5v")) {
    return { contextWindow: 64_000, maxOutputTokens: 16_000 };
  }
  if (id.includes("glm-4.5")) {
    return { contextWindow: 128_000, maxOutputTokens: 96_000 };
  }
  if (id.includes("glm-4-32b") || id.includes("128k")) {
    return { contextWindow: 128_000, maxOutputTokens: 16_000 };
  }
  return undefined;
}

function looksLikeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("glm-5")
    || id.includes("glm-4.7")
    || id.includes("glm-4.6")
    || id.includes("glm-4.5")
  );
}

function looksLikeVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("glm-5v") || id.includes("glm-4.6v") || id.includes("glm-4.5v") || id.endsWith("v");
}

function supportsToolStream(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // Official: tool_stream supported by GLM-4.6 and above.
  return id.includes("glm-5") || id.includes("glm-4.7") || id.includes("glm-4.6");
}

function supportsReasoningEffort(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("glm-5.2") || id.includes("glm-5-2");
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
