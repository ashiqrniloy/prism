import type { ProviderRequest, ProviderRequestOptions } from "../contracts.js";
export interface ApplyDefaultProviderRequestOptionsContext {
    readonly sessionId?: string;
    readonly thinkingLevel?: string;
}
export declare class ProviderRequirementError extends Error {
    readonly code: "ERR_PRISM_PROVIDER_REQUIREMENT";
    readonly requirement: string;
    readonly providerId?: string;
    constructor(message: string, options: {
        readonly requirement: string;
        readonly providerId?: string;
    });
}
/** Fill-if-missing `sessionId` / `cacheKey` / cache defaults from `model.cache`. Host values win. Thinking intent patches after. */
export declare function applyDefaultProviderRequestOptions(request: ProviderRequest, ctx?: ApplyDefaultProviderRequestOptionsContext): ProviderRequest;
export declare function mergeProviderRequestOptions(base: ProviderRequestOptions | undefined, patch: ProviderRequestOptions | undefined): ProviderRequestOptions | undefined;
