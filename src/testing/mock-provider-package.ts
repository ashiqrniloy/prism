import type { DecisionsProvider, EmbeddingsProvider, ModelProvider, ProviderEvent, ProviderRequest } from "../contracts.js";
import { createMockProvider } from "../mock-provider.js";
import { providerPackage } from "../provider-kit/package.js";
import type { PackageInstance } from "../packages/index.js";

export interface MockProviderPackageOptions {
  /** The provider id a `ModelRef` selects. Default `mock`. */
  readonly id?: string;
  readonly onRequest?: (request: ProviderRequest) => void;
  /** An embeddings adapter behind `prism.models.embeddings(ref)`, for RAG and memory tests. */
  readonly embeddings?: EmbeddingsProvider;
  /** A decisions adapter behind `prism.models.decisions(ref)`, for offline decision tests. */
  readonly decisions?: DecisionsProvider;
}

/**
 * A package that registers a scripted provider. Each `generate` call consumes the next step of `script`;
 * once the script is exhausted the last step repeats, so a one-step script answers every turn alike.
 */
export function mockProvider(
  script: readonly (readonly ProviderEvent[])[] = [[{ type: "done" }]],
  options: MockProviderPackageOptions = {},
): PackageInstance {
  const steps = script.length > 0 ? script : [[{ type: "done" } as const]];
  let turn = 0;
  const provider: ModelProvider = {
    id: options.id ?? "mock",
    ...(options.embeddings === undefined ? {} : { embeddings: () => options.embeddings! }),
    ...(options.decisions === undefined ? {} : { decisions: () => options.decisions! }),
    generate(request) {
      const step = steps[Math.min(turn++, steps.length - 1)] ?? [];
      return createMockProvider(step, { id: provider.id, onRequest: options.onRequest }).generate(request);
    },
  };
  return providerPackage(`mock-${provider.id}`, [provider], "Scripted test provider");
}
