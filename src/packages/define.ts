import type { SlotAssignments, SlotName } from "../slots/index.js";
import type {
  PackageDefinition,
  PackageDefinitionInput,
  PackageInput,
  PackageInstance,
  PackageInstanceOptions,
  PackageSource,
} from "./api.js";
import { isCapability } from "./capabilities.js";
import { PackageLoadError } from "./errors.js";
import { type JsonSchema, assertJsonSchemaSupported } from "./schema.js";
import { isValidVersion, parseRange } from "./semver.js";

/** Owners the kernel uses for itself: `AgentConfig.hooks` is `host`, session packs are `kernel`. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["host", "kernel"]);
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const MAX_NAME_LENGTH = 214;
const MAX_NAMES = 256;

const definitions = new WeakSet<object>();
const instances = new WeakSet<object>();

function invalid(name: string | undefined, message: string): never {
  throw new PackageLoadError(
    "definition_invalid",
    `Package${name ? ` ${name}` : ""} definition is invalid: ${message}.`,
    name ? { package: name } : {},
  );
}

function validateName(name: unknown, label: string, owner?: string): asserts name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH || !NPM_NAME.test(name)) {
    invalid(owner, `${label} must be a valid npm package name`);
  }
}

function validate(input: PackageDefinitionInput<any>): void {
  if (typeof input !== "object" || input === null) invalid(undefined, "a definition object is required");
  validateName(input.name, "name");
  const { name } = input;
  if (RESERVED_NAMES.has(name)) invalid(name, `"${name}" is reserved for the kernel`);
  if (typeof input.version !== "string" || !isValidVersion(input.version)) invalid(name, "version must be a semver version");
  if (typeof input.setup !== "function") invalid(name, "setup must be a function");
  if (input.description !== undefined && typeof input.description !== "string") invalid(name, "description must be a string");
  const requires = input.requires;
  if (requires !== undefined) {
    if (typeof requires !== "object" || requires === null) invalid(name, "requires must be an object");
    if (!Number.isInteger(requires.api)) invalid(name, "requires.api is required and must be an integer");
    if (requires.prism !== undefined) {
      if (typeof requires.prism !== "string") invalid(name, "requires.prism must be a semver range");
      try {
        parseRange(requires.prism);
      } catch (error) {
        invalid(name, `requires.prism: ${error instanceof Error ? error.message : "invalid range"}`);
      }
    }
    if (requires.packages !== undefined) {
      if (typeof requires.packages !== "object" || requires.packages === null) invalid(name, "requires.packages must be an object");
      const entries = Object.entries(requires.packages);
      if (entries.length > MAX_NAMES) invalid(name, "requires.packages is too large");
      for (const [dependency, range] of entries) {
        validateName(dependency, `requires.packages key "${String(dependency).slice(0, 32)}"`, name);
        try {
          parseRange(range);
        } catch (error) {
          invalid(name, `requires.packages["${dependency}"]: ${error instanceof Error ? error.message : "invalid range"}`);
        }
      }
    }
    if (requires.services !== undefined) {
      if (
        !Array.isArray(requires.services) ||
        requires.services.length > MAX_NAMES ||
        requires.services.some((s) => typeof s !== "string" || s.length === 0)
      ) {
        invalid(name, "requires.services must be an array of non-empty strings");
      }
    }
  }
  if (input.capabilities !== undefined) {
    if (!Array.isArray(input.capabilities)) invalid(name, "capabilities must be an array");
    for (const capability of input.capabilities) {
      if (!isCapability(capability)) invalid(name, `unknown capability "${String(capability).slice(0, 32)}"`);
    }
  }
  if (input.capabilitiesFor !== undefined) {
    if (typeof input.capabilitiesFor !== "function") invalid(name, "capabilitiesFor must be a function");
    if (input.capabilities === undefined) invalid(name, "capabilitiesFor narrows capabilities, so capabilities must be declared");
  }
  if (input.config !== undefined) {
    // Fails with `config_schema_unsupported` now rather than at the first load.
    try {
      assertJsonSchemaSupported(input.config as JsonSchema);
    } catch (error) {
      if (error instanceof PackageLoadError)
        throw new PackageLoadError(error.code, `Package ${name}: ${error.message}`, {
          package: name,
          ...(error.path ? { path: error.path } : {}),
        });
      throw error;
    }
  }
}

/**
 * Defines a package (roadmap §2.6). The result is callable: `coding({ root })` returns a
 * {@link PackageInstance}, and listing the bare definition uses the schema defaults. The definition is
 * validated eagerly, so a malformed one throws `PackageLoadError` `definition_invalid` here.
 */
