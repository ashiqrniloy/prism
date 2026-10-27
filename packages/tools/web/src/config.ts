import type { JsonObject, JsonSchema, ModelRef } from "@arnilo/prism";

import type { ToolsWebDomainsConfig } from "./domains.js";

import type { ObscuraWebLimits } from "./obscura/limits.js";
import type { WebLimits } from "./types.js";

/** The search/fetch backend the package operates as. `native` is fetch-only and needs no key. */
export type ToolsWebBackend =
  | "brave"
  | "exa"
  | "firecrawl"
  | "native"
  | "obscura"
  | "searxng"
  | "tavily"
  | "kagi";

/** The optional second backend used for `web_fetch` when the search backend cannot fetch. */
export interface ToolsWebFetchConfig {
  /** `"native"` (default, keyless), `"firecrawl"`, or `"off"` to register no fetch tool. */
  readonly backend?: "native" | "firecrawl" | "off";
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. Required when `backend` is `"firecrawl"`. */
  readonly apiKey?: string;
  /** Replaces the native backend's `user-agent`; it still identifies Prism unless a host opts out. */
  readonly userAgent?: string;
  /** Adds the `prompt` argument: one model call answers a question from the fetched page. */
  readonly prompt?: ToolsWebPromptConfig;
}

/** Opt-in `web_fetch` question answering: the host picks the model, the model only asks the question. */
export interface ToolsWebPromptConfig {
  /** The model that reads the page; resolved once at setup. */
  readonly model: ModelRef;
  /** Characters of page Markdown sent to it. Default 100 000. */
  readonly maxInputChars?: number;
  /** Output token budget for the answer. Default 1 024. */
  readonly maxOutputTokens?: number;
}

/** Obscura backend settings. `obscura` needs no key. */
export interface ToolsWebObscuraConfig {
  /** Absolute path or a bare name resolved on `PATH`. Default `"obscura"`. */
  readonly binary?: string;
  /** Register the native `obscura_fetch`/`obscura_scrape` tools. Default `true`. */
  readonly nativeTools?: boolean;
  /** Bounds for the CLI-backed search/fetch/scrape children; out-of-range values fail setup. */
  readonly limits?: Partial<ObscuraWebLimits>;
}

/** A self-hosted SearXNG instance: no key, no vendor, but an exact origin the host names. */
export interface ToolsWebSearxngConfig {
  /** Exact origin, e.g. `https://search.example.org`; `http://` only for a loopback hostname. */
  readonly origin: string;
  /** Accept a plaintext origin when its hostname is loopback. Default `false`. */
  readonly allowLoopback?: boolean;
}

export type { ToolsWebDomainsConfig } from "./domains.js";

/** Per-session page cache. Off unless configured; `ttlSeconds` is required when the object is present. */
export interface ToolsWebCacheConfig {
  /** How long a page stays fresh, 1–86 400 seconds. */
  readonly ttlSeconds: number;
  /** Maximum pages kept across sessions. Default 64. */
  readonly maxEntries?: number;
  /** Maximum Markdown bytes kept across sessions. Default 16 MiB. */
  readonly maxBytes?: number;
}

/** Schema that `web_extract` asks the extract backend to fill; validated at setup, not first use. */
export interface ToolsWebExtractConfig {
  readonly schema: JsonObject;
}

/** Validated `packageConfig` for `@arnilo/prism-tools-web`. */
export interface ToolsWebConfig {
  /** Required; checked in `setup` with a naming error. */
  readonly backend: ToolsWebBackend;
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. Required for `brave`, `exa`, and `firecrawl`; `native` and `obscura` need none. */
  readonly apiKey?: string;
  /** Optional second backend for `web_fetch` when `backend` is `brave` or `exa`. */
  readonly fetch?: ToolsWebFetchConfig;
  /** Obscura binary settings; only read when `backend` is `"obscura"`. */
  readonly obscura?: ToolsWebObscuraConfig;
  /** SearXNG instance settings; only read when `backend` is `"searxng"`. */
  readonly searxng?: ToolsWebSearxngConfig;
  /** Register `web_extract` over this schema (needs a Firecrawl key: `apiKey`, or `fetch.apiKey`). */
  readonly extract?: ToolsWebExtractConfig;
  /** Host-owned allow/block lists enforced on every search result and fetch target. */
  readonly domains?: ToolsWebDomainsConfig;
  /** Per-session page cache for `web_fetch` and `web.fetch`; absent means the short paging memo. */
  readonly cache?: ToolsWebCacheConfig;
  /** Byte, retry, concurrency, and timeout bounds for the HTTP adapters. */
  readonly limits?: WebLimits;
}

