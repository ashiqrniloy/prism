import type { JsonObject, ModelConfig } from "@arnilo/prism";
import { trimTrailingSlashes } from "@arnilo/prism";

/** `laya-serve` default bind. `/v1/systemone` is appended per request. Loopback plaintext only. */
export const DEFAULT_LAYA_BASE_URL = "http://localhost:8000";
/** Env var a remote `laya-serve` expects when `LAYA_API_KEY` is set server-side. */
export const LAYA_API_KEY_ENV = "LAYA_API_KEY";

/** Laya answers typed questions in one pass — it never generates free text, streams, or calls tools. */
const DECISION_CAPABILITIES = {
  input: ["text"],
  output: ["text"],
  tools: false,
  streaming: false,
  structuredOutput: "json_schema",
} as const;

const ZERO_COST = { input: 0, output: 0, currency: "USD", unit: "per_million_tokens" } as const;

export interface LayaModelConfig extends Omit<ModelConfig, "provider"> {
  readonly provider?: "laya";
  readonly compat?: JsonObject;
}

/** Declares a Laya checkpoint id. The server's Router still picks the checkpoint; `model` is advisory. */
export function defineLayaModel(config: LayaModelConfig): ModelConfig {
  return {
    ...config,
    provider: "laya",
    capabilities: { ...DECISION_CAPABILITIES, ...config.capabilities },
    limits: { maxOutputTokens: 0, ...config.limits },
    cost: { ...ZERO_COST, ...config.cost },
  };
}

/** Curated checkpoints. Context is the encoder window; multilingual may be extended server-side. */
export const layaModels: readonly ModelConfig[] = [
  defineLayaModel({ model: "laya", displayName: "Laya", limits: { contextWindow: 512, maxOutputTokens: 0 } }),
  defineLayaModel({
    model: "laya-multilingual",
    displayName: "Laya Multilingual",
    limits: { contextWindow: 1024, maxOutputTokens: 0 },
    metadata: { extendedContextWindow: 8192 },
  }),
  defineLayaModel({
    model: "laya-typed-decisions",
    displayName: "Laya Typed Decisions",
    limits: { contextWindow: 1024, maxOutputTokens: 0 },
  }),
];

/**
 * Host-supplied `baseUrl` wins over the loopback default. Trailing slashes are trimmed.
 * Plaintext non-loopback warns and still returns — air-gapped LAN HTTP is a legitimate setup.
 */
export function layaBaseUrl(options: { readonly baseUrl?: string } = {}): string {
  const base = trimTrailingSlashes(options.baseUrl ?? DEFAULT_LAYA_BASE_URL);
  warnIfPlaintextRemote(base);
  return base;
}

function warnIfPlaintextRemote(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return;
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname))) return;
  if (url.protocol !== "http:") return;
  // origin drops userinfo; a baseUrl must not echo credentials into the warning.
  console.warn(
    `Laya baseUrl ${url.origin} is plaintext and not loopback. Use https:// for a remote laya-serve; state and questions leave this process.`,
  );
}

// ponytail: canonical hosts only (localhost, *.localhost, ::1, 127/8). Non-canonical loopback (127.1, ::ffff:127.0.0.1) warns; parse before compare if that shows up.
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (!host.startsWith("127.")) return false;
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
