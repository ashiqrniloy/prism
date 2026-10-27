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
export declare class MediaContentError extends Error {
    readonly code: "ambiguous_source" | "missing_source" | "item_too_large" | "request_too_large" | "too_many_items" | "audio_too_long" | "invalid_base64" | "ssrf_denied" | "redirect" | "fetch_failed" | "fetch_timeout" | "resource_required" | "mime_mismatch" | "unsupported_url_scheme";
    constructor(code: MediaContentError["code"], message: string, options?: ErrorOptions);
}
export declare function assertSsrfAllowedUrl(url: string, policy?: SsrfPolicy): void;
export declare function normalizeHostname(value: string): string;
export declare function isBlockedIp(hostname: string): boolean;
/**
 * Membership test for `SsrfPolicy.allowedCidrs`. Non-IP hostnames can never match; an
 * entry that does not parse as `address/prefix` throws `ssrf_denied` (fail closed,
 * including entries of the other address family than the one being tested).
 */
export declare function isAllowedByCidr(hostname: string, allowedCidrs: readonly string[] | undefined): boolean;
