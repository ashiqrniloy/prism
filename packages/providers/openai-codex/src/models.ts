import {
  type CredentialValueSource,
  type JsonObject,
  type ModelConfig,
  redactSecrets,
  resolveCredentialValue,
  trimTrailingSlashes,
} from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText, THINKING_LEVELS } from "@arnilo/prism/provider-kit";
import { type OpenAICodexCredentialSlot, openAICodexApiKey } from "./oauth.js";

/** The base a Sign in with ChatGPT grant is scoped to (`POST /responses`, `GET /models`). */
export const OPENAI_CODEX_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** The route key this provider registers; `compat.route` may name it explicitly. */
export const OPENAI_CODEX_ROUTE = "responses";

export interface OpenAICodexModelConfig extends Omit<ModelConfig, "provider" | "compat"> {
  readonly provider?: "openai-codex";
  readonly compat?: JsonObject & {
    /** Route selector; the package has one route, so this is only ever `"responses"`. */
    readonly route?: string;
    /** `reasoning.summary` for this model; `"auto"` is what the live probes sent. */
    readonly reasoning?: JsonObject;
  };
}

/** Measured `GET /models` response size on 2026-10-25 was 567 675 bytes. */
export const OPENAI_CODEX_MODELS_MAX_BODY_BYTES = 2_000_000;

