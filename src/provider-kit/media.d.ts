import { type MediaContentBlock, type ModelInputCapability, type ResolvedMediaContent, type ResolveMediaContentOptions } from "../content.js";
import type { ContentBlock, JsonObject, Message, ModelCapabilities, ModelConfig } from "../contracts.js";
/** Default upload-cache entry cap per provider media session. */
export declare const DEFAULT_PROVIDER_UPLOAD_CACHE_ENTRIES = 32;
export interface ProviderMediaScope {
    readonly sessionId?: string;
    readonly runId?: string;
    readonly tenantId?: string;
}
export interface BoundedUploadCache<T> {
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    keys(): readonly string[];
    clear(): void;
}
export declare function assertProviderMediaCapability(modality: ModelInputCapability, capabilities: ModelCapabilities, model: ModelConfig): void;
export declare function rejectProviderMediaBlock(part: ContentBlock, capabilities: ModelCapabilities, model: ModelConfig): never;
export declare function createBoundedUploadCache<T>(maxEntries?: number): BoundedUploadCache<T>;
export declare function providerUploadCacheKey(scope: ProviderMediaScope, fingerprint: string): string;
export declare function mediaFingerprint(mediaType: string, bytes: Uint8Array, name?: string): string;
export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function isPdfMediaType(mediaType: string): boolean;
export declare function serializePdfDocumentWireBlock(options: {
    readonly mediaType: string;
    readonly data: string;
    readonly title?: string;
}): JsonObject;
/** Resolve every media block once and enforce aggregate request bounds before provider I/O. */
export declare function resolveProviderMediaMessages(messages: readonly Message[], model: ModelConfig, options?: ResolveMediaContentOptions): Promise<ReadonlyMap<MediaContentBlock, ResolvedMediaContent>>;
export declare function defaultProviderFilename(block: MediaContentBlock, fallback: string): string;
export declare const DEFAULT_PROVIDER_MEDIA_ITEM_BYTES = 10000000;
