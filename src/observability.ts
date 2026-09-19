import { createHash } from "node:crypto";
import type { ErrorInfo, ProviderRequest, ProviderTurnMetadata } from "./contracts.js";

export function createProviderTurnMetadata(
  request: ProviderRequest,
  providerId: string,
  fields: Omit<ProviderTurnMetadata, "providerId" | "model"> = {},
): ProviderTurnMetadata {
  const names = (request.tools ?? []).map((tool) => tool.name);
  return {
    providerId,
    model: request.model,
    requestId: readRequestId(request),
    ...fields,
    tools: {
      count: names.length,
      idsHash: `sha256:${createHash("sha256").update(JSON.stringify(names), "utf8").digest("hex")}`,
    },
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
