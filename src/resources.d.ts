import { type MediaContentBounds } from "./content.js";
import type { JsonObject, ResourceLoadContext, ResourceLoader } from "./contracts.js";
export declare function loadTextResource(loader: ResourceLoader, uri: string, context?: ResourceLoadContext): Promise<string>;
export declare function loadJsonResource(loader: ResourceLoader, uri: string, context?: ResourceLoadContext): Promise<JsonObject>;
export interface LoadBinaryResourceOptions extends MediaContentBounds {
    readonly signal?: AbortSignal;
}
export declare function loadBinaryResource(loader: ResourceLoader, uri: string, context?: ResourceLoadContext, options?: LoadBinaryResourceOptions): Promise<Uint8Array>;
