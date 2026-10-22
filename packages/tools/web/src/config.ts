import type { JsonSchema } from "@arnilo/prism";

import type { WebLimits } from "./types.js";

/** The search/fetch backend the package operates as. */
export type ToolsWebBackend = "brave" | "exa" | "firecrawl" | "obscura";

/** The optional second backend used for `web_fetch` when the search backend cannot fetch. */
export interface ToolsWebFetchConfig {
  /** `"firecrawl"` (default) or `"off"` to register no fetch tool. */
  readonly backend?: "firecrawl" | "off";
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. Required when `backend` is `"firecrawl"`. */
  readonly apiKey?: string;
}

/** Obscura backend settings. `obscura` needs no key. */
export interface ToolsWebObscuraConfig {
  /** Absolute path or a bare name resolved on `PATH`. Default `"obscura"`. */
  readonly binary?: string;
  /** Register the native `obscura_fetch`/`obscura_scrape` tools. Default `true`. */
  readonly nativeTools?: boolean;
}

/** Validated `packageConfig` for `@arnilo/prism-tools-web`. */
export interface ToolsWebConfig {
  /** Required; checked in `setup` with a naming error. */
  readonly backend: ToolsWebBackend;
  /** `env:NAME` or `keyring:NAME`; a literal fails config validation. Required for `brave`/`exa`/`firecrawl`. */
  readonly apiKey?: string;
  /** Optional second backend for `web_fetch` when `backend` is `brave` or `exa`. */
  readonly fetch?: ToolsWebFetchConfig;
  /** Obscura binary settings; only read when `backend` is `"obscura"`. */
  readonly obscura?: ToolsWebObscuraConfig;
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
  maxPollingAttempts: { type: "number", minimum: 1 },
  pollingDelayMs: { type: "number", minimum: 0 },
  timeoutMs: { type: "number", minimum: 1 },
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
    backend: { type: "string", enum: ["brave", "exa", "firecrawl", "obscura"] },
    apiKey: secretString,
    fetch: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["firecrawl", "off"], default: "firecrawl" },
        apiKey: secretString,
      },
    },
    obscura: {
      type: "object",
      properties: {
        binary: { type: "string", minLength: 1, maxLength: 4096 },
        nativeTools: { type: "boolean", default: true },
      },
    },
    limits: { type: "object", properties: limitProperties },
  },
};