const limitProperties: Readonly<Record<string, JsonSchema>> = {
  maxQueryBytes: { type: "number", minimum: 1 },
  maxResults: { type: "number", minimum: 1 },
  maxUrls: { type: "number", minimum: 1 },
  maxRequestBytes: { type: "number", minimum: 1 },
  maxResponseBytes: { type: "number", minimum: 1 },
  maxMarkdownBytes: { type: "number", minimum: 1 },
  maxExtractBytes: { type: "number", minimum: 1 },
  maxSchemaBytes: { type: "number", minimum: 1 },
  maxAggregateBytes: { type: "number", minimum: 1 },
  maxJsonDepth: { type: "number", minimum: 1 },
  maxJsonProperties: { type: "number", minimum: 1 },
  maxRetries: { type: "number", minimum: 0 },
  maxRateLimitDelayMs: { type: "number", minimum: 1 },
  maxConcurrency: { type: "number", minimum: 1 },
  maxQueued: { type: "number", minimum: 1 },
  maxPollingAttempts: { type: "number", minimum: 1 },
  pollingDelayMs: { type: "number", minimum: 0 },
  timeoutMs: { type: "number", minimum: 1 },
};

const obscuraLimitProperties: Readonly<Record<string, JsonSchema>> = {
  maxQueryBytes: { type: "number", minimum: 1 },
  maxResults: { type: "number", minimum: 1 },
  maxUrls: { type: "number", minimum: 1 },
  maxConcurrency: { type: "number", minimum: 1 },
  maxOutputBytes: { type: "number", minimum: 1 },
  maxStderrBytes: { type: "number", minimum: 1 },
  timeoutMs: { type: "number", minimum: 1 },
  maxEvalBytes: { type: "number", minimum: 1 },
};

const domainList: JsonSchema = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 253 },
  maxItems: 256,
};

const secretString: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: "^(env|keyring):",
  "x-prism-secret": true,
};

/**
 * The config schema. `backend` is deliberately not declared `required`: a required field with no
 * default would fail package conformance, so `setup` checks it and names the field instead.
 * `apiKey` (and `fetch.apiKey`) are ref-only secret fields; a literal fails validation.
 */
export const toolsWebConfigSchema: JsonSchema = {
  type: "object",
  properties: {
    backend: { type: "string", enum: ["brave", "exa", "firecrawl", "native", "obscura", "searxng", "tavily", "kagi"] },
    apiKey: secretString,
    fetch: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["native", "firecrawl", "off"], default: "native" },
        apiKey: secretString,
        userAgent: { type: "string", minLength: 1, maxLength: 512 },
        prompt: {
          type: "object",
          properties: {
            model: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: { provider: { type: "string" }, model: { type: "string" } },
                  required: ["provider", "model"],
                },
              ],
            },
            // No `default`: a nested default would materialize `fetch.prompt` and fail its required model.
            maxInputChars: { type: "integer", minimum: 1, maximum: 1_000_000 },
            maxOutputTokens: { type: "integer", minimum: 1, maximum: 32_768 },
          },
          required: ["model"],
        },
      },
    },
    obscura: {
      type: "object",
      properties: {
        binary: { type: "string", minLength: 1, maxLength: 4096 },
        nativeTools: { type: "boolean", default: true },
        limits: { type: "object", properties: obscuraLimitProperties },
      },
    },
    searxng: {
      type: "object",
      properties: {
        origin: { type: "string", minLength: 1, maxLength: 4096 },
        allowLoopback: { type: "boolean" },
      },
      required: ["origin"],
    },
    domains: {
      type: "object",
      properties: { allow: domainList, block: domainList },
    },
    cache: {
      type: "object",
      properties: {
        ttlSeconds: { type: "integer", minimum: 1, maximum: 86_400 },
        maxEntries: { type: "integer", minimum: 1, maximum: 4_096 },
        maxBytes: { type: "integer", minimum: 1, maximum: 67_108_864 },
      },
      required: ["ttlSeconds"],
    },
    extract: {
      type: "object",
      // Free-form JSON Schema: the kernel subset is checked in setup, naming `extract.schema`.
      properties: { schema: { type: "object", additionalProperties: true } },
      required: ["schema"],
    },
    limits: { type: "object", properties: limitProperties },
  },
};
