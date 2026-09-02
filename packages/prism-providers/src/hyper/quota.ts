import { type CredentialValueSource, redactSecrets, resolveCredentialValue, trimTrailingSlashes } from "@arnilo/prism";
import { readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { HYPER_DEFAULT_BASE_URL } from "./models.js";

export interface GetHyperCreditsOptions {
  readonly apiKey: CredentialValueSource;
  readonly fetch?: typeof fetch;
  /** Defaults to official `https://hyper.charm.land/v1`. */
  readonly baseUrl?: string;
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Team Hypercredit balance reported by `GET /v1/credits` (auth required). */
export interface HyperCreditsBalance {
  readonly balance: number;
}

/**
 * Call Hyper's `GET /v1/credits` exactly once and return the typed team
 * Hypercredit balance (1 HC = 5¢). The endpoint requires an API key; the
 * provider-owned `authorization` header is applied after caller headers so
 * callers cannot override it; the resolved token is redacted from any error
 * message. Never called from `generate()` or package setup — hosts poll on
 * their own schedule.
 */
export async function getHyperCredits(options: GetHyperCreditsOptions): Promise<HyperCreditsBalance> {
  const baseUrl = trimTrailingSlashes(options.baseUrl ?? HYPER_DEFAULT_BASE_URL);
  const token = await resolveCredentialValue(options.apiKey, { provider: "hyper", name: "apiKey" });
  if (!token) throw new Error("Hyper credits require an API key");
  const response = await (options.fetch ?? fetch)(`${baseUrl}/credits`, {
    method: "GET",
    headers: { ...options.headers, authorization: `Bearer ${token}` },
    signal: options.signal,
  });
  if (!response.ok)
    throw new Error(
      `Hyper credits failed: ${response.status} ${redactSecrets(await readBoundedResponseText(response, { secrets: [token] }), [token])}`,
    );
  const payload = await readBoundedResponseJson<HyperCreditsBalance>(response);
  if (typeof payload.balance !== "number") throw new Error("Hyper credits response missing numeric balance");
  return payload;
}
