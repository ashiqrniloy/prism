import type { AIProvider, ModelConfig, ProviderRequest, ProviderPackage } from "@arnilo/prism";
import { defineProviderPackage, providerError, trimTrailingSlashes } from "@arnilo/prism";
import { httpStatusError, readBoundedResponseJson, readBoundedResponseText } from "@arnilo/prism/providers/transport";
import { createOpenAICompatibleProvider } from "@arnilo/prism/providers/openai-compatible";
import { openAICompatThinkingExtra } from "../shared/openai-compat.js";
import { bedrockConverseBody, bedrockConverseResponseEvents, bedrockConverseStreamEvents } from "./converse.js";
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
  /** Route to register: `compatible` (OpenAI-compatible `/openai/v1`) or native `converse`. Default `compatible`. */
  readonly api?: BedrockRoute;
  /** Native Converse only: use `ConverseStream` (default) or the non-streaming `Converse` operation. */
  readonly stream?: boolean;
  readonly models?: readonly ModelConfig[];
}

export type BedrockRoute = "compatible" | "converse";

/** Hard byte ceiling for one non-streaming `Converse` response body (streaming frames have their own cap). */
export const BEDROCK_CONVERSE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

export interface BedrockConverseProviderOptions extends BedrockProviderOptions {
  /** `true` (default) streams `ConverseStream`; `false` performs one non-streaming `Converse` call. */
  readonly stream?: boolean;
}

interface BedrockSignedTransport {
  readonly endpoint: string;
  readonly region: string;
  readonly fetch: typeof fetch;
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
  const transport = bedrockSignedTransport(options);

  return createOpenAICompatibleProvider({
    id: options.id ?? "bedrock",
    baseUrl: `${transport.endpoint}/openai/v1`,
    authStyle: "none",
    fetch: transport.fetch,
    buildBodyExtra: openAICompatThinkingExtra,
  });
}

/** Resolve region/endpoint once and build a SigV4-signing fetch over the host transport. */
function bedrockSignedTransport(options: BedrockProviderOptions): BedrockSignedTransport {
  const region = options.region.trim();
  if (!region) throw new Error("Bedrock region is required");
  const endpoint = bedrockRuntimeEndpoint(region, options.endpoint);
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

  return { endpoint, region, fetch: signedFetch };
}

/**
 * Native `Converse` route: Prism messages/tools/media/cache/structured-output map to
 * the model-agnostic Converse body, and `ConverseStream` frames (AWS event stream) map
 * back to Prism provider events. The OpenAI-compatible route stays available and explicit.
 */
export function createBedrockConverseProvider(options: BedrockConverseProviderOptions): AIProvider {
  const id = options.id ?? "bedrock";
  const stream = options.stream ?? true;
  const transport = bedrockSignedTransport(options);

  return {
    id,
    async *generate(request: ProviderRequest) {
      if (request.signal?.aborted) throw request.signal.reason ?? new Error("aborted");
      const secrets: (string | undefined)[] = [];
      try {
        assertRouteCapabilities(request, stream);
        const body = await bedrockConverseBody(request);
        const credentials = await resolveAwsCredentials(options.credential);
        secrets.push(credentials.accessKeyId, credentials.secretAccessKey, credentials.sessionToken);
        const url = `${transport.endpoint}/model/${encodeURIComponent(request.model.model)}/converse${stream ? "-stream" : ""}`;
        const response = await transport.fetch(url, {
          method: "POST",
          headers: {
            ...request.options?.headers,
            "content-type": "application/json",
            accept: stream ? "application/vnd.amazon.eventstream" : "application/json",
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
        if (!response.ok) {
          yield providerError(
            httpStatusError("Bedrock Converse request failed", response, await readBoundedResponseText(response, { secrets })),
            secrets,
          );
          return;
        }
        if (stream) {
          if (!response.body) {
            yield providerError(new Error("Bedrock ConverseStream response had no body"), secrets);
            return;
          }
          yield* bedrockConverseStreamEvents(response.body, request.signal);
          return;
        }
        const payload = await readBoundedResponseJson(response, { secrets, maxResponseBodyBytes: BEDROCK_CONVERSE_RESPONSE_MAX_BYTES });
        for (const event of bedrockConverseResponseEvents(payload)) yield event;
      } catch (error) {
        yield providerError(error, secrets);
      }
    },
  };
}

/** Denied/unknown model capabilities reject before any request leaves the process. */
function assertRouteCapabilities(request: ProviderRequest, stream: boolean): void {
  const capabilities = request.model.capabilities ?? {};
  const model = `${request.model.provider}/${request.model.model}`;
  if (stream && capabilities.streaming === false) {
    throw new Error(`Model ${model} declares streaming: false; refusing ConverseStream (use stream: false)`);
  }
  if (request.tools && request.tools.length > 0 && capabilities.tools === false) {
    throw new Error(`Model ${model} declares tools: false but the request carries ${request.tools.length} tool(s)`);
  }
}

export function createBedrockProviderPackage(options: BedrockProviderPackageOptions): ProviderPackage {
  const endpoint = bedrockRuntimeEndpoint(options.region, options.endpoint);
  const api: BedrockRoute = options.api ?? "compatible";
  const id = options.id ?? "bedrock";
  return defineProviderPackage({
    name: "@arnilo/prism-providers/bedrock",
    description: "Amazon Bedrock enterprise provider for Prism.",
    docs: { links: ["docs/providers/bedrock.md"] },
    metadata: { route: api, ...(api === "converse" ? { stream: options.stream ?? true } : {}) },
    setup(providerApi) {
      providerApi.registerProvider(
        api === "converse" ? createBedrockConverseProvider({ ...options, id }) : createBedrockProvider({ ...options, id }),
      );
      for (const model of options.models ?? []) {
        providerApi.registerModel({ ...model, provider: id });
      }
      providerApi.registerAuthMethod({
        kind: "api_key",
        provider: id,
        credentialName: "credential",
        metadata: {
          region: options.region,
          endpoint,
          route: api,
          ...(api === "converse" ? { stream: options.stream ?? true } : {}),
          note:
            api === "converse"
              ? "Host supplies IAM/IRSA credentials; package signs native bedrock-runtime Converse requests."
              : "Host supplies IAM/IRSA credentials; package signs bedrock-runtime requests.",
        },
      });
    },
  });
}

export { type AwsCredentials, signAwsRequest } from "./sigv4.js";
