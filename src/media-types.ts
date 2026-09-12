/**
 * SSRF policy, host/address types, `MediaContentError`, and the URL gate shared by the
 * media content pipeline (`content.ts`) and the DNS-pinned fetch primitive
 * (`pinned-fetch.ts`).
 *
 * Leaf module: it imports nothing from either consumer, which is what keeps the two off
 * each other's import graph (plan 070 Task 10, shipped in 0.6.0 — the pair previously formed
 * a deliberate ESM cycle where each module referenced the other's exports only inside
 * function bodies). Declarations moved here verbatim; `assertSsrfAllowedUrl` is
 * re-exported from `content.ts` so every import path and the class identity stay put.
 */
import { isIP } from "node:net";

export interface SsrfPolicy {
  /** When true (default), deny private/link-local/metadata hostnames and IPs. */
  readonly denyPrivateHosts?: boolean;
  /** Optional hostname allow-list. When set, only listed hosts are permitted. */
  readonly allowedHostnames?: readonly string[];
  /**
   * Optional IP-literal CIDR allow-list (IPv4 + IPv6, e.g. `"10.0.0.0/8"`). Checked
   * after the hostname allow-list and the denied-name list, and applied to both URL
   * literals and resolved DNS candidates. Membership bypasses **only** the private-IP
   * block: metadata-style hostnames (`metadata.google.internal`), loopback names, and
   * embedded credentials stay denied, and a hostname in the list can never match.
   * An unparseable entry fails the check closed. Explicit host trust override — see
   * `docs/multimodal-content.md` / `docs/host-security.md`.
   */
  readonly allowedCidrs?: readonly string[];
}

export interface MediaHostAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type MediaHostnameResolver = (hostname: string, signal: AbortSignal) => Promise<readonly MediaHostAddress[]>;

export class MediaContentError extends Error {
  readonly code:
    | "ambiguous_source"
    | "missing_source"
    | "item_too_large"
    | "request_too_large"
    | "too_many_items"
    | "audio_too_long"
    | "invalid_base64"
    | "ssrf_denied"
    | "redirect"
    | "fetch_failed"
    | "fetch_timeout"
    | "resource_required"
    | "mime_mismatch"
    | "unsupported_url_scheme";

  constructor(code: MediaContentError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaContentError";
    this.code = code;
  }
}

export function assertSsrfAllowedUrl(url: string, policy: SsrfPolicy = {}): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MediaContentError("ssrf_denied", "Media URL is not a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaContentError("unsupported_url_scheme", `Media URL scheme ${parsed.protocol} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new MediaContentError("ssrf_denied", "Media URL must not embed credentials");
  }

  const hostname = normalizeHostname(parsed.hostname);
  // Parsed up front so a malformed policy entry always fails closed, even when another
  // allow-list short-circuits below. Membership only matters after the denied-name list.
  const cidrAllowed = isAllowedByCidr(hostname, policy.allowedCidrs);
  if (policy.allowedHostnames?.length) {
    if (!policy.allowedHostnames.some((allowed) => hostname === normalizeHostname(allowed))) {
      throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allow-listed`);
    }
    return;
  }

  if (policy.denyPrivateHosts === false) return;

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata" ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allowed`);
  }

  // Validates the CIDR list even for a denied/absent IP: an unparseable entry fails closed.
  if (cidrAllowed) return;

  if (isBlockedIp(hostname)) {
    throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allowed`);
  }
}

export function normalizeHostname(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function isBlockedIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return false;
}

/**
 * Membership test for `SsrfPolicy.allowedCidrs`. Non-IP hostnames can never match; an
 * entry that does not parse as `address/prefix` throws `ssrf_denied` (fail closed,
 * including entries of the other address family than the one being tested).
 */
export function isAllowedByCidr(hostname: string, allowedCidrs: readonly string[] | undefined): boolean {
  if (!allowedCidrs?.length) return false;
  const ranges = allowedCidrs.map((entry) => {
    const range = parseCidr(entry);
    if (!range) throw new MediaContentError("ssrf_denied", `SSRF policy CIDR '${entry}' is not a valid range`);
    return range;
  });
  const address = normalizeHostname(hostname);
  const family = isIP(address);
  if (family !== 4 && family !== 6) return false;
  const bits = family === 4 ? 32 : 128;
  const target = addressToBigInt(address, family);
  return ranges.some((range) => range.bits === bits && target >> BigInt(bits - range.prefix) === range.base >> BigInt(bits - range.prefix));
}

function parseCidr(value: string): { readonly base: bigint; readonly bits: number; readonly prefix: number } | undefined {
  const [address, prefixText, ...rest] = value.split("/");
  if (rest.length > 0 || address === undefined || prefixText === undefined) return undefined;
  const family = isIP(normalizeHostname(address));
  if (family !== 4 && family !== 6) return undefined;
  const prefix = Number(prefixText);
  const bits = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return undefined;
  return { base: addressToBigInt(normalizeHostname(address), family), bits, prefix };
}

function addressToBigInt(address: string, family: 4 | 6): bigint {
  const words = family === 4 ? address.split(".").map(Number) : (parseIpv6Words(address) ?? []);
  return words.reduce((accumulator, word) => (accumulator << BigInt(family === 4 ? 8 : 16)) | BigInt(word), 0n);
}

function isBlockedIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number) as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const words = parseIpv6Words(address);
  if (!words) return true;
  if (words.every((word) => word === 0) || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if ((words[0]! & 0xfe00) === 0xfc00) return true;
  if ((words[0]! & 0xffc0) === 0xfe80 || (words[0]! & 0xffc0) === 0xfec0) return true;
  if ((words[0]! & 0xff00) === 0xff00) return true;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;
  const mapped = words.slice(0, 5).every((word) => word === 0) && (words[5] === 0 || words[5] === 0xffff);
  return mapped && isBlockedIpv4(`${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`);
}

function parseIpv6Words(address: string): number[] | undefined {
  const parts = address.split("::");
  if (parts.length > 2) return undefined;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return undefined;
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) => Number.parseInt(part, 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : undefined;
}
