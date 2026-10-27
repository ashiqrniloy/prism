/**
 * The keyless `native` fetch backend: `pinnedFetch`'s DNS pinning and SSRF gate, with redirects
 * followed by hand so every hop is checked again.
 *
 * `pinnedFetch` itself refuses 3xx responses, so the loop here reuses its pieces instead: validate
 * the URL, resolve and pin one address, request it, and repeat for `Location`. A hop to a private
 * address, a loopback, a plaintext `http:` URL, or a non-http(s) scheme fails before any socket is
 * opened. HTML becomes Markdown through `./convert.ts` (loaded on the first page only); text, JSON,
 * and XML pass through.
 */
import {
  assertSsrfAllowedUrl,
  defaultResolver,
  MediaContentError,
  type MediaHostnameResolver,
  requestPinned,
  resolvePinnedAddress,
  type SsrfPolicy,
} from "@arnilo/prism";
import type { DomainPolicy } from "../domains.js";
import { resolveWebLimits } from "../limits.js";
import { citation } from "../normalize.js";
import { truncateUtf8Bytes } from "../slice.js";
import { WebToolError } from "../transport.js";
import type { ResolvedWebLimits, WebDocument, WebFetchAdapter, WebLimits } from "../types.js";
import { convertHtml, decodeBody } from "./convert.js";

export const DEFAULT_MAX_REDIRECTS = 5;
export const HARD_MAX_REDIRECTS = 10;
/** One pinned, redirect-free request. Injected in tests; the default is the kernel's primitive. */
export type NativeFetchRequest = (url: URL, init: RequestInit) => Promise<Response>;

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json", "application/xml", "text/xml"]);
const JSON_PRETTY_BYTES = 1024 * 1024;

export interface NativeFetchOptions {
  /** Sent as `user-agent` on every request. The package passes its own name and version. */
  readonly userAgent: string;
  /** Redirects followed before `ERR_PRISM_WEB_REDIRECT`; default 5, hard maximum 10. */
  readonly maxRedirects?: number;
  readonly limits?: WebLimits;
  readonly ssrf?: SsrfPolicy;
  /** Custom DNS resolver, as `pinnedFetch` takes; defaults to `node:dns/promises`. */
  readonly resolver?: MediaHostnameResolver;
  /** Replaces the pinned request in tests; the SSRF gate still runs on the URL. */
  readonly request?: NativeFetchRequest;
  /** Host domain policy; the first URL and every redirect hop must be permitted. */
  readonly domains?: DomainPolicy;
}

