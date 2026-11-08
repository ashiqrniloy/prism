/**
 * The shared provider-package surface: the pieces every `@arnilo/prism-provider-<vendor>` package
 * repeats verbatim — the ref-only secret property, the base-URL and static-catalog properties, the
 * `SecretSource` wrappers, the `definePackage` envelope, and the named-factory split
 * between factory-only options and validated config.
 *
 * Nothing here is vendor-specific: a package supplies its own config schema, provider factory, and
 * `setup` body (plan 152 follow-up, replacing ~70 hand-copied lines per package).
 */
import type { Capability } from "../packages/capabilities.js";
import type { PackageAPI, PackageDefinition, PackageInstance } from "../packages/api.js";
import { definePackage } from "../packages/define.js";
import type { JsonSchema } from "../packages/schema.js";
import type { Secret } from "../contracts-core/resources.js";
import { CredentialUnavailableError } from "../credentials/errors.js";
import { KERNEL_API_LEVEL, KERNEL_VERSION } from "../version.js";

/** The description every ref-only secret property carries unless a vendor passes its own. */
const DEFAULT_SECRET_REF_DESCRIPTION = "An `env:` or `keyring:` ref the credentials slot resolves. A literal key is rejected.";

/**
 * The `ModelConfig` subset a host may pin in a provider package's `models` config. Every listed key
 * is validated; `metadata` is the escape hatch for anything else.
 */
export const modelEntrySchema: JsonSchema = {
  type: "object",
  properties: {
    provider: { type: "string", minLength: 1 },
    model: { type: "string", minLength: 1 },
    displayName: { type: "string" },
    capabilities: { type: "object", additionalProperties: true },
    limits: { type: "object", additionalProperties: true },
    cost: { type: "object", additionalProperties: true },
    cache: { type: "object", additionalProperties: true },
    compat: { type: "object", additionalProperties: true },
    parameters: { type: "object", additionalProperties: true },
    metadata: { type: "object", additionalProperties: true },
  },
  required: ["provider", "model"],
  additionalProperties: false,
};

/**
 * A ref-only secret config property. `ref` becomes the schema `default`; omit it for an optional
 * credential (Ollama's `apiKey`) so the schema carries no default at all. `description` defaults to
 * the canonical ref sentence; pass one for a vendor-specific field.
 */
export function secretRefProperty(ref?: string, description = DEFAULT_SECRET_REF_DESCRIPTION): JsonSchema {
  return {
    type: "string",
    "x-prism-secret": true,
    ...(ref !== undefined ? { default: ref } : {}),
    description,
  };
}

/** A base-URL config property. */
export function baseUrlProperty(description?: string): JsonSchema {
  return { type: "string", ...(description !== undefined ? { description } : {}) };
}

/** The static-catalog config property; `models()` falls back to discovery or the curated catalog. */
export function modelsProperty(description?: string): JsonSchema {
  return {
    type: "array",
    items: modelEntrySchema,
    ...(description !== undefined ? { description } : {}),
  };
}

/**
 * A lazily resolved secret: the only shape a low-level provider factory, discovery helper, or kit
 * client accepts for a credential. A literal string does not type-check; build one with
 * {@link refSource} / {@link optionalRefSource} from an `env:`/`keyring:` ref.
 */
export type SecretSource = () => Promise<string | undefined>;

/** A `SecretSource` that resolves `ref` through the credentials slot on every call. */
export function refSource(resolve: (ref: string) => Promise<Secret | undefined>, ref: string): () => Promise<string> {
  return async () => {
    const secret = await resolve(ref);
    if (secret === undefined || secret.value === "") throw new CredentialUnavailableError(ref);
    return secret.value;
  };
}

/** An optional ref: an unresolved credential is `undefined`, never an error. */
export function optionalRefSource(resolve: (ref: string) => Promise<Secret | undefined>, ref: string): () => Promise<string | undefined> {
  return async () => {
    const secret = await resolve(ref);
    return secret?.value === "" ? undefined : secret?.value;
  };
}

export interface ProviderPackageDefinitionSpec<Config> {
  /** npm name, e.g. `@arnilo/prism-provider-hyper`. */
  readonly name: string;
  /** One line, shown in `agent.inspect()`. */
  readonly description: string;
  /** Validated config schema. Build it from {@link secretRefProperty} / {@link baseUrlProperty} / {@link modelsProperty}. */
  readonly config: JsonSchema;
  /** Capabilities to declare. Defaults to `["credentials"]`; pass `[]` for a package that resolves none. */
  readonly capabilities?: readonly Capability[];
  /** Registers this package's providers. Runs once per loaded instance. */
  setup(prism: PackageAPI<Config>): void | Promise<void>;
}

/**
 * `definePackage` with the provider-package envelope: the kernel version, the `prism` requirement,
 * and the `credentials` capability. Vendor-specific behavior stays in `config` and `setup`.
 */
export function defineProviderPackage<Config extends object = Readonly<Record<string, never>>>(
  spec: ProviderPackageDefinitionSpec<Config>,
): PackageDefinition<Config> {
  return definePackage<Config>({
    name: spec.name,
    version: KERNEL_VERSION,
    description: spec.description,
    requires: { api: KERNEL_API_LEVEL },
    capabilities: spec.capabilities ?? ["credentials"],
    config: spec.config,
    setup: spec.setup,
  });
}

/**
 * The named factory every provider package exports: splits `factoryKeys` (non-JSON options such as
 * `id`, `fetch`, `userAgent`, `oauth`, a host model) out of the validated config, and picks the
 * per-instance definition only when at least one factory option is set.
 */
export function providerPackageInstance<Config extends object, Options extends object>(
  definition: PackageDefinition<Config>,
  definitionFor: (options: Options) => PackageDefinition<Config>,
  factoryKeys: readonly (keyof Options & string)[],
  options: Options & Config,
): PackageInstance {
  const factory: Record<string, unknown> = {};
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if ((factoryKeys as readonly string[]).includes(key)) {
      // An explicitly undefined factory option is "not set", matching the hand-written split.
      if (value !== undefined) factory[key] = value;
    } else {
      config[key] = value;
    }
  }
  const target = Object.keys(factory).length === 0 ? definition : definitionFor(factory as Options);
  return target(config as Partial<Config>);
}