export interface ListOpenAICodexModelsOptions {
  readonly apiKey?: CredentialValueSource;
  /** A writable `keyring:` ref holding the grant; used with {@link credentialSource} when no `apiKey` is given. */
  readonly credential?: string;
  /** The slot {@link credential} is read from and rotated into. */
  readonly credentialSource?: OpenAICodexCredentialSlot;
  readonly fetch?: typeof fetch;
  /** Defaults to {@link OPENAI_CODEX_DEFAULT_BASE_URL}. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly provider?: string;
}

/**
 * One `GET /models` entry, as measured on a sign-in grant (plan 204 Task 5): the payload nests the
 * catalog under `models` and carries capability fields on every entry.
 */
export interface OpenAICodexModelEntry {
  readonly slug: string;
  readonly display_name?: string;
  readonly description?: string;
  /** `list` is the catalog; `hide` entries exist but are not offered. */
  readonly visibility?: string;
  /** The window a request is planned against. */
  readonly context_window?: number;
  /** The largest window the model can be asked for. */
  readonly max_context_window?: number;
  /** Absent or `null` on every measured entry, so it never becomes `limits.maxOutputTokens`. */
  readonly auto_compact_token_limit?: number | null;
  readonly input_modalities?: readonly string[];
  readonly supported_reasoning_levels?: readonly (string | { readonly effort?: string })[];
  readonly default_reasoning_level?: string;
  readonly supported_in_api?: boolean;
  readonly supports_parallel_tool_calls?: boolean;
  readonly supports_reasoning_summary_parameter?: boolean;
}

interface OpenAICodexModelsResponse {
  readonly models?: readonly OpenAICodexModelEntry[];
  /** The OpenAI-shaped envelope, accepted so a future rename does not empty the catalog. */
  readonly data?: readonly OpenAICodexModelEntry[];
}

/**
 * Reasoning levels a slug accepts, in `THINKING_LEVELS` order. The catalog reports efforts
 * (`low`…`max`, and `ultra` on some slugs); anything outside the kernel's levels is dropped, because
 * a level the kernel cannot name cannot be requested.
 */
export function openAICodexThinkingLevels(
  levels: readonly (string | { readonly effort?: string })[] | undefined,
): readonly string[] | undefined {
  if (!levels || levels.length === 0) return undefined;
  const efforts = new Set(levels.map((level) => (typeof level === "string" ? level : level.effort)));
  const kept = THINKING_LEVELS.filter((level) => efforts.has(level));
  return kept.length > 0 ? kept : undefined;
}

function inputModalities(entry: OpenAICodexModelEntry): readonly string[] {
  const measured = entry.input_modalities?.filter((value) => value === "text" || value === "image") ?? [];
  return measured.length > 0 ? measured : ["text"];
}

/** Maps one discovery entry to a `ModelConfig`; unknown facts stay undefined rather than guessed. */
export function mapOpenAICodexModel(entry: OpenAICodexModelEntry, provider = "openai-codex"): ModelConfig {
  const thinkingLevels = openAICodexThinkingLevels(entry.supported_reasoning_levels);
  return {
    provider,
    model: entry.slug,
    ...((entry.display_name ?? entry.description) ? { displayName: entry.display_name ?? entry.description } : {}),
    capabilities: {
      input: inputModalities(entry),
      output: ["text"],
      reasoning: thinkingLevels !== undefined,
      tools: entry.supports_parallel_tool_calls !== false,
      streaming: true,
      structuredOutput: "json_schema",
      ...(thinkingLevels ? { thinkingLevels } : {}),
    },
    limits: {
      ...(typeof entry.context_window === "number" && entry.context_window > 0 ? { contextWindow: entry.context_window } : {}),
      ...(typeof entry.auto_compact_token_limit === "number" && entry.auto_compact_token_limit > 0
        ? { maxOutputTokens: entry.auto_compact_token_limit }
        : {}),
    },
    cache: { kind: "openai_key", maxKeyLength: 64 },
    compat: {
      route: OPENAI_CODEX_ROUTE,
      ...(entry.supports_reasoning_summary_parameter === false ? {} : { reasoning: { summary: "auto" } }),
    },
  };
}

/** The catalog shape this package publishes: a literal, so `define`d entries keep their types. */
export function defineOpenAICodexModel(config: OpenAICodexModelConfig): ModelConfig {
  return {
    ...config,
    provider: "openai-codex",
    compat: { route: OPENAI_CODEX_ROUTE, ...config.compat },
  };
}

/**
 * The static catalog: the two slugs plan 204 Task 1 (e) exercised end to end. Windows are the
 * `context_window` the grant's own `GET /models` reported for each slug (500 000 for `gpt-6.1-sol`,
 * 272 000 for `gpt-6-luna`), which the 400 007-token probe corroborated for `gpt-6.1-sol`.
 * `limits.maxOutputTokens` is deliberately absent: the route accepts any `max_output_tokens` from 16
 * up and the catalog reports `auto_compact_token_limit: null`, so there is no ceiling to declare.
 */
export const openAICodexModels: readonly ModelConfig[] = [
  defineOpenAICodexModel({
    model: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    capabilities: {
      input: ["text", "image"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      // `ultra` is a catalog effort the kernel's THINKING_LEVELS cannot name, so it is not offered.
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    limits: { contextWindow: 500_000 },
    cache: { kind: "openai_key", maxKeyLength: 64 },
    compat: { route: OPENAI_CODEX_ROUTE, reasoning: { summary: "auto" } },
  }),
  defineOpenAICodexModel({
    model: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    capabilities: {
      input: ["text", "image"],
      output: ["text"],
      reasoning: true,
      tools: true,
      streaming: true,
      structuredOutput: "json_schema",
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    limits: { contextWindow: 272_000 },
    cache: { kind: "openai_key", maxKeyLength: 64 },
    compat: { route: OPENAI_CODEX_ROUTE, reasoning: { summary: "auto" } },
  }),
];

/**
 * Asks `GET /models` with the current grant and keeps the entries the catalog lists. One request,
 * never on a timer, and only when a caller asks for the catalog.
 */
export async function listOpenAICodexModels(options: ListOpenAICodexModelsOptions = {}): Promise<readonly ModelConfig[]> {
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? OPENAI_CODEX_DEFAULT_BASE_URL);
  const source =
    options.apiKey ??
    (options.credential
      ? openAICodexApiKey({
          credential: options.credential,
          ...(options.credentialSource ? { slot: options.credentialSource } : {}),
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(options.fetch ? { fetch: options.fetch } : {}),
        })
      : undefined);
  const apiKey = await resolveCredentialValue(source, { provider: options.provider ?? "openai-codex", name: "apiKey" });
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, { method: "GET", headers, signal: options.signal });
  const secrets = [apiKey];
  if (!response.ok) {
    const bodyText = await readBoundedResponseText(response, { secrets });
    throw new Error(redactSecrets(`openai-codex model discovery failed: ${response.status} ${bodyText}`, secrets));
  }
  // The catalog carries per-model instruction text: 567 675 bytes on 2026-10-25, well over the
  // transport's 64 KiB default. The cap stays explicit so a runaway response still fails.
  const payload = await readBoundedResponseJson<OpenAICodexModelsResponse | undefined>(response, {
    secrets,
    maxResponseBodyBytes: OPENAI_CODEX_MODELS_MAX_BODY_BYTES,
  });
  const entries = payload?.models ?? payload?.data ?? [];
  const provider = options.provider ?? "openai-codex";
  return entries
    .filter((entry) => typeof entry?.slug === "string" && entry.slug.length > 0)
    .filter((entry) => entry.visibility === "list")
    .map((entry) => mapOpenAICodexModel(entry, provider));
}
