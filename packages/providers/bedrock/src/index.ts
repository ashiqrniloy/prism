/**
 * `@arnilo/prism-provider-bedrock` — the Amazon Bedrock provider package.
 *
 * ```ts
 * import bedrock from "@arnilo/prism-provider-bedrock";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0",
 *   packages: [bedrock({
 *     region: "us-east-1",
 *     accessKeyId: "env:AWS_ACCESS_KEY_ID",
 *     secretAccessKey: "env:AWS_SECRET_ACCESS_KEY",
 *   })],
 * });
 * ```
 *
 * The AWS credentials are refs (`env:`/`keyring:`), never values: they resolve through the
 * credentials slot on every request, so rotated or assumed-role credentials are picked up without
 * rebuilding the provider, and both halves join the agent's redaction set. A host that owns
 * credential resolution (SSO profile, IRSA, instance role, assumed role) passes its own
 * `credential` callback instead — the factory-only seam — and the refs are not read at all. A ref
 * that resolves to nothing records a `warn` status note and registers the provider anyway; a run
 * then fails with `credential_unavailable`.
 *
 * Two routes: `compatible` (default) rides the OpenAI-compatible `/openai/v1` surface, `converse`
 * uses the native model-agnostic Converse/ConverseStream operations.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import {
  defineProviderPackage,
  modelsProperty,
  optionalRefSource,
  providerPackageInstance,
  refSource,
  secretRefProperty,
} from "@arnilo/prism/provider-kit";

import {
  type AwsCredentials,
  type BedrockCredentialSource,
  type BedrockRoute,
  bedrockRuntimeEndpoint,
  createBedrockConverseProvider,
  createBedrockProvider,
  signAwsRequest,
} from "./provider.js";

export {
  bedrockConverseBody,
  bedrockConverseResponseEvents,
  bedrockConverseStreamEvents,
  bedrockPreserveThinking,
  bedrockReasoningBlocks,
  BEDROCK_THINKING_DEFAULT_BUDGET,
} from "./converse.js";
export {
  type AwsEventStreamErrorCode,
  AwsEventStreamError,
  type AwsEventStreamHeaderValue,
  type AwsEventStreamMessage,
  crc32,
  DEFAULT_MAX_FRAME_BYTES,
  eventStreamHeader,
  HARD_MAX_FRAME_BYTES,
  type ReadAwsEventStreamOptions,
  readAwsEventStream,
} from "./eventstream.js";
export {
  type AwsCredentials,
  type BedrockConverseProviderOptions,
  BEDROCK_CONVERSE_RESPONSE_MAX_BYTES,
  type BedrockCredentialSource,
  type BedrockProviderOptions,
  type BedrockRoute,
  bedrockRuntimeEndpoint,
  createBedrockConverseProvider,
  createBedrockProvider,
  type SignAwsRequestInput,
  signAwsRequest,
} from "./provider.js";

/** The `accessKeyId` ref used when config names none. */
export const BEDROCK_DEFAULT_ACCESS_KEY_ID_REF = "env:AWS_ACCESS_KEY_ID";
/** The `secretAccessKey` ref used when config names none. */
export const BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF = "env:AWS_SECRET_ACCESS_KEY";
/** The `sessionToken` ref used when config names none; an unresolved session token means "none". */
export const BEDROCK_DEFAULT_SESSION_TOKEN_REF = "env:AWS_SESSION_TOKEN";

export interface BedrockProviderPackageOptions {
  /** Provider id; defaults to `bedrock`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
  /** Optional host signer; defaults to the package-local SigV4 for bedrock-runtime. */
  readonly signRequest?: typeof signAwsRequest;
  /**
   * Host-resolved AWS credentials (SSO profile, IRSA, instance role, assumed role). When set, the
   * `accessKeyId`/`secretAccessKey`/`sessionToken` refs are not read.
   */
  readonly credential?: BedrockCredentialSource;
}

