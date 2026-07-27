import type { AIProvider, CredentialValueSource, ModelConfig, ProviderPackage } from "@arnilo/prism";
import { defineProviderPackage, providerError, resolveCredentialValue } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";

export interface VertexProviderOptions {
  readonly id?: string;
  readonly projectId: string;
  /** Vertex location / region (e.g. `us-central1`). Preserved for residency. */
  readonly location: string;
  /**
   * Optional full OpenAPI-compatible base URL (private / custom endpoint).
   * When omitted: `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/endpoints/openapi`
   */
  readonly endpoint?: string;
  /**
   * Host ADC / workload identity token callback. Separate from
   * `@arnilo/prism-provider-google` API-key auth.
   */
  readonly credential?: CredentialValueSource;
  readonly fetch?: typeof fetch;
}

export interface VertexProviderPackageOptions extends VertexProviderOptions {
  readonly models?: readonly ModelConfig[];
}

export function vertexOpenApiBaseUrl(input: { readonly projectId: string; readonly location: string; readonly endpoint?: string }): string {
  if (input.endpoint !== undefined) {
    if (!input.endpoint.trim()) throw new Error("Vertex endpoint must be non-empty when provided");
    try {
      const url = new URL(input.endpoint);
      if (url.protocol !== "https:") throw new Error("Vertex endpoint must be https");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Vertex")) throw error;
      throw new Error("Vertex endpoint must be an absolute https URL");
    }
    return input.endpoint.replace(/\/$/, "");
  }
  if (!input.projectId.trim()) throw new Error("Vertex projectId is required");
  if (!input.location.trim()) throw new Error("Vertex location is required");
  return `https://${input.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(input.projectId)}/locations/${encodeURIComponent(input.location)}/endpoints/openapi`;
}

export function createVertexProvider(options: VertexProviderOptions): AIProvider {
  const baseUrl = vertexOpenApiBaseUrl(options);
  const id = options.id ?? "vertex";
  const inner = createOpenAICompatibleProvider({
    id,
    baseUrl,
    apiKey: options.credential,
    authStyle: "bearer",
    fetch: options.fetch,
  });
  return {
    id,
    async *generate(request) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const token = await resolveCredentialValue(options.credential, { provider: id, name: "credential" });
      if (!token?.trim()) {
        yield providerError(new Error("Vertex ADC credential missing"), []);
        return;
      }
      yield* inner.generate(request);
    },
  };
}

export function createVertexProviderPackage(options: VertexProviderPackageOptions): ProviderPackage {
  const baseUrl = vertexOpenApiBaseUrl(options);
  return defineProviderPackage({
    name: "@arnilo/prism-provider-vertex",
    description: "Google Vertex AI enterprise provider for Prism.",
    docs: { links: ["docs/providers/vertex.md"] },
    setup(api) {
      api.registerProvider(createVertexProvider(options));
      for (const model of options.models ?? []) {
        api.registerModel({ ...model, provider: options.id ?? "vertex" });
      }
      api.registerAuthMethod({
        kind: "api_key",
        provider: options.id ?? "vertex",
        credentialName: "credential",
        metadata: {
          projectId: options.projectId,
          location: options.location,
          endpoint: baseUrl,
          note: "Host supplies ADC/workload token; distinct from @arnilo/prism-provider-google API keys.",
        },
      });
    },
  });
}
