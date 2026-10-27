import { type MediaHostAddress, type MediaHostnameResolver, normalizeHostname, type SsrfPolicy } from "./media-types.js";
export { normalizeHostname };
export interface PinnedFetchOptions {
    /** Prefix for request-level error messages ("redirects are not allowed", "response exceeds", ...). Default "Request". */
    readonly errorPrefix?: string;
    /** Prefix for hostname-resolution error messages. Default: `errorPrefix`. */
    readonly hostnameErrorPrefix?: string;
    /** Custom resolver; defaults to `node:dns/promises` lookup (all answers, verbatim). */
    readonly resolver?: MediaHostnameResolver;
    /** Allow loopback destinations only when the requested hostname is itself loopback AND this is true. */
    readonly allowLoopback?: boolean;
    /** SSRF policy applied to the URL precheck and to every resolved candidate. */
    readonly ssrf?: SsrfPolicy;
    /** Byte ceiling for the response stream (content-length precheck + streaming bound). */
    readonly maxResponseBytes?: number;
}
/** One DNS-pinned, redirect-free, byte-bounded fetch. See module comment. */
export declare function pinnedFetch(url: URL, init: RequestInit | undefined, options?: PinnedFetchOptions): Promise<Response>;
export declare function resolvePinnedAddress(url: URL, resolver: MediaHostnameResolver, signal: AbortSignal | null | undefined, allowLoopback: boolean, ssrf: SsrfPolicy | undefined, hostnameErrorPrefix?: string): Promise<MediaHostAddress>;
export declare function defaultResolver(hostname: string): Promise<readonly MediaHostAddress[]>;
export declare function requestPinned(url: URL, address: MediaHostAddress, init: RequestInit | undefined, errorPrefix?: string): Promise<Response>;
export declare function boundResponse(response: Response, maxBytes: number, errorPrefix?: string): Response;
export declare function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T>;
export declare function isLoopbackHostname(value: string): boolean;
export declare function isLoopbackAddress(value: string): boolean;
