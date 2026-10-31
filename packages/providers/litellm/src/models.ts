import {
  type CredentialValueSource,
  type ModelCapabilities,
  type ModelConfig,
  type ModelCost,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/provider-kit";

/** A host-run LiteLLM Proxy answers on loopback by default (`litellm --port 4000`). */
export const LITELLM_DEFAULT_BASE_URL = "http://127.0.0.1:4000";

/** `/model/info` describes every deployment; large mixed configs exceed a completion body cap. */
const LITELLM_CATALOG_BYTES = 4_194_304;

export interface LiteLLMModelInfoEntry {
  readonly model_name?: string;
  readonly model_id?: string;
  readonly model_info?: {
    readonly id?: string;
    readonly mode?: string | null;
    readonly max_input_tokens?: number | null;
    readonly max_output_tokens?: number | null;
    readonly input_cost_per_token?: number | null;
    readonly output_cost_per_token?: number | null;
    readonly cache_read_input_token_cost?: number | null;
    readonly cache_creation_input_token_cost?: number | null;
    readonly supports_function_calling?: boolean | null;
    readonly supports_vision?: boolean | null;
    readonly supports_reasoning?: boolean | null;
    readonly supports_response_schema?: boolean | null;
    readonly litellm_provider?: string | null;
  };
  readonly litellm_params?: { readonly model?: string; readonly [key: string]: unknown };
}

export interface ListLiteLLMModelsOptions {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly apiKey?: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function rate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value * 1_000_000 : undefined;
}

function minimum(values: readonly (number | null | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? Math.min(...known) : undefined;
}

function maximum(values: readonly (number | null | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? Math.max(...known) : undefined;
}

/** True only when every deployment says yes; a null/absent flag is not a claim. */
function all(members: readonly LiteLLMModelInfoEntry[], read: (info: NonNullable<LiteLLMModelInfoEntry["model_info"]>) => unknown): boolean {
  return members.every((member) => read(member.model_info ?? {}) === true);
}

/**
 * Groups `/model/info` rows by `model_name` into one conservative `ModelConfig` per group
 * (plan 214 Task 1 (d) and Task 2): a load-balanced call can land on any deployment, so the group
 * advertises the smallest window and only the capabilities every deployment supports.
 */
export function groupLiteLLMModelInfo(
  entries: readonly LiteLLMModelInfoEntry[],
  options: { readonly provider?: string } = {},
): ModelConfig[] {
  const provider = options.provider ?? "litellm";
  const groups = new Map<string, LiteLLMModelInfoEntry[]>();
  for (const entry of entries) {
    const name = typeof entry.model_name === "string" ? entry.model_name.trim() : "";
    // `*` is the proxy's catch-all fallback group: it names no model and cannot be discovered as one.
    if (!name || name === "*") continue;
    const rows = groups.get(name);
    if (rows) rows.push(entry);
    else groups.set(name, [entry]);
  }

  const models: ModelConfig[] = [];
  for (const [name, members] of groups) {
    // Only chat deployments are served by this package's one route; embedding/rerank/image groups are skipped.
    const chat = members.filter((member) => member.model_info?.mode == null || member.model_info.mode === "chat");
    if (chat.length === 0) continue;
    const infos = chat.map((member) => member.model_info ?? {});
    const cost: ModelCost = {
      currency: "USD",
      ...(rate(maximum(infos.map((info) => info.input_cost_per_token))) !== undefined
        ? { input: rate(maximum(infos.map((info) => info.input_cost_per_token))) }
        : {}),
      ...(rate(maximum(infos.map((info) => info.output_cost_per_token))) !== undefined
        ? { output: rate(maximum(infos.map((info) => info.output_cost_per_token))) }
        : {}),
      ...(rate(maximum(infos.map((info) => info.cache_read_input_token_cost))) !== undefined
        ? { cacheRead: rate(maximum(infos.map((info) => info.cache_read_input_token_cost))) }
        : {}),
      ...(rate(maximum(infos.map((info) => info.cache_creation_input_token_cost))) !== undefined
        ? { cacheWrite: rate(maximum(infos.map((info) => info.cache_creation_input_token_cost))) }
        : {}),
    };
    const capabilities: ModelCapabilities = {
      input: all(chat, (info) => info.supports_vision) ? ["text", "image"] : ["text"],
      output: ["text"],
      tools: all(chat, (info) => info.supports_function_calling),
      reasoning: all(chat, (info) => info.supports_reasoning),
      structuredOutput: all(chat, (info) => info.supports_response_schema) ? "json_schema" : false,
      streaming: true,
    };
    const providers = [
      ...new Set(chat.map((member) => member.model_info?.litellm_provider).filter((value): value is string => typeof value === "string" && value !== "")),
    ].sort();
    models.push({
      provider,
      model: name,
      displayName: name,
      capabilities,
      limits: {
        contextWindow: minimum(infos.map((info) => positive(info.max_input_tokens))),
        maxOutputTokens: minimum(infos.map((info) => positive(info.max_output_tokens))),
      },
      ...(Object.keys(cost).length > 1 ? { cost } : {}),
      cache: { kind: "implicit" },
      compat: { deployments: chat.length, litellmProviders: providers },
    });
  }
  return models.sort((a, b) => a.model.localeCompare(b.model));
}

async function discover(
  options: ListLiteLLMModelsOptions,
  path: string,
): Promise<{ response: Response; token: string | undefined }> {
  const provider = options.provider ?? "litellm";
  const token = await resolveCredentialValue(options.apiKey, { provider, name: "apiKey" });
  const response = await (options.fetch ?? fetch)(`${trimTrailingSlashes(options.baseUrl ?? LITELLM_DEFAULT_BASE_URL)}${path}`, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return { response, token };
}

/**
 * Reads `/model/info` once (fewer than ten requests per discovery: one). A key that may not read
 * deployment details falls back to `/v1/models`, which returns ids only, so no capability is claimed.
 */
export async function listLiteLLMModels(options: ListLiteLLMModelsOptions = {}): Promise<ModelConfig[]> {
  const provider = options.provider ?? "litellm";
  const { response, token } = await discover(options, "/model/info");
  if (response.ok) {
    const payload = await readBoundedResponseJson<{ data?: LiteLLMModelInfoEntry[] }>(response, {
      maxResponseBodyBytes: LITELLM_CATALOG_BYTES,
    });
    if (!Array.isArray(payload.data)) throw new Error("LiteLLM model discovery response missing data array");
    return groupLiteLLMModelInfo(payload.data, { provider });
  }
  const detail = await readBoundedResponseText(response, { secrets: [token] });
  if (response.status !== 403 && response.status !== 401) {
    throw new Error(`LiteLLM model discovery failed: ${response.status} ${redactSecrets(detail, [token])}`);
  }
  const fallback = await discover(options, "/v1/models");
  if (!fallback.response.ok) {
    const body = await readBoundedResponseText(fallback.response, { secrets: [fallback.token] });
    throw new Error(`LiteLLM model discovery failed: ${fallback.response.status} ${redactSecrets(body, [fallback.token])}`);
  }
  const payload = await readBoundedResponseJson<{ data?: readonly { id?: string }[] }>(fallback.response, {
    maxResponseBodyBytes: LITELLM_CATALOG_BYTES,
  });
  if (!Array.isArray(payload.data)) throw new Error("LiteLLM model discovery response missing data array");
  return payload.data
    .map((entry) => (typeof entry.id === "string" ? entry.id.trim() : ""))
    .filter((id) => id !== "" && id !== "*")
    .map((id) => ({ provider, model: id, displayName: id, capabilities: { streaming: true } }))
    .sort((a, b) => a.model.localeCompare(b.model));
}
