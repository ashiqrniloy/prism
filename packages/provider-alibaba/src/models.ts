import { type CredentialValueSource, type JsonObject, type ModelConfig, redactSecrets, resolveCredentialValue } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

/**
 * Alibaba Cloud Model Studio / DashScope OpenAI-compatible deployment presets.
 * The API key is region/plan-scoped: it must match the base URL's billing plan.
 * @see https://www.alibabacloud.com/help/en/model-studio/base-url
 */
export type AlibabaBasePreset =
  | "singapore" // dashscope-intl (international, default)
  | "beijing" // dashscope (China Beijing)
  | "us" // dashscope-us (US)
  | "coding-plan"; // Coding Plan subscription (separate key)

const ALIBABA_BASE_URLS: Record<AlibabaBasePreset, string> = {
  singapore: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  beijing: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  us: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  "coding-plan": "https://coding-intl.dashscope.aliyuncs.com/v1",
};

/** Default OpenAI-compatible base (Singapore international endpoint). */
export const DEFAULT_ALIBABA_BASE_URL = ALIBABA_BASE_URLS.singapore;

/**
 * Resolve an OpenAI-compatible base URL. An explicit `baseUrl` wins; otherwise a
 * named `preset` selects a documented deployment. Workspace-dedicated endpoints
 * (`https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1`) are
 * supplied verbatim via `baseUrl`.
 */
export function alibabaBaseUrl(options: { readonly baseUrl?: string; readonly preset?: AlibabaBasePreset } = {}): string {
  const base = options.baseUrl ?? ALIBABA_BASE_URLS[options.preset ?? "singapore"];
  return base.replace(/\/$/, "");
}

export interface AlibabaModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "alibaba";
  readonly compat?: JsonObject & {
    readonly route?: "openai";
    /** Qwen thinking toggle (`enable_thinking`); omitted on the wire unless set. */
    readonly enable_thinking?: boolean;
  };
}

export interface ListAlibabaModelsOptions {
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Explicit OpenAI-compatible base URL (wins over `preset`). */
  readonly baseUrl?: string;
  /** Named deployment preset; defaults to `singapore`. */
  readonly preset?: AlibabaBasePreset;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Official DashScope OpenAI-compatible `GET {base}/models` entry.
 * @see https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
 */
export interface AlibabaModelEntry {
  readonly id: string;
  readonly object?: string;
  readonly created?: number;
  readonly owned_by?: string;
}

interface AlibabaModelsResponse {
  readonly object?: string;
  readonly data?: readonly AlibabaModelEntry[];
}

export function defineAlibabaModel(config: AlibabaModelConfig): ModelConfig {
  return {
    ...config,
    provider: config.provider ?? "alibaba",
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
 * Caller-gated DashScope model discovery via the OpenAI-compatible `GET {base}/models`.
 * Never invoked by `createAlibabaProviderPackage` — hosts call this and pass results
 * via `models:` (or register themselves). No hard-coded model catalog ships with the
 * package: available models vary by region/workspace/plan, so discovery is the source
 * of truth.
 */
export async function listAlibabaModels(options: ListAlibabaModelsOptions = {}): Promise<ModelConfig[]> {
  const baseUrl = alibabaBaseUrl(options);
  const token = await resolveCredentialValue(options.apiKey, { provider: "alibaba", name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
    method: "GET",
    headers: { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await readBoundedResponseText(response, { secrets: [token] });
    throw new Error(`Alibaba model discovery failed: ${response.status} ${redactSecrets(body, [token])}`);
  }
  const payload = (await response.json()) as AlibabaModelsResponse;
  if (!Array.isArray(payload.data)) throw new Error("Alibaba model discovery response missing data array");
  return payload.data.map((entry) => mapAlibabaModel(entry));
}

/** Map an official DashScope `/models` entry to a Prism `ModelConfig` (OpenAI route). */
export function mapAlibabaModel(entry: AlibabaModelEntry): ModelConfig {
  if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
    throw new Error("Alibaba model entry missing id");
  }
  const id = entry.id;
  const reasoning = looksLikeReasoningModel(id);
  const vision = looksLikeVisionModel(id);
  return defineAlibabaModel({
    model: id,
    displayName: id,
    capabilities: {
      input: vision ? ["text", "image"] : ["text"],
      output: ["text"],
      reasoning,
      tools: true,
      streaming: true,
    },
    compat: cleanJson({
      route: "openai",
      // Qwen thinking is off by default on the wire; hosts opt in per request/model.
      enable_thinking: reasoning ? false : undefined,
      alibaba: cleanJson({ owned_by: entry.owned_by, created: entry.created }),
    }),
  });
}

function looksLikeReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith("qwq") || id.startsWith("qvq") || id.includes("qwen3") || id.includes("-thinking") || id.includes("reasoning");
}

function looksLikeVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith("qvq") || id.includes("-vl") || id.includes("qwen-vl") || id.includes("vision");
}

function cleanJson(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}
