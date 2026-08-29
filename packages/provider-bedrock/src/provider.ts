import type { AIProvider, ModelConfig, ProviderPackage } from "@arnilo/prism";
import { defineProviderPackage, trimTrailingSlashes } from "@arnilo/prism";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
import { type AwsCredentials, signAwsRequest } from "./sigv4.js";

export type BedrockCredentialSource = AwsCredentials | (() => AwsCredentials | Promise<AwsCredentials>);

export interface BedrockProviderOptions {
  readonly id?: string;
  /** AWS region (also used for residency checks via model-router). */
  readonly region: string;
  /**
   * Optional PrivateLink / VPC interface endpoint base URL.
   * When omitted, uses `https://bedrock-runtime.{region}.amazonaws.com`.
   * Host/path are preserved — package never rewrites private endpoints to public DNS.
   */
  readonly endpoint?: string;
  /** Host IRSA / instance-role / assumed-role credentials (late-bound). */
  readonly credential: BedrockCredentialSource;
  readonly fetch?: typeof fetch;
  /** Optional host signer; defaults to package-local SigV4 for bedrock-runtime. */
  readonly signRequest?: typeof signAwsRequest;
}

export interface BedrockProviderPackageOptions extends BedrockProviderOptions {
  readonly models?: readonly ModelConfig[];
}

async function resolveAwsCredentials(source: BedrockCredentialSource): Promise<AwsCredentials> {
  const value = typeof source === "function" ? await source() : source;
  if (!value?.accessKeyId?.trim() || !value?.secretAccessKey?.trim()) {
    throw new Error("Bedrock AWS credentials missing");
  }
  return value;
}

export function bedrockRuntimeEndpoint(region: string, endpoint?: string): string {
  if (!region.trim()) throw new Error("Bedrock region is required");
  if (endpoint !== undefined) {
    if (!endpoint.trim()) throw new Error("Bedrock endpoint must be non-empty when provided");
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:") throw new Error("Bedrock endpoint must be https");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Bedrock")) throw error;
      throw new Error("Bedrock endpoint must be an absolute https URL");
    }
    return trimTrailingSlashes(endpoint);
  }
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

export function createBedrockProvider(options: BedrockProviderOptions): AIProvider {
  const region = options.region.trim();
  if (!region) throw new Error("Bedrock region is required");
  const endpoint = bedrockRuntimeEndpoint(region, options.endpoint);
  const id = options.id ?? "bedrock";
  const sign = options.signRequest ?? signAwsRequest;
  const fetchImpl = options.fetch ?? fetch;

  const signedFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "POST";
    const body = typeof init?.body === "string" ? init.body : "";
    const baseHeaders: Record<string, string> = {};
    const incoming = init?.headers;
    if (incoming instanceof Headers) {
      incoming.forEach((value, key) => {
        baseHeaders[key] = value;
      });
    } else if (Array.isArray(incoming)) {
      for (const [key, value] of incoming) baseHeaders[key] = value;
    } else if (incoming) {
      Object.assign(baseHeaders, incoming);
    }
    const credentials = await resolveAwsCredentials(options.credential);
    const signed = sign({
      method,
      url,
      headers: baseHeaders,
      body,
      region,
      service: "bedrock",
      credentials,
    });
    return fetchImpl(url, { ...init, method, headers: signed, body });
  };

  return createOpenAICompatibleProvider({
    id,
    baseUrl: `${endpoint}/openai/v1`,
    authStyle: "none",
    fetch: signedFetch,
  });
}

export function createBedrockProviderPackage(options: BedrockProviderPackageOptions): ProviderPackage {
  const endpoint = bedrockRuntimeEndpoint(options.region, options.endpoint);
  return defineProviderPackage({
    name: "@arnilo/prism-provider-bedrock",
    description: "Amazon Bedrock enterprise provider for Prism.",
    docs: { links: ["docs/providers/bedrock.md"] },
    setup(api) {
      api.registerProvider(createBedrockProvider(options));
      for (const model of options.models ?? []) {
        api.registerModel({ ...model, provider: options.id ?? "bedrock" });
      }
      api.registerAuthMethod({
        kind: "api_key",
        provider: options.id ?? "bedrock",
        credentialName: "credential",
        metadata: {
          region: options.region,
          endpoint,
          note: "Host supplies IAM/IRSA credentials; package signs bedrock-runtime requests.",
        },
      });
    },
  });
}

export { type AwsCredentials, signAwsRequest } from "./sigv4.js";