export function definePackage<C = Readonly<Record<string, never>>>(input: PackageDefinitionInput<C>): PackageDefinition<C> {
  validate(input);
  const definition = ((config?: Partial<C>, options?: PackageInstanceOptions): PackageInstance => {
    const instance: PackageInstance = Object.freeze({
      definition,
      config: config as Readonly<Record<string, unknown>> | undefined,
      optional: options?.optional === true,
    });
    instances.add(instance);
    return instance;
  }) as PackageDefinition<C>;
  const copy = {
    name: input.name,
    version: input.version,
    description: input.description,
    requires: input.requires === undefined ? undefined : Object.freeze({ ...input.requires }),
    capabilities: input.capabilities === undefined ? undefined : Object.freeze([...input.capabilities]),
    capabilitiesFor: input.capabilitiesFor,
    config: input.config,
    setup: input.setup,
  };
  for (const [key, value] of Object.entries(copy)) {
    if (value !== undefined) Object.defineProperty(definition, key, { value, enumerable: true });
  }
  Object.freeze(definition);
  definitions.add(definition);
  return definition;
}

/**
 * Binds a definition to manifest config and provenance. Only `@arnilo/prism/manifest` calls it; the public
 * `PackageInstanceOptions` has no `source`, so a package cannot claim to come from a manifest.
 */
export function bindManifestInstance(
  definition: PackageDefinition<any>,
  config: Readonly<Record<string, unknown>> | undefined,
  options: { readonly optional: boolean; readonly source: PackageSource },
): PackageInstance {
  if (!definitions.has(definition)) invalid(undefined, "a manifest instance needs a definition made by definePackage");
  const instance: PackageInstance = Object.freeze({
    definition,
    config,
    optional: options.optional,
    source: Object.freeze({ ...options.source }),
  });
  instances.add(instance);
  return instance;
}

/** `AgentConfig.slots` merged over the slots the listed manifest instances assign to their packages. */
export function mergeManifestSlots(inputs: readonly PackageInput[], direct: SlotAssignments | undefined): SlotAssignments | undefined {
  const assigned: Partial<Record<SlotName, string>> = {};
  for (const input of inputs) {
    if (typeof input !== "object" || input === null || !instances.has(input)) continue;
    for (const slot of input.source?.assigns ?? []) assigned[slot] = input.definition.name;
  }
  if (Object.keys(assigned).length === 0) return direct;
  const host = Object.fromEntries(Object.entries(direct ?? {}).filter(([, value]) => value !== undefined));
  return { ...assigned, ...host };
}

/** A `packages` entry as the loader sees it. */
export interface NormalizedPackage {
  readonly definition: PackageDefinition<any>;
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly optional: boolean;
  readonly source?: PackageSource;
}

/** Accepts a definition (defaults) or an instance, and rejects anything `definePackage` did not make. */
export function normalizePackageInput(input: PackageInput): NormalizedPackage {
  if (typeof input === "function" && definitions.has(input)) return { definition: input, config: undefined, optional: false };
  if (typeof input === "object" && input !== null && instances.has(input)) {
    return {
      definition: input.definition,
      config: input.config,
      optional: input.optional,
      ...(input.source ? { source: input.source } : {}),
    };
  }
  throw new PackageLoadError("definition_invalid", "A packages entry must come from definePackage(...) or a package instance.");
}