export function createNativeFetch(options: NativeFetchOptions): WebFetchAdapter {
  if (typeof options.userAgent !== "string" || options.userAgent.length === 0)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", "native fetch needs a userAgent");
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > HARD_MAX_REDIRECTS)
    throw new WebToolError("ERR_PRISM_WEB_INPUT", `maxRedirects must be an integer between 0 and ${HARD_MAX_REDIRECTS}`);
  const limits = resolveWebLimits(options.limits);
  const request = options.request ?? pinnedRequest(options, limits);
  return {
    provider: "native",
    async fetch(input, call = {}) {
      const headers = { "user-agent": options.userAgent, accept: "text/html, text/markdown;q=0.9, text/plain;q=0.8, */*;q=0.1" };
      const signal = AbortSignal.any([...(call.signal === undefined ? [] : [call.signal]), AbortSignal.timeout(limits.timeoutMs)]);
      try {
        const { response, url, redirects } = await follow(input, request, {
          ssrf: options.ssrf,
          maxRedirects,
          signal,
          headers,
          ...(options.domains === undefined ? {} : { domains: options.domains }),
        });
        const body = await readBody(response, limits.maxResponseBytes, signal);
        const header = response.headers.get("content-type");
        const type = header?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        let markdown: string;
        let title: string | undefined;
        if (HTML_TYPES.has(type)) {
          const converted = await convertHtml(decodeBody(body, header), url.toString());
          markdown = converted.markdown;
          title = converted.title;
        } else if (TEXT_TYPES.has(type)) {
          markdown = decodeBody(body, header);
          if (type === "application/json" && body.byteLength <= JSON_PRETTY_BYTES) markdown = prettyJson(markdown);
        } else {
          throw new WebToolError("ERR_PRISM_WEB_CONTENT_TYPE", `native fetch does not read ${type || "an unstated content type"}`);
        }
        // `maxBytes` never lifts the limit, it only lowers it; an over-long page is cut and flagged.
        const limit = Math.min(call.maxBytes ?? limits.maxMarkdownBytes, limits.maxMarkdownBytes);
        const sourceTruncated = Buffer.byteLength(markdown, "utf8") > limit;
        return {
          ...citation("native", url.toString()),
          ...(title === undefined ? {} : { title }),
          markdown: sourceTruncated ? truncateUtf8Bytes(markdown, limit) : markdown,
          ...(sourceTruncated ? { sourceTruncated: true } : {}),
          ...(redirects.length === 0 ? {} : { redirects }),
          retrievedAt: new Date().toISOString(),
          untrusted: true,
        };
      } catch (error) {
        if (error instanceof WebToolError) throw error;
        if (signal.aborted)
          throw new WebToolError("ERR_PRISM_WEB_ABORTED", call.signal?.aborted === true ? "web fetch aborted" : "web fetch timed out");
        if (error instanceof MediaContentError) throw translate(error);
        throw new WebToolError("ERR_PRISM_WEB_REQUEST", `native fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** The default request: one DNS resolve, every candidate checked, the socket pinned to one address. */
function pinnedRequest(options: NativeFetchOptions, limits: ResolvedWebLimits): NativeFetchRequest {
  const resolver = options.resolver ?? defaultResolver;
  return async (url, init) => {
    const address = await resolvePinnedAddress(url, resolver, init.signal, false, options.ssrf, "Web fetch");
    const response = await requestPinned(url, address, init, "Web fetch");
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limits.maxResponseBytes) {
      await response.body?.cancel();
      throw new WebToolError("ERR_PRISM_WEB_LIMIT", `web response exceeds ${limits.maxResponseBytes} bytes`);
    }
    return response;
  };
}

interface FollowOptions {
  readonly ssrf: SsrfPolicy | undefined;
  readonly maxRedirects: number;
  readonly signal: AbortSignal;
  readonly headers: Record<string, string>;
  readonly domains?: DomainPolicy;
}

/** At most `maxRedirects` hops, each target resolved against the current URL and gated again. */
async function follow(
  input: string,
  request: NativeFetchRequest,
  options: FollowOptions,
): Promise<{ response: Response; url: URL; redirects: readonly string[] }> {
  const start = parseTarget(input);
  if (start === undefined) throw new WebToolError("ERR_PRISM_WEB_INPUT", "url must be an absolute http(s) URL");
  let url: URL = start;
  const seen = new Set<string>([url.toString()]);
  const redirects: string[] = [];
  for (;;) {
    // Host policy first: a redirect is a new target and is gated exactly like the first URL.
    options.domains?.assert(url.toString());
    assertPublicTarget(url, options.ssrf);
    const response = await request(url, { headers: options.headers, signal: options.signal, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return { response, url, redirects };
    await response.body?.cancel();
    const location = response.headers.get("location");
    const next: URL | undefined = location === null ? undefined : parseTarget(location, url);
    if (next === undefined)
      throw new WebToolError("ERR_PRISM_WEB_REDIRECT", `native fetch got status ${response.status} without a usable Location`);
    if (redirects.length >= options.maxRedirects)
      throw new WebToolError("ERR_PRISM_WEB_REDIRECT", `native fetch stopped after ${options.maxRedirects} redirects`);
    if (seen.has(next.toString())) throw new WebToolError("ERR_PRISM_WEB_REDIRECT", "native fetch redirect loop");
    seen.add(next.toString());
    redirects.push(next.toString());
    url = next;
  }
}

/** https only (no loopback option here), no embedded credentials, and a public address. */
function assertPublicTarget(url: URL, ssrf: SsrfPolicy | undefined): void {
  if (url.protocol !== "https:")
    throw new WebToolError("ERR_PRISM_WEB_REQUEST", `native fetch requires https: (got ${url.protocol})`);
  if (url.username || url.password) throw new WebToolError("ERR_PRISM_WEB_INPUT", "url must not embed credentials");
  url.hash = "";
  try {
    assertSsrfAllowedUrl(url.toString(), ssrf);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WebToolError("ERR_PRISM_WEB_REQUEST", `native fetch refused ${url.hostname}: ${reason}`);
  }
}

function parseTarget(input: string, base?: URL): URL | undefined {
  let url: URL;
  try {
    url = base === undefined ? new URL(input) : new URL(input, base);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
}

/** Reads at most `maxBytes`; a larger body fails instead of filling memory. */
async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new WebToolError("ERR_PRISM_WEB_LIMIT", `web response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* Already released after cancel. */
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function translate(error: MediaContentError): WebToolError {
  if (error.code === "redirect") return new WebToolError("ERR_PRISM_WEB_REDIRECT", "native fetch redirects are followed by the caller");
  return new WebToolError("ERR_PRISM_WEB_REQUEST", `native fetch failed: ${error.message}`);
}
