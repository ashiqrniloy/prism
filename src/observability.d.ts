import type { ErrorInfo, ProviderRequest, ProviderTurnMetadata } from "./contracts.js";
export declare function createProviderTurnMetadata(request: ProviderRequest, providerId: string, fields?: Omit<ProviderTurnMetadata, "providerId" | "model">): ProviderTurnMetadata;
export declare function readProviderHttpStatus(error?: ErrorInfo): number | undefined;
