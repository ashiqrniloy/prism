/**
 * `@arnilo/prism-provider-vertex` — the Google Vertex AI provider package.
 *
 * ```ts
 * import vertex from "@arnilo/prism-provider-vertex";
 * import { createAgent } from "@arnilo/prism";
 *
 * const agent = await createAgent({
 *   model: "vertex/google/gemini-2.5-flash",
 *   packages: [vertex({
 *     project: "my-project",
 *     location: "us-central1",
 *     credential: "env:PRISM_VERTEX_ACCESS_TOKEN",
 *   })],
 * });
 * ```
 *
 * Vertex rides the location-scoped OpenAPI-compatible endpoint, so the host's ADC decides the
 * credential: the package resolves the `credential` ref through the credentials slot on every
 * request and hands the resolved bearer token to the OpenAI-compatible wire. It never reads a
 * service-account file itself — a host that owns ADC passes the pre-minted token (or its own
 * `CredentialValueSource`) instead. A ref that resolves to nothing records a `warn` status note and
 * registers the provider anyway; a run then fails with `credential_unavailable`.
 */
import { type JsonSchema, type ModelConfig, type PackageInstance } from "@arnilo/prism";
import { defineProviderPackage, modelsProperty, providerPackageInstance, refSource, secretRefProperty } from "@arnilo/prism/provider-kit";

import { createVertexProvider, vertexOpenApiBaseUrl } from "./provider.js";

export {
  createVertexProvider,
  type VertexProviderOptions,
  vertexOpenApiBaseUrl,
} from "./provider.js";

/** The `credential` ref used when config names none: an ADC bearer token, never a key file path. */
export const VERTEX_DEFAULT_CREDENTIAL_REF = "env:PRISM_VERTEX_ACCESS_TOKEN";

export interface VertexProviderPackageOptions {
  /** Provider id; defaults to `vertex`. */
  readonly id?: string;
  /** Test seam: the transport every request uses. */
  readonly fetch?: typeof fetch;
}

/** The config a host (or a code instance) may set; `credential` is a ref, never a value. */
export interface VertexProviderConfig {
  /** Google Cloud project id. Required at setup. */
  readonly project?: string;
  /** Vertex location / region (e.g. `us-central1`); preserved for residency. Required at setup. */
  readonly location?: string;
  /** Optional full OpenAPI-compatible base URL (private / custom endpoint); https only. */
  readonly endpoint?: string;
  /** An `env:`/`keyring:` ref resolving to a bearer access token; defaults to {@link VERTEX_DEFAULT_CREDENTIAL_REF}. */
  readonly credential?: string;
  /** Static catalog. Vertex publishes no unauthenticated `/models` route, so this is the listing. */
  readonly models?: readonly ModelConfig[];
}

const configSchema: JsonSchema = {
  type: "object",
  properties: {
    project: { type: "string", minLength: 1, description: "Google Cloud project id." },
    location: { type: "string", minLength: 1, description: "Vertex location / region (e.g. us-central1)." },
    endpoint: {
      type: "string",
      description: "Optional full OpenAPI-compatible base URL (private endpoint); must be https.",
    },
    credential: secretRefProperty(
      VERTEX_DEFAULT_CREDENTIAL_REF,
      "An `env:` or `keyring:` ref the credentials slot resolves to a bearer access token.",
    ),
    models: modelsProperty("Static catalog; Vertex publishes no unauthenticated model listing."),
  },
  // `project` and `location` are checked in setup rather than declared required: a config schema
  // whose defaults cannot validate would fail package conformance, and the setup error is clearer.
  additionalProperties: false,
};

function definitionFor(options: VertexFactoryOptions) {
  return defineProviderPackage<VertexProviderConfig>({
    name: "@arnilo/prism-provider-vertex",
    description: "Google Vertex AI provider package for Prism.",
    config: configSchema,
    setup: async (prism) => {
      const id = options.id ?? "vertex";
      const { project, location, endpoint } = prism.config;
      // Fail closed on a missing or malformed field before any request; the message names the field.
      if (typeof project !== "string" || !project.trim()) throw new Error("vertex: config needs project");
      if (typeof location !== "string" || !location.trim()) throw new Error("vertex: config needs location");
      vertexOpenApiBaseUrl({ projectId: project, location, endpoint });
      const ref = prism.config.credential ?? VERTEX_DEFAULT_CREDENTIAL_REF;
      const resolve = (target: string) => prism.credentials.resolve(target);
      const credential = refSource(resolve, ref);
      // Register regardless: a credential problem must not turn into `Unknown provider`. The note is
      // what a host shows the user, and the resolved token joins the redaction set.
      if ((await resolve(ref)) === undefined) prism.status.note("warn", `vertex: no credential at ${ref}`);
      const provider = createVertexProvider({
        id,
        projectId: project,
        location,
        endpoint,
        credential,
        fetch: options.fetch,
      });
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

/** Default package. Pass config through `packageConfig` or `vertex({ ... })`. */
export default definition;

/** Factory-only options: `id`, `fetch`. Credential config stays JSON. */
export type VertexFactoryOptions = Pick<VertexProviderPackageOptions, "id" | "fetch">;

/** Instance with factory-only options; `project`/`location`/`endpoint`/`credential`/`models` are validated config. */
export function vertex(options: VertexProviderPackageOptions & VertexProviderConfig): PackageInstance {
  return providerPackageInstance(definition, definitionFor, ["id", "fetch"], options);
}
