import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type {
  ContentBlock,
  ImageContent,
  Message,
  ModelConfig,
  ResourceLoadContext,
  ResourceLoader,
} from "./contracts.js";
import { assertPermission } from "./security.js";

/** Known model input capability tags for `ModelCapabilities.input`. */
export const MODEL_INPUT_CAPABILITIES = ["text", "image", "audio", "file", "document"] as const;
export type ModelInputCapability = (typeof MODEL_INPUT_CAPABILITIES)[number];

/** Default per-item media byte ceiling (10 MB; aligns with coding-agent image bounds). */
export const DEFAULT_MAX_MEDIA_ITEM_BYTES = 10_000_000;
/** Default total media byte budget per request assembly. */
export const DEFAULT_MAX_MEDIA_REQUEST_BYTES = 32 * 1024 * 1024;
/** Default decoded audio duration ceiling. */
export const DEFAULT_MAX_AUDIO_DURATION_MS = 5 * 60 * 1000;
/** Default URL fetch timeout for media resolution. */
export const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 30_000;
/** Default maximum media-bearing blocks per request assembly. */
export const DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST = 32;

export interface AudioContent {
  readonly type: "audio";
  readonly mediaType: string;
  readonly name?: string;
  /** Base64-encoded audio bytes. */
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly durationMs?: number;
  readonly transcript?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FileContent {
  readonly type: "file";
  readonly mediaType: string;
  readonly name?: string;
  /** Base64-encoded file bytes. */
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DocumentContent {
  readonly type: "document";
  readonly mediaType: string;
  readonly name?: string;
  /** Base64-encoded document bytes. */
  readonly data?: string;
  readonly url?: string;
  readonly resourceUri?: string;
  readonly transcript?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MediaContentBlock = AudioContent | FileContent | DocumentContent | ImageContent;

export interface MediaContentBounds {
  readonly maxItemBytes?: number;
  readonly maxRequestBytes?: number;
  readonly maxItems?: number;
  readonly maxAudioDurationMs?: number;
  readonly fetchTimeoutMs?: number;
}

export interface SsrfPolicy {
  /** When true (default), deny private/link-local/metadata hostnames and IPs. */
  readonly denyPrivateHosts?: boolean;
  /** Optional hostname allow-list. When set, only listed hosts are permitted. */
  readonly allowedHostnames?: readonly string[];
}

export interface MediaMimePolicy {
  /** Reject when magic bytes disagree with declared media type. Default `true`. */
  readonly strictMagicValidation?: boolean;
}

export interface MediaHostAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type MediaHostnameResolver = (
  hostname: string,
  signal: AbortSignal,
) => Promise<readonly MediaHostAddress[]>;

export interface MediaUrlRequest {
  readonly url: URL;
  readonly address: MediaHostAddress;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export type MediaUrlRequester = (request: MediaUrlRequest) => Promise<Uint8Array>;

export interface ResolveMediaContentOptions {
  readonly bounds?: MediaContentBounds;
  readonly ssrf?: SsrfPolicy;
  readonly mime?: MediaMimePolicy;
  readonly loader?: ResourceLoader;
  readonly loadContext?: ResourceLoadContext;
  /** Trusted custom transport; the host owns DNS resolution and rebinding protection. */
  readonly fetch?: typeof globalThis.fetch;
  /** Test/custom resolver used only with the default or `requestUrl` pinned transport. */
  readonly resolveHostname?: MediaHostnameResolver;
  /** Trusted custom transport that must connect to `request.address`, not resolve `request.url` again. */
  readonly requestUrl?: MediaUrlRequester;
  readonly signal?: AbortSignal;
}

export interface ResolvedMediaContent {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly name?: string;
  readonly durationMs?: number;
  readonly transcript?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class UnsupportedModalityError extends Error {
  readonly modality: ModelInputCapability;
  readonly provider: string;
  readonly model: string;

  constructor(modality: ModelInputCapability, model: ModelConfig) {
    super(`Model ${model.provider}/${model.model} does not support ${modality} input`);
    this.name = "UnsupportedModalityError";
    this.modality = modality;
    this.provider = model.provider;
    this.model = model.model;
  }
}

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
    | "fetch_failed"
    | "fetch_timeout"
    | "resource_required"
    | "mime_mismatch"
    | "unsupported_url_scheme";

  constructor(code: MediaContentError["code"], message: string) {
    super(message);
    this.name = "MediaContentError";
    this.code = code;
  }
}

export function contentBlockInputModality(block: ContentBlock): ModelInputCapability | undefined {
  switch (block.type) {
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "file":
      return "file";
    case "document":
      return "document";
    default:
      return undefined;
  }
}

export function collectMessageContentBlocks(messages: readonly Message[]): ContentBlock[] {
  return messages.flatMap((message) => [...message.content]);
}

export function assertModelSupportsContentBlocks(
  model: ModelConfig,
  blocks: readonly ContentBlock[],
): void {
  const supported = model.capabilities?.input;
  if (!supported?.length) return;
  for (const block of blocks) {
    const modality = contentBlockInputModality(block);
    if (modality && !supported.includes(modality)) {
      throw new UnsupportedModalityError(modality, model);
    }
  }
}

export function assertMessagesSupportModelCapabilities(
  model: ModelConfig,
  messages: readonly Message[],
): void {
  assertModelSupportsContentBlocks(model, collectMessageContentBlocks(messages));
}

export function assertMediaBlocksWithinBounds(
  blocks: readonly MediaContentBlock[],
  bounds: MediaContentBounds = {},
): void {
  const maxItems = bounds.maxItems ?? DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST;
  const maxItemBytes = bounds.maxItemBytes ?? DEFAULT_MAX_MEDIA_ITEM_BYTES;
  const maxRequestBytes = bounds.maxRequestBytes ?? DEFAULT_MAX_MEDIA_REQUEST_BYTES;
  const maxAudioDurationMs = bounds.maxAudioDurationMs ?? DEFAULT_MAX_AUDIO_DURATION_MS;

  if (blocks.length > maxItems) {
    throw new MediaContentError("too_many_items", `Media item count ${blocks.length} exceeded ${maxItems}`);
  }

  let requestBytes = 0;
  for (const block of blocks) {
    const inlineBytes = estimateInlineMediaBytes(block);
    if (inlineBytes > maxItemBytes) {
      throw new MediaContentError("item_too_large", `Media item exceeded ${maxItemBytes} bytes`);
    }
    requestBytes += inlineBytes;
    if (requestBytes > maxRequestBytes) {
      throw new MediaContentError("request_too_large", `Media request budget exceeded ${maxRequestBytes} bytes`);
    }
    if (block.type === "audio" && block.durationMs !== undefined && block.durationMs > maxAudioDurationMs) {
      throw new MediaContentError(
        "audio_too_long",
        `Audio duration ${block.durationMs}ms exceeded ${maxAudioDurationMs}ms`,
      );
    }
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
  if (policy.allowedHostnames?.length) {
    if (!policy.allowedHostnames.some((allowed) => hostname === normalizeHostname(allowed))) {
      throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allow-listed`);
    }
    return;
  }

  if (policy.denyPrivateHosts === false) return;

  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname === "metadata"
    || hostname === "metadata.google.internal"
    || hostname === "instance-data"
  ) {
    throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allowed`);
  }

  if (isBlockedIp(hostname)) {
    throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} is not allowed`);
  }
}

export function sniffMediaMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWithAscii(bytes, 0, "%PDF")) return "application/pdf";
  if (startsWithAscii(bytes, 0, "RIFF") && startsWithAscii(bytes, 8, "WAVE")) return "audio/wav";
  if (startsWithAscii(bytes, 0, "RIFF") && startsWithAscii(bytes, 8, "WEBP")) return "image/webp";
  if (startsWithAscii(bytes, 0, "OggS")) return "audio/ogg";
  if (startsWithAscii(bytes, 0, "fLaC")) return "audio/flac";
  if (startsWithAscii(bytes, 0, "ID3")) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithAscii(bytes, 0, "GIF8")) return "image/gif";
  if (startsWithAscii(bytes, 0, "PK\u0003\u0004")) return "application/zip";
  return undefined;
}

export function assertDeclaredMediaTypeMatches(
  declaredMediaType: string,
  bytes: Uint8Array,
  policy: MediaMimePolicy = {},
): void {
  if (policy.strictMagicValidation === false) return;
  const sniffed = sniffMediaMimeType(bytes);
  if (!sniffed) return;
  if (!mediaTypesCompatible(declaredMediaType, sniffed)) {
    throw new MediaContentError(
      "mime_mismatch",
      `Declared media type ${declaredMediaType} does not match sniffed type ${sniffed}`,
    );
  }
}

export async function resolveMediaContentBlock(
  block: MediaContentBlock,
  options: ResolveMediaContentOptions = {},
): Promise<ResolvedMediaContent> {
  return (await resolveMediaContentBlocks([block], options))[0]!;
}

/** Resolve and validate one complete media request before provider serialization/upload. */
export async function resolveMediaContentBlocks(
  blocks: readonly MediaContentBlock[],
  options: ResolveMediaContentOptions = {},
): Promise<readonly ResolvedMediaContent[]> {
  const bounds = options.bounds ?? {};
  const maxRequestBytes = bounds.maxRequestBytes ?? DEFAULT_MAX_MEDIA_REQUEST_BYTES;
  assertMediaBlocksWithinBounds(blocks, bounds);
  const resolved: ResolvedMediaContent[] = [];
  let requestBytes = 0;
  for (const block of blocks) {
    const item = await resolveMediaBlock(block, options);
    requestBytes += item.bytes.byteLength;
    if (requestBytes > maxRequestBytes) {
      throw new MediaContentError("request_too_large", `Media request budget exceeded ${maxRequestBytes} bytes`);
    }
    resolved.push(item);
  }
  return resolved;
}

async function resolveMediaBlock(
  block: MediaContentBlock,
  options: ResolveMediaContentOptions,
): Promise<ResolvedMediaContent> {
  const bounds = options.bounds ?? {};
  const maxItemBytes = bounds.maxItemBytes ?? DEFAULT_MAX_MEDIA_ITEM_BYTES;
  const source = mediaSourceKind(block);
  let bytes: Uint8Array;
  let mediaType = declaredMediaType(block);

  if (source === "data") {
    bytes = decodeBase64Bounded(readDataField(block)!, maxItemBytes);
  } else if (source === "resource") {
    if (!options.loader) {
      throw new MediaContentError("resource_required", "ResourceLoader is required to resolve resourceUri media");
    }
    bytes = await loadBoundedBinaryResource(
      options.loader,
      readResourceUri(block)!,
      options.loadContext,
      maxItemBytes,
      options.signal,
    );
  } else {
    bytes = await fetchBoundedMediaUrl(
      readUrlField(block)!,
      {
        maxBytes: maxItemBytes,
        timeoutMs: bounds.fetchTimeoutMs ?? DEFAULT_MEDIA_FETCH_TIMEOUT_MS,
        ssrf: options.ssrf,
        fetch: options.fetch,
        resolveHostname: options.resolveHostname,
        requestUrl: options.requestUrl,
        signal: options.signal,
      },
    );
  }

  assertDeclaredMediaTypeMatches(mediaType, bytes, options.mime);
  const sniffed = sniffMediaMimeType(bytes);
  if (sniffed && (mediaType === "application/octet-stream" || !mediaType)) {
    mediaType = sniffed;
  }

  const durationMs = block.type === "audio" ? block.durationMs : undefined;

  return {
    mediaType,
    bytes,
    name: readName(block),
    durationMs,
    transcript: readTranscript(block),
    metadata: "metadata" in block ? block.metadata : undefined,
  };
}

export async function loadBoundedBinaryResource(
  loader: ResourceLoader,
  uri: string,
  context: ResourceLoadContext | undefined,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await assertPermission(context?.permission, {
    kind: "resource",
    action: "load",
    target: uri,
    metadata: context?.metadata,
  });
  signal?.throwIfAborted();
  const resource = await loader.load(uri, { ...context, signal });
  const bytes = resource.data ?? (resource.text !== undefined ? new TextEncoder().encode(resource.text) : undefined);
  if (!bytes) throw new MediaContentError("missing_source", `Resource ${uri} has no data or text`);
  if (bytes.byteLength > maxBytes) {
    throw new MediaContentError("item_too_large", `Resource ${uri} exceeded ${maxBytes} bytes`);
  }
  return bytes;
}

function mediaSourceKind(block: MediaContentBlock): "data" | "url" | "resource" {
  const sources = [
    readDataField(block) ? "data" : undefined,
    readResourceUri(block) ? "resource" : undefined,
    readUrlField(block) ? "url" : undefined,
  ].filter((value): value is "data" | "url" | "resource" => value !== undefined);
  if (sources.length === 0) {
    throw new MediaContentError("missing_source", `Media block ${block.type} requires data, url, or resourceUri`);
  }
  if (sources.length > 1) {
    throw new MediaContentError("ambiguous_source", `Media block ${block.type} must provide only one of data, url, or resourceUri`);
  }
  return sources[0]!;
}

function readDataField(block: MediaContentBlock): string | undefined {
  return "data" in block ? block.data : undefined;
}

function readUrlField(block: MediaContentBlock): string | undefined {
  return "url" in block ? block.url : undefined;
}

function readResourceUri(block: MediaContentBlock): string | undefined {
  return "resourceUri" in block ? block.resourceUri : undefined;
}

function readName(block: MediaContentBlock): string | undefined {
  return "name" in block ? block.name : undefined;
}

function readTranscript(block: MediaContentBlock): string | undefined {
  return "transcript" in block ? block.transcript : undefined;
}

function declaredMediaType(block: MediaContentBlock): string {
  if ("mediaType" in block && block.mediaType) return block.mediaType;
  if (block.type === "image" && block.mimeType) return block.mimeType;
  return "application/octet-stream";
}

function estimateInlineMediaBytes(block: MediaContentBlock): number {
  const data = readDataField(block);
  if (data) return estimateBase64DecodedBytes(data);
  return 0;
}

function estimateBase64DecodedBytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function decodeBase64Bounded(data: string, maxBytes: number): Uint8Array {
  const estimated = estimateBase64DecodedBytes(data);
  if (estimated > maxBytes) {
    throw new MediaContentError("item_too_large", `Inline media exceeded ${maxBytes} bytes`);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  } catch {
    throw new MediaContentError("invalid_base64", "Media data is not valid base64");
  }
  if (bytes.byteLength > maxBytes) {
    throw new MediaContentError("item_too_large", `Inline media exceeded ${maxBytes} bytes`);
  }
  return bytes;
}

interface FetchBoundedMediaOptions {
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly ssrf?: SsrfPolicy;
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveHostname?: MediaHostnameResolver;
  readonly requestUrl?: MediaUrlRequester;
  readonly signal?: AbortSignal;
}

async function fetchBoundedMediaUrl(url: string, options: FetchBoundedMediaOptions): Promise<Uint8Array> {
  assertSsrfAllowedUrl(url, options.ssrf);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    if (options.fetch) return await readFetchResponse(await options.fetch(url, { signal, redirect: "error" }), options.maxBytes);

    const parsed = new URL(url);
    const hostname = normalizeHostname(parsed.hostname);
    const family = isIP(hostname);
    const address = family
      ? { address: hostname, family: family as 4 | 6 }
      : await resolvePublicAddress(hostname, options.resolveHostname ?? defaultMediaHostnameResolver, signal, options.ssrf);
    const bytes = await (options.requestUrl ?? requestPinnedMediaUrl)({
      url: parsed,
      address,
      maxBytes: options.maxBytes,
      signal,
    });
    if (bytes.byteLength > options.maxBytes) {
      throw new MediaContentError("item_too_large", `Fetched media exceeded ${options.maxBytes} bytes`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof MediaContentError) throw error;
    if (timeoutController.signal.aborted) {
      throw new MediaContentError("fetch_timeout", `Media fetch timed out after ${options.timeoutMs}ms`);
    }
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Media fetch aborted");
    throw new MediaContentError("fetch_failed", error instanceof Error ? error.message : "Media fetch failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultMediaHostnameResolver(hostname: string): Promise<readonly MediaHostAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true }) as Promise<readonly MediaHostAddress[]>;
}

async function resolvePublicAddress(
  hostname: string,
  resolver: MediaHostnameResolver,
  signal: AbortSignal,
  policy: SsrfPolicy | undefined,
): Promise<MediaHostAddress> {
  const addresses = await raceAbort(resolver(hostname, signal), signal);
  if (addresses.length === 0) throw new MediaContentError("fetch_failed", "Media hostname resolved to no addresses");
  if (addresses.length > 32) throw new MediaContentError("fetch_failed", "Media hostname resolved to too many addresses");
  if (policy?.denyPrivateHosts !== false && !policy?.allowedHostnames?.length) {
    if (addresses.some(({ address }) => isBlockedIp(normalizeHostname(address)))) {
      throw new MediaContentError("ssrf_denied", `Media URL host ${hostname} resolved to a private address`);
    }
  }
  const selected = addresses[0]!;
  if (isIP(normalizeHostname(selected.address)) !== selected.family) {
    throw new MediaContentError("fetch_failed", "Media hostname resolver returned an invalid address");
  }
  return { address: normalizeHostname(selected.address), family: selected.family };
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

async function readFetchResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new MediaContentError("fetch_failed", `Media fetch failed with status ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new MediaContentError("fetch_failed", "Media fetch returned no response body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new MediaContentError("item_too_large", `Fetched media exceeded ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed after abort/complete.
    }
    reader.releaseLock();
  }
  return joinChunks(chunks, total);
}

function requestPinnedMediaUrl({ url, address, maxBytes, signal }: MediaUrlRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      agent: false,
      family: address.family,
      signal,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => readIncomingMessage(response, maxBytes).then(resolve, reject));
    request.on("error", reject);
    request.end();
  });
}

async function readIncomingMessage(response: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    response.resume();
    throw new MediaContentError("fetch_failed", `Media fetch failed with status ${status}`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) {
      response.destroy();
      throw new MediaContentError("item_too_large", `Fetched media exceeded ${maxBytes} bytes`);
    }
    chunks.push(bytes);
  }
  return joinChunks(chunks, total);
}

function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function mediaTypesCompatible(declared: string, sniffed: string): boolean {
  const normalizedDeclared = declared.toLowerCase();
  const normalizedSniffed = sniffed.toLowerCase();
  if (normalizedDeclared === normalizedSniffed) return true;
  if (normalizedDeclared === "application/octet-stream") return true;
  if (normalizedDeclared.startsWith("text/") && normalizedSniffed.startsWith("text/")) return true;
  if (normalizedDeclared === "audio/mpeg" && normalizedSniffed === "audio/mpeg") return true;
  if (normalizedDeclared === "audio/mp3" && normalizedSniffed === "audio/mpeg") return true;
  if (normalizedDeclared === "application/zip" && normalizedSniffed === "application/zip") return true;
  return false;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function isBlockedIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return false;
}

function isBlockedIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number) as [number, number, number, number];
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0)
    || a >= 224;
}

function isBlockedIpv6(address: string): boolean {
  const words = parseIpv6Words(address);
  if (!words) return true;
  if (words.every((word) => word === 0) || words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;
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
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : undefined;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}
