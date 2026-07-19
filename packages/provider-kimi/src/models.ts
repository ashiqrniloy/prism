import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface KimiModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "kimi-coding" | "moonshot";
  readonly compat?: JsonObject & {
    readonly route?: "anthropic" | "openai";
    readonly preserveThinking?: boolean;
    /** Official K2.x `thinking` object (`type`, optional `keep`). */
    readonly thinking?: boolean | JsonObject;
    /** Official K3 `reasoning_effort` (`"max"` on Open Platform; Coding `k3` also `low`/`high`). */
    readonly reasoning_effort?: string;
  };
}

export interface ListKimiModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to Open Platform `https://api.moonshot.ai/v1` (also supports `api.moonshot.cn/v1`). */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  /** Defaults to `"moonshot"`. */
  readonly provider?: "moonshot" | string;
}

/**
 * Official Moonshot / Kimi Open Platform `GET /v1/models` entry.
 * @see https://platform.kimi.ai/docs/api/list-models
 */
export interface KimiModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
  readonly context_length?: number;
  readonly supports_image_in?: boolean;
  readonly supports_video_in?: boolean;
  readonly supports_reasoning?: boolean;
}

interface KimiModelsResponse {
  readonly object?: string;
  readonly data?: readonly KimiModelEntry[];
}

export function defineKimiModel(config: KimiModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "kimi-coding",
    capabilities: {
      input: ["text"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
  };
}

/**
 * Caller-gated Moonshot Open Platform model discovery via official `GET /v1/models`.
 * Never invoked by `createKimiProviderPackage` — hosts call this and pass results via
 * `moonshotModels:` / `models:` (or register themselves).
 * Kimi For Coding (`api.kimi.com/coding`) has no public list API; use featured
 * `kimiCodingModels` (official Coding ids) as offline bootstrap.
 * @see https://platform.kimi.ai/docs/api/list-models
 */
export async function listKimiModels(options: ListKimiModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "moonshot";
  const baseUrl = (options.baseUrl ?? "https://api.moonshot.ai/v1").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Kimi model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as KimiModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("Kimi model discovery response missing data array");
  return payload.data.map((entry) => mapKimiModel(entry, { provider }));
}

/**
 * Map an official Moonshot `/v1/models` entry to Prism `ModelConfig`.
 * Open Platform models use Chat Completions (`compat.route: "openai"`).
 */
export function mapKimiModel(
  entry: KimiModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Kimi model entry missing id");
  }
  const id = entry.id;
  const reasoning = entry.supports_reasoning === true || looksLikeReasoningModel(id);
  const input: Array<"text" | "image"> = entry.supports_image_in ? ["text", "image"] : ["text"];
  return defineKimiModel({
    provider: (options.provider as "moonshot" | "kimi-coding" | undefined) ?? "moonshot",
    model: id,
    displayName: id,
    capabilities: {
      input,
      output: ["text"],
      reasoning,
      tools: true,
      streaming: true,
    },
    limits: cleanLimits({
      contextWindow: typeof entry.context_length === "number" ? entry.context_length : undefined,
    }),
    compat: cleanJson({
      route: "openai",
      preserveThinking: reasoning && shouldPreserveThinkingByDefault(id),
      ...thinkingDefaultsForModel(id),
      moonshot: cleanJson({
        owned_by: entry.owned_by,
        created: entry.created,
        supports_video_in: entry.supports_video_in,
        supports_reasoning: entry.supports_reasoning,
      }),
    }),
  });
}

/**
 * Featured Kimi For Coding offline bootstrap aliases — official Coding model ids
 * from https://www.kimi.com/code/docs/en/kimi-code/models (not Pi's `k2p7` alias).
 * Refresh Open Platform catalogs via `listKimiModels()`.
 */
export const kimiCodingModels = [
  defineKimiModel({
    provider: "kimi-coding",
    model: "kimi-for-coding",
    displayName: "Kimi For Coding (K2.7 Code)",
    capabilities: { input: ["text", "document", "file"] },
    limits: { contextWindow: 256_000, maxOutputTokens: 64_000 },
    compat: {
      route: "anthropic",
      // Official: thinking always on — omit `thinking` on the wire unless the host sets it.
      preserveThinking: true,
    },
  }),
  defineKimiModel({
    provider: "kimi-coding",
    model: "kimi-for-coding-highspeed",
    displayName: "Kimi For Coding Highspeed",
    capabilities: { input: ["text", "document", "file"] },
    limits: { contextWindow: 256_000, maxOutputTokens: 64_000 },
    compat: {
      route: "anthropic",
      preserveThinking: true,
    },
  }),
  defineKimiModel({
    provider: "kimi-coding",
    model: "k3",
    displayName: "Kimi K3 (Coding)",
    capabilities: { input: ["text", "image", "document", "file"] },
    limits: { contextWindow: 1_048_576, maxOutputTokens: 64_000 },
    compat: {
      route: "anthropic",
      preserveThinking: true,
      // Coding docs: low / high / max (default max).
      reasoning_effort: "max",
    },
  }),
] as const satisfies readonly ModelConfig[];

/**
 * Featured Moonshot Open Platform offline bootstrap aliases — official Open Platform
 * ids from https://platform.kimi.ai/docs/models. Callable via `createMoonshotProvider`
 * when `includeMoonshotModels: true`. Refresh via `listKimiModels()`.
 */
export const moonshotKimiModels = [
  defineKimiModel({
    provider: "moonshot",
    model: "kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    capabilities: { input: ["text"] },
    limits: { contextWindow: 256_000, maxOutputTokens: 64_000 },
    compat: {
      route: "openai",
      // Official: omit `thinking` for K2.7-code; Preserved Thinking still required on replay.
      preserveThinking: true,
    },
  }),
  defineKimiModel({
    provider: "moonshot",
    model: "kimi-k3",
    displayName: "Kimi K3",
    capabilities: { input: ["text", "image"] },
    limits: { contextWindow: 1_048_576, maxOutputTokens: 64_000 },
    compat: {
      route: "openai",
      preserveThinking: true,
      // Open Platform currently documents only `"max"`.
      reasoning_effort: "max",
    },
  }),
] as const satisfies readonly ModelConfig[];

function looksLikeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes("kimi-k3")
    || id === "k3"
    || id.includes("k2.7")
    || id.includes("k2.6")
    || id.includes("k2.5")
    || id.includes("thinking")
    || id.includes("for-coding")
  );
}

function shouldPreserveThinkingByDefault(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // Official: K2.7-code / Coding always preserve; K3 requires historical reasoning_content.
  return id.includes("k2.7") || id.includes("for-coding") || id.includes("kimi-k3") || id === "k3";
}

function thinkingDefaultsForModel(modelId: string): JsonObject {
  const id = modelId.toLowerCase();
  if (id.includes("kimi-k3") || id === "k3") {
    return { reasoning_effort: "max" };
  }
  // Official: K2.7-code thinking is always on — omit the parameter unless the host sets it.
  if (id.includes("k2.6") || id.includes("k2.5")) {
    return { thinking: { type: "enabled" } };
  }
  return {};
}

function cleanLimits(value: { contextWindow?: number; maxOutputTokens?: number }): ModelConfig["limits"] | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) as ModelConfig["limits"] : undefined;
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
