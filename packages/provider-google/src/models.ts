import {
  redactSecrets,
  resolveCredentialValue,
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
} from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

/** Official Gemini API base (`v1beta`). Vertex is out of scope for 0.0.12. */
export const GOOGLE_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GoogleModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "google" | string;
  readonly compat?: JsonObject & {
    /** Official `generationConfig.thinkingConfig` object or boolean enable. */
    readonly thinkingConfig?: boolean | JsonObject;
    /** Portable alias accepted as thinkingConfig.thinkingBudget. */
    readonly thinkingBudget?: number;
    /** Portable alias accepted as thinkingConfig.thinkingLevel. */
    readonly thinkingLevel?: string;
    /** Replay prior thinking/thought parts on the next turn. */
    readonly preserveThinking?: boolean;
  };
}

export interface ListGoogleModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to `https://generativelanguage.googleapis.com/v1beta`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
  /** Optional page size hint (`pageSize` query). */
  readonly pageSize?: number;
}

/** Sparse official `GET /v1beta/models` entry. */
export interface GoogleModelEntry {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
  readonly supportedGenerationMethods?: readonly string[];
  readonly version?: string;
}

interface GoogleModelsResponse {
  readonly models?: readonly GoogleModelEntry[];
  readonly nextPageToken?: string;
}

export function defineGoogleModel(config: GoogleModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "google",
    capabilities: {
      input: ["text", "image", "document", "file", "audio"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      ...config.capabilities,
    },
    compat: {
      preserveThinking: true,
      ...config.compat,
    },
  };
}

/**
 * Caller-gated Gemini model discovery via official `GET /v1beta/models`.
 * Never invoked by `createGoogleProviderPackage` — hosts call this and pass
 * results via `models:` (or register themselves).
 * @see https://ai.google.dev/api/models
 */
export async function listGoogleModels(options: ListGoogleModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "google";
  const baseUrl = (options.baseUrl ?? GOOGLE_DEFAULT_BASE_URL).replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const url = new URL(`${baseUrl}/models`);
  if (options.pageSize !== undefined) url.searchParams.set("pageSize", String(options.pageSize));
  const response = await (options.fetch ?? fetch)(url, {
    method: "GET",
    headers: {
      ...options.headers,
      ...(token ? { "x-goog-api-key": token } : {}),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Google model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as GoogleModelsResponse;
  if (!Array.isArray(payload.models)) throw new Error("Google model discovery response missing models array");
  return payload.models
    .filter((entry) => supportsGenerateContent(entry))
    .map((entry) => mapGoogleModel(entry, { provider }));
}

/**
 * Map a sparse official `/models` entry to Prism `ModelConfig`.
 * Capabilities/limits are heuristic when the payload omits them.
 */
export function mapGoogleModel(
  entry: GoogleModelEntry,
  options: { readonly provider?: string } = {},
): ModelConfig {
  if (!entry || typeof entry.name !== "string" || entry.name.length === 0) {
    throw new Error("Google model entry missing name");
  }
  const id = stripModelsPrefix(entry.name);
  if (!id) throw new Error("Google model entry missing name");
  return defineGoogleModel({
    provider: options.provider ?? "google",
    model: id,
    displayName: entry.displayName ?? id,
    limits: cleanLimits({
      contextWindow: entry.inputTokenLimit,
      maxOutputTokens: entry.outputTokenLimit,
    }),
    compat: cleanJson({
      preserveThinking: true,
      google: cleanJson({
        name: entry.name,
        version: entry.version,
        description: entry.description,
        supportedGenerationMethods: entry.supportedGenerationMethods,
      }),
    }),
  });
}

/** Featured offline bootstrap aliases — refresh via `listGoogleModels()`. */
export const googleModels = [
  defineGoogleModel({
    model: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
    compat: {
      preserveThinking: true,
      thinkingConfig: { includeThoughts: true },
    },
    cost: { input: 1.25, output: 10 },
  }),
  defineGoogleModel({
    model: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
    compat: {
      preserveThinking: true,
      thinkingConfig: { includeThoughts: true },
    },
    cost: { input: 0.3, output: 2.5 },
  }),
  defineGoogleModel({
    model: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
    compat: {
      preserveThinking: true,
    },
    cost: { input: 0.1, output: 0.4 },
  }),
  defineGoogleModel({
    model: "gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    limits: { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
    compat: {
      preserveThinking: true,
      thinkingConfig: { includeThoughts: true },
    },
    cost: { input: 0.3, output: 2.5 },
  }),
] as const satisfies readonly ModelConfig[];

export function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function supportsGenerateContent(entry: GoogleModelEntry): boolean {
  const methods = entry.supportedGenerationMethods;
  if (!methods || methods.length === 0) return true;
  return methods.includes("generateContent") || methods.includes("streamGenerateContent");
}

function cleanLimits(value: Record<string, unknown>): ModelConfig["limits"] | undefined {
  const entries = Object.entries(value).filter(([, item]) => typeof item === "number");
  return entries.length > 0 ? Object.fromEntries(entries) as ModelConfig["limits"] : undefined;
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
