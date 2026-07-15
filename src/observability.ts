import type { ErrorInfo, ModelConfig, ProviderRequest, ProviderTurnMetadata } from "./contracts.js";

export function createProviderTurnMetadata(
  request: ProviderRequest,
  providerId: string,
  fields: Omit<ProviderTurnMetadata, "providerId" | "model"> = {},
): ProviderTurnMetadata {
  return {
    providerId,
    model: request.model,
    requestId: readRequestId(request),
    ...fields,
  };
}

export function readProviderHttpStatus(error?: ErrorInfo): number | undefined {
  return typeof error?.code === "number" ? error.code : undefined;
}

function readRequestId(request: ProviderRequest): string | undefined {
  const fromMetadata = request.metadata?.requestId;
  if (typeof fromMetadata === "string" && fromMetadata.length > 0) return fromMetadata;
  return request.options?.sessionId;
}