/** The config a host (or a code instance) may set; every credential field is a ref, never a value. */
export interface BedrockProviderConfig {
  /** AWS region (also used for residency checks via model-router). Required at setup. */
  readonly region?: string;
  /** An `env:`/`keyring:` ref; defaults to {@link BEDROCK_DEFAULT_ACCESS_KEY_ID_REF}. */
  readonly accessKeyId?: string;
  /** An `env:`/`keyring:` ref; defaults to {@link BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF}. */
  readonly secretAccessKey?: string;
  /** An `env:`/`keyring:` ref; defaults to {@link BEDROCK_DEFAULT_SESSION_TOKEN_REF}. Unresolved means "none". */
  readonly sessionToken?: string;
  /** Optional PrivateLink / VPC interface endpoint base URL; https only. Host and path are preserved. */
  readonly endpoint?: string;
  /** Route to register: `compatible` (OpenAI-compatible `/openai/v1`) or native `converse`. Default `compatible`. */
  readonly api?: BedrockRoute;
  /** Native Converse only: use `ConverseStream` (default) or the non-streaming `Converse` operation. */
  readonly stream?: boolean;
  /** Static catalog. Bedrock model ids are region- and account-scoped, so this is the listing. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    region: { type: "string", minLength: 1, description: "AWS region, e.g. us-east-1." },
    accessKeyId: secretRefProperty(BEDROCK_DEFAULT_ACCESS_KEY_ID_REF, "An `env:` or `keyring:` ref the credentials slot resolves."),
    secretAccessKey: secretRefProperty(BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF, "An `env:` or `keyring:` ref the credentials slot resolves."),
    sessionToken: secretRefProperty(
      BEDROCK_DEFAULT_SESSION_TOKEN_REF,
      "Optional STS session token ref; an unresolved ref means the credential has no session token.",
    ),
    endpoint: { type: "string", description: "Optional PrivateLink / VPC endpoint base URL; must be https." },
    api: { type: "string", enum: ["compatible", "converse"], description: "OpenAI-compatible route (default) or native Converse." },
    stream: { type: "boolean", description: "Native Converse only: stream ConverseStream (default true) or one Converse call." },
    models: modelsProperty("Static catalog; Bedrock model ids are region- and account-scoped."),
  },
  // `region` is checked in setup rather than declared required: a config schema whose defaults
  // cannot validate would fail package conformance, and the setup error is clearer.
  additionalProperties: false,
};

function definitionFor(options: BedrockFactoryOptions) {
  return defineProviderPackage<BedrockProviderConfig>({
    name: "@arnilo/prism-provider-bedrock",
    description: "Amazon Bedrock provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "bedrock";
      const region = prism.config.region;
      // Fail closed on a missing region or malformed endpoint before any request.
      if (typeof region !== "string" || !region.trim()) throw new Error("bedrock: config needs region");
      bedrockRuntimeEndpoint(region, prism.config.endpoint);
      const resolve = (target: string) => prism.credentials.resolve(target);
      let credential: BedrockCredentialSource;
      if (options.credential !== undefined) {
        credential = options.credential;
      } else {
        const accessKeyRef = prism.config.accessKeyId ?? BEDROCK_DEFAULT_ACCESS_KEY_ID_REF;
        const secretKeyRef = prism.config.secretAccessKey ?? BEDROCK_DEFAULT_SECRET_ACCESS_KEY_REF;
        const sessionTokenRef = prism.config.sessionToken ?? BEDROCK_DEFAULT_SESSION_TOKEN_REF;
        const accessKeyId = refSource(resolve, accessKeyRef);
        const secretAccessKey = refSource(resolve, secretKeyRef);
        const sessionToken = optionalRefSource(resolve, sessionTokenRef);
        // Register regardless: a credential problem must not turn into `Unknown provider`, and the
        // catalog should still list. One note per unresolved half; both join the redaction set.
        if ((await resolve(accessKeyRef)) === undefined) prism.status.note("warn", `bedrock: no accessKeyId at ${accessKeyRef}`);
        if ((await resolve(secretKeyRef)) === undefined) prism.status.note("warn", `bedrock: no secretAccessKey at ${secretKeyRef}`);
        credential = async (): Promise<AwsCredentials> => {
          const key = await accessKeyId();
          const secret = await secretAccessKey();
          const token = await sessionToken();
          return { accessKeyId: key, secretAccessKey: secret, ...(token ? { sessionToken: token } : {}) };
        };
      }
      const base = { id, region, endpoint: prism.config.endpoint, credential, fetch: options.fetch, signRequest: options.signRequest };
      const provider =
        (prism.config.api ?? "compatible") === "converse"
          ? createBedrockConverseProvider({ ...base, stream: prism.config.stream })
          : createBedrockProvider(base);
      const configured = prism.config.models;
      prism.providers.register({
        ...provider,
        async models() {
          return configured ?? [];
        },
      });
    },
  });
}

const definition = definitionFor({});

/** Default package. Pass config through `packageConfig` or `bedrock({ ... })`. */
export default definition;

/** Factory-only options: `id`, `fetch`, `signRequest`, `credential`. Credential config stays JSON refs. */
export type BedrockFactoryOptions = Pick<BedrockProviderPackageOptions, "id" | "fetch" | "signRequest" | "credential">;

/** Instance with factory-only options; `region`/`accessKeyId`/`secretAccessKey`/`endpoint`/`api` are validated config. */
export function bedrock(options: BedrockProviderPackageOptions & BedrockProviderConfig): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch", "signRequest", "credential"], options);
}
