import type { JsonObject, JsonValue } from "../contracts.js";
import { PackageLoadError, type PackageLoadErrorCode } from "./errors.js";
import { type JsonSchema, type SchemaError, schemaDefaults, toJsonValue, validateJsonSchema } from "./schema.js";

/** What config resolution needs from a package definition. */
export interface PackageConfigDefinition {
  readonly name: string;
  readonly config?: JsonSchema;
}

/** The config layers for one package, lowest precedence first (defaults come from the schema). */
export interface PackageConfigLayers {
  /** The manifest layer (Phase 4 feeds it). */
  readonly manifest?: unknown;
  /** `AgentConfig.packageConfig[name]`. */
  readonly host?: unknown;
}

export type PackageConfigSource = "default" | "manifest" | "host";

export interface ResolvedPackageConfig {
  /** The merged, validated config with defaults applied. */
  readonly config: JsonObject;
  /** Where each top-level key's value came from. Key names and sources only, never values. */
  readonly sources: Readonly<Record<string, PackageConfigSource>>;
}

/** A package with no schema declares no keys. One shared object, so it compiles once. */
const NO_CONFIG: JsonSchema = { type: "object", properties: {} };

const CODE_BY_RULE: Readonly<Record<SchemaError["rule"], PackageLoadErrorCode>> = {
  type: "config_invalid",
  enum: "config_invalid",
  const: "config_invalid",
  range: "config_invalid",
  length: "config_invalid",
  pattern: "config_invalid",
  required: "config_invalid",
  shape: "config_invalid",
  not_json: "config_invalid",
  unknown_key: "config_unknown_key",
  secret: "secret_literal",
};

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges objects and replaces arrays and scalars, returning a fresh value. */
function merge(base: JsonObject, over: JsonObject): JsonObject {
  const out: Record<string, JsonValue> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = current !== undefined && isObject(current) && isObject(value) ? merge(current, value) : value;
  }
  return out;
}

function layerObject(name: string, label: string, value: unknown): JsonObject {
  if (value === undefined) return {};
  const json = toJsonValue(value);
  if ("error" in json) {
    throw new PackageLoadError(
      "config_invalid",
      `Package ${name} ${label} config${json.error.path === "/" ? "" : ` ${json.error.path}`} ${json.error.message}.`,
      {
        package: name,
        path: json.error.path,
      },
    );
  }
  if (!isObject(json.value))
    throw new PackageLoadError("config_invalid", `Package ${name} ${label} config must be an object.`, { package: name, path: "/" });
  return json.value;
}

/**
 * Resolves one package's config: schema defaults, then the manifest layer, then `packageConfig`,
 * deep-merging objects and replacing arrays, then validates the result. Fails closed with a
 * `PackageLoadError` whose message names the path and rule, never the value.
 *
 * A package with no `config` schema accepts no config: any supplied key is `config_unknown_key`.
 */
export function resolvePackageConfig(definition: PackageConfigDefinition, layers: PackageConfigLayers = {}): ResolvedPackageConfig {
  const { name } = definition;
  const manifest = layerObject(name, "manifest", layers.manifest);
  const host = layerObject(name, "host", layers.host);
  const schema = definition.config ?? NO_CONFIG;
  if (schema.type !== undefined && schema.type !== "object") {
    throw new PackageLoadError("config_schema_unsupported", `Package ${name} config schema must describe an object.`, {
      package: name,
      path: "/",
    });
  }
  let defaults: JsonObject;
  try {
    defaults = schemaDefaults(schema);
  } catch (error) {
    if (error instanceof PackageLoadError)
      throw new PackageLoadError(error.code, `Package ${name}: ${error.message}`, {
        package: name,
        ...(error.path ? { path: error.path } : {}),
      });
    throw error;
  }
  const merged = merge(merge(defaults, manifest), host);
  let result: ReturnType<typeof validateJsonSchema>;
  try {
    result = validateJsonSchema(schema, merged);
  } catch (error) {
    if (error instanceof PackageLoadError)
      throw new PackageLoadError(error.code, `Package ${name}: ${error.message}`, {
        package: name,
        ...(error.path ? { path: error.path } : {}),
      });
    throw error;
  }
  if (!result.ok || result.value === undefined || !isObject(result.value)) {
    const first = result.errors[0] as SchemaError;
    const detail = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new PackageLoadError(CODE_BY_RULE[first.rule], `Package ${name} config is invalid: ${detail}.`, {
      package: name,
      path: first.path,
    });
  }
  const sources: Record<string, PackageConfigSource> = {};
  for (const key of Object.keys(result.value)) {
    sources[key] = Object.hasOwn(host, key) ? "host" : Object.hasOwn(manifest, key) ? "manifest" : "default";
  }
  return { config: result.value, sources };
}
