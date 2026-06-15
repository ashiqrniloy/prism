import type { AIProvider, ProviderEvent, ProviderRequest } from "./contracts.js";

export interface MockProviderOptions {
  readonly id?: string;
  readonly onRequest?: (request: ProviderRequest) => void;
}

export function createMockProvider(
  events: readonly ProviderEvent[] = [{ type: "done" }],
  options: MockProviderOptions = {},
): AIProvider {
  return {
    id: options.id ?? "mock",
    async *generate(request) {
      options.onRequest?.(request);
      for (const event of events) {
        if (request.signal?.aborted) throw request.signal.reason;
        yield event;
      }
    },
  };
}
