/**
 * `@arnilo/prism/net`: the kernel's SSRF-safe outbound network plumbing (plan 215 Task 26).
 *
 * `pinnedFetch` is the only supported SSRF-safe fetch: one DNS resolve per request, every
 * candidate address checked against `assertSsrfAllowedUrl` before the connect, the socket pinned
 * to that address (no re-resolve, so no DNS rebinding), 3xx rejected, and the body byte-bounded.
 * `requestPinned`/`resolvePinnedAddress`/`defaultResolver` are its building blocks for callers that
 * must follow redirects themselves (re-checking every hop). `assertSsrfAllowedUrl`, `SsrfPolicy`
 * and `MediaContentError` stay on the root entry. Importing this subpath loads `node:http`/`node:https`.
 */
export {
  boundResponse,
  defaultResolver,
  isLoopbackAddress,
  isLoopbackHostname,
  normalizeHostname,
  type PinnedFetchOptions,
  pinnedFetch,
  raceAbort,
  requestPinned,
  resolvePinnedAddress,
} from "../pinned-fetch.js";
