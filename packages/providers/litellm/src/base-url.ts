/** `127.0.0.0/8` plus `::1` and `localhost`; everything else must be TLS. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return match !== null && match[1] === "127" && match.slice(1).every((part) => Number(part) <= 255);
}

/**
 * Fails closed when a plain-text key would leave the machine: the proxy is host-run, so `http:` is
 * only trustworthy on loopback. Checked at config time, before any request carries the key.
 */
export function assertLiteLLMBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.username || url.password) throw new Error("ERR_LITELLM_INSECURE_BASE_URL: baseUrl must not embed credentials");
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new Error(
    `ERR_LITELLM_INSECURE_BASE_URL: ${url.protocol}//${url.host} would send the API key in clear text; use https or a loopback host`,
  );
}
