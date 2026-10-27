import type { ContentBlock, ImageContent, Message, ModelConfig, ResourceLoadContext, ResourceLoader, VideoContent } from "./contracts.js";
import { type MediaHostAddress, type MediaHostnameResolver, type SsrfPolicy } from "./media-types.js";
export type { MediaHostAddress, MediaHostnameResolver, SsrfPolicy } from "./media-types.js";
export { assertSsrfAllowedUrl, MediaContentError } from "./media-types.js";
/** Known model input capability tags for `ModelCapabilities.input`. */
export declare const MODEL_INPUT_CAPABILITIES: readonly ["text", "image", "audio", "file", "document", "video"];
export type ModelInputCapability = (typeof MODEL_INPUT_CAPABILITIES)[number];
/** Default per-item media byte ceiling (10 MB; aligns with coding-agent image bounds). */
export declare const DEFAULT_MAX_MEDIA_ITEM_BYTES = 10000000;
/** Default total media byte budget per request assembly. */
export declare const DEFAULT_MAX_MEDIA_REQUEST_BYTES: number;
/** Default decoded audio duration ceiling. */
export declare const DEFAULT_MAX_AUDIO_DURATION_MS: number;
/** Default URL fetch timeout for media resolution. */
export declare const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 30000;
/** Default maximum media-bearing blocks per request assembly. */
export declare const DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST = 32;
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
export type MediaContentBlock = AudioContent | FileContent | DocumentContent | ImageContent | VideoContent;
export interface MediaContentBounds {
    readonly maxItemBytes?: number;
    readonly maxRequestBytes?: number;
    readonly maxItems?: number;
    readonly maxAudioDurationMs?: number;
    readonly fetchTimeoutMs?: number;
}
export interface MediaMimePolicy {
    /** Reject when magic bytes disagree with declared media type. Default `true`. */
    readonly strictMagicValidation?: boolean;
}
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
export declare class UnsupportedModalityError extends Error {
    readonly modality: ModelInputCapability;
    readonly provider: string;
    readonly model: string;
    constructor(modality: ModelInputCapability, model: ModelConfig);
}
export declare function contentBlockInputModality(block: ContentBlock): ModelInputCapability | undefined;
export declare function collectMessageContentBlocks(messages: readonly Message[]): ContentBlock[];
export declare function assertModelSupportsContentBlocks(model: ModelConfig, blocks: readonly ContentBlock[]): void;
export declare function assertMessagesSupportModelCapabilities(model: ModelConfig, messages: readonly Message[]): void;
export declare function assertMediaBlocksWithinBounds(blocks: readonly MediaContentBlock[], bounds?: MediaContentBounds): void;
export declare function sniffMediaMimeType(bytes: Uint8Array): string | undefined;
export declare function assertDeclaredMediaTypeMatches(declaredMediaType: string, bytes: Uint8Array, policy?: MediaMimePolicy): void;
export declare function resolveMediaContentBlock(block: MediaContentBlock, options?: ResolveMediaContentOptions): Promise<ResolvedMediaContent>;
/** Resolve and validate one complete media request before provider serialization/upload. */
export declare function resolveMediaContentBlocks(blocks: readonly MediaContentBlock[], options?: ResolveMediaContentOptions): Promise<readonly ResolvedMediaContent[]>;
export declare function loadBoundedBinaryResource(loader: ResourceLoader, uri: string, context: ResourceLoadContext | undefined, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
