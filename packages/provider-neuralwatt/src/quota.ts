import { resolveCredentialValue, redactSecrets, type CredentialValueSource } from "@arnilo/prism";
import { readBoundedResponseText } from "@arnilo/prism/providers/transport";

export interface GetNeuralWattQuotaOptions {
  readonly apiKey: CredentialValueSource;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Account balance reported by NeuralWatt `/v1/quota`. */
export interface NeuralWattQuotaBalance {
  readonly balance_usd?: number;
  readonly currency?: string;
}

/** Usage totals reported by NeuralWatt `/v1/quota`. */
export interface NeuralWattQuotaUsage {
  readonly cost_usd?: number;
  readonly requests?: number;
  readonly tokens?: number;
  readonly energy_kwh?: number;
}

/** Account limits reported by NeuralWatt `/v1/quota`. */
export interface NeuralWattQuotaLimits {
  readonly overage_limit_usd?: number;
  readonly rate_limit_tier?: string;
}

/** Subscription details reported by NeuralWatt `/v1/quota`. */
export interface NeuralWattQuotaSubscription {
  readonly plan?: string;
  readonly status?: string;
  readonly kwh_included?: number;
  readonly kwh_used?: number;
  readonly kwh_remaining?: number;
}

/** Key allowance reported by NeuralWatt `/v1/quota`. */
export interface NeuralWattQuotaKey {
  readonly allowance_usd?: number;
  readonly allowance_used_usd?: number;
  readonly allowance_remaining_usd?: number;
}

/** Typed NeuralWatt `/v1/quota` response. All fields optional; the helper does
 * minimal structural validation and returns the JSON shape as documented. */
export interface NeuralWattQuota {
  readonly balance?: NeuralWattQuotaBalance;
  readonly usage?: {
    readonly lifetime?: NeuralWattQuotaUsage;
    readonly current_month?: NeuralWattQuotaUsage;
  };
  readonly limits?: NeuralWattQuotaLimits;
  readonly subscription?: NeuralWattQuotaSubscription;
  readonly key?: NeuralWattQuotaKey;
}

/**
 * Call NeuralWatt's `GET /v1/quota` exactly once and return the typed account
 * quota. The endpoint is rate-limited to **1 request per second per customer**
 * (429 with `Retry-After: 1`); the caller owns throttling/caching — this helper
 * performs no polling, no caching, and is never called from `generate()` or
 * package setup.
 *
 * An API key is required (NeuralWatt returns 401 for unauthenticated quota
 * calls). The provider-owned `authorization` header is applied after caller
 * headers so callers cannot override it; the resolved token is redacted from
 * any error message.
 */
export async function getNeuralWattQuota(options: GetNeuralWattQuotaOptions): Promise<NeuralWattQuota> {
  const baseUrl = (options.baseUrl ?? "https://api.neuralwatt.com/v1").replace(/\/$/, "");
  const token = await resolveCredentialValue(options.apiKey, { provider: "neuralwatt", name: "apiKey" });
  if (!token) throw new Error("NeuralWatt quota requires an API key");
  const response = await (options.fetch ?? fetch)(`${baseUrl}/quota`, {
    method: "GET",
    headers: { ...options.headers, authorization: `Bearer ${token}` },
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`NeuralWatt quota failed: ${response.status} ${redactSecrets(await readBoundedResponseText(response, { secrets: [token] }), [token])}`);
  return (await response.json()) as NeuralWattQuota;
}
