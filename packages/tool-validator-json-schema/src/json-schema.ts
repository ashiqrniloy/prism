import { Ajv, type ValidateFunction } from "ajv";
import type { JsonObject, ToolArgumentValidationResult, ToolArgumentValidator, ToolValidator } from "@arnilo/prism";
import { createToolParameterValidator } from "@arnilo/prism";

export interface JsonSchemaToolValidatorOptions {
  /** When a tool omits `parameters`. Default `"allow"`. */
  readonly missingSchema?: "allow" | "reject";
  /** Maximum validation errors returned per call. Default `8`, hard cap `64`. */
  readonly maxErrors?: number;
  /** Maximum nested depth when walking argument values. Default `64`, hard cap `128`. */
  readonly maxDepth?: number;
  /** Maximum own properties per object when walking argument values. Default `1_000`, hard cap `100_000`. */
  readonly maxProperties?: number;
  /** Maximum string length when walking argument values. Default `1_000_000`, hard cap `8_000_000`. */
  readonly maxStringLength?: number;
  /** Maximum array length when walking argument values. Default `10_000`, hard cap `100_000`. */
  readonly maxArrayLength?: number;
  /** Maximum serialized schema bytes before compilation. Default `262_144`, hard cap `1_048_576`. */
  readonly maxSchemaBytes?: number;
  /** Maximum schema nesting depth before compilation. Default `64`, hard cap `128`. */
  readonly maxSchemaDepth?: number;
  /** Maximum schema object properties before compilation. Default `10_000`, hard cap `100_000`. */
  readonly maxSchemaProperties?: number;
  /** Maximum `$ref` keywords before compilation. Default `128`, hard cap `1_024`. */
  readonly maxSchemaRefs?: number;
  /** Maximum schema keywords before compilation. Default `10_000`, hard cap `100_000`. */
  readonly maxSchemaKeywords?: number;
  /** Maximum compiled schemas retained in LRU cache. Default `256`, hard cap `1_024`. */
  readonly maxCompiledSchemas?: number;
}

interface ResolvedBounds {
  readonly maxErrors: number;
  readonly maxDepth: number;
  readonly maxProperties: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxSchemaBytes: number;
  readonly maxSchemaDepth: number;
  readonly maxSchemaProperties: number;
  readonly maxSchemaRefs: number;
  readonly maxSchemaKeywords: number;
  readonly maxCompiledSchemas: number;
}

const DEFAULT_BOUNDS: ResolvedBounds = {
  maxErrors: 8,
  maxDepth: 64,
  maxProperties: 1_000,
  maxStringLength: 1_000_000,
  maxArrayLength: 10_000,
  maxSchemaBytes: 256 * 1024,
  maxSchemaDepth: 64,
  maxSchemaProperties: 10_000,
  maxSchemaRefs: 128,
  maxSchemaKeywords: 10_000,
  maxCompiledSchemas: 256,
};

const HARD_BOUNDS: ResolvedBounds = {
  maxErrors: 64,
  maxDepth: 128,
  maxProperties: 100_000,
  maxStringLength: 8 * 1024 * 1024,
  maxArrayLength: 100_000,
  maxSchemaBytes: 1024 * 1024,
  maxSchemaDepth: 128,
  maxSchemaProperties: 100_000,
  maxSchemaRefs: 1_024,
  maxSchemaKeywords: 100_000,
  maxCompiledSchemas: 1_024,
};

function resolveBounds(options?: JsonSchemaToolValidatorOptions): ResolvedBounds {
  const resolve = (key: keyof ResolvedBounds) => positiveLimit(options?.[key], DEFAULT_BOUNDS[key], HARD_BOUNDS[key], key);
  return {
    maxErrors: resolve("maxErrors"),
    maxDepth: resolve("maxDepth"),
    maxProperties: resolve("maxProperties"),
    maxStringLength: resolve("maxStringLength"),
    maxArrayLength: resolve("maxArrayLength"),
    maxSchemaBytes: resolve("maxSchemaBytes"),
    maxSchemaDepth: resolve("maxSchemaDepth"),
    maxSchemaProperties: resolve("maxSchemaProperties"),
    maxSchemaRefs: resolve("maxSchemaRefs"),
    maxSchemaKeywords: resolve("maxSchemaKeywords"),
    maxCompiledSchemas: resolve("maxCompiledSchemas"),
  };
}

function positiveLimit(value: number | undefined, fallback: number, hardCap: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > hardCap) {
    throw new RangeError(`${label} must be a positive safe integer no greater than ${hardCap}`);
  }
  return resolved;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeJsonKey(key: string): boolean {
  return key !== "__proto__" && key !== "prototype" && key !== "constructor";
}

function jsonBytes(value: string | number | boolean | null): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Validates untrusted schema shape before Ajv parses or compiles it. */
function assertSchemaBounds(schema: unknown, bounds: ResolvedBounds): void {
  let bytes = 0;
  let properties = 0;
  let refs = 0;
  let keywords = 0;
  const active = new Set<object>();

  const addBytes = (count: number) => {
    bytes += count;
    if (bytes > bounds.maxSchemaBytes) throw new Error(`schema exceeds maximum bytes ${bounds.maxSchemaBytes}`);
  };
  function walk(value: unknown, path: string, depth: number): void {
    if (depth > bounds.maxSchemaDepth) throw new Error(`${path}: exceeds maximum schema depth ${bounds.maxSchemaDepth}`);
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      addBytes(jsonBytes(value));
      return;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`${path}: schema number must be finite`);
      addBytes(jsonBytes(value));
      return;
    }
    if (Array.isArray(value)) {
      if (active.has(value)) throw new Error(`${path}: schema contains a cycle`);
      active.add(value);
      addBytes(2);
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) addBytes(1);
        walk(value[index], `${path}[${index}]`, depth + 1);
      }
      active.delete(value);
      return;
    }
    if (!isPlainObject(value)) throw new Error(`${path}: schema must be JSON-serializable`);
    if (active.has(value)) throw new Error(`${path}: schema contains a cycle`);
    active.add(value);
    addBytes(2);
    let index = 0;
    for (const key of Object.keys(value)) {
      if (!isSafeJsonKey(key)) throw new Error(`${path}.${key} uses forbidden JSON key: ${key}`);
      if (index++ > 0) addBytes(1);
      addBytes(jsonBytes(key) + 1);
      properties += 1;
      if (properties > bounds.maxSchemaProperties) throw new Error(`schema exceeds maximum properties ${bounds.maxSchemaProperties}`);
      keywords += 1;
      if (keywords > bounds.maxSchemaKeywords) throw new Error(`schema exceeds maximum keywords ${bounds.maxSchemaKeywords}`);
      const entry = value[key];
      if (key === "$ref") {
        refs += 1;
        if (refs > bounds.maxSchemaRefs) throw new Error(`schema exceeds maximum refs ${bounds.maxSchemaRefs}`);
        if (typeof entry !== "string" || !entry.startsWith("#")) throw new Error(`${path}.$ref: remote $ref is not allowed`);
      }
      walk(entry, `${path}.${key}`, depth + 1);
    }
    active.delete(value);
  }

  walk(schema, "schema", 0);
}

function stableSchemaHash(schema: JsonObject): string {
  return JSON.stringify(schema);
}

function checkInstanceBounds(value: unknown, bounds: ResolvedBounds, path = "", depth = 0): string | undefined {
  if (depth > bounds.maxDepth) return `${path || "/"}: exceeds maximum depth ${bounds.maxDepth}`;
  if (value === null || typeof value === "boolean" || typeof value === "number") return undefined;
  if (typeof value === "string") {
    return value.length > bounds.maxStringLength
      ? `${path || "/"}: string exceeds maximum length ${bounds.maxStringLength}`
      : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > bounds.maxArrayLength) return `${path || "/"}: array exceeds maximum length ${bounds.maxArrayLength}`;
    for (let index = 0; index < value.length; index += 1) {
      const childPath = path ? `${path}[${index}]` : `[${index}]`;
      const violation = checkInstanceBounds(value[index], bounds, childPath, depth + 1);
      if (violation) return violation;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return `${path || "/"}: value must be JSON-serializable`;
  const keys = Object.keys(value);
  if (keys.length > bounds.maxProperties) return `${path || "/"}: object exceeds maximum properties ${bounds.maxProperties}`;
  for (const key of keys) {
    if (!isSafeJsonKey(key)) return `${path ? `${path}.` : ""}${key}: forbidden property key`;
    const childPath = path ? `${path}.${key}` : key;
    const violation = checkInstanceBounds(value[key], bounds, childPath, depth + 1);
    if (violation) return violation;
  }
  return undefined;
}

/** Standards-based JSON Schema adapter for {@link ToolArgumentValidator}. */
export function createJsonSchemaArgumentValidator(options?: JsonSchemaToolValidatorOptions): ToolArgumentValidator {
  const bounds = resolveBounds(options);
  const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: true, allowUnionTypes: true, addUsedSchema: false });
  const compiled = new Map<string, { readonly schema: JsonObject; readonly validate: ValidateFunction }>();

  return {
    validate(schema, value): ToolArgumentValidationResult {
      try {
        assertSchemaBounds(schema, bounds);
        const boundViolation = checkInstanceBounds(value, bounds);
        if (boundViolation) return { ok: false, errors: [{ message: boundViolation }] };

        const cacheKey = stableSchemaHash(schema);
        let cached = compiled.get(cacheKey);
        if (cached) {
          compiled.delete(cacheKey);
          compiled.set(cacheKey, cached);
        } else {
          if (compiled.size === bounds.maxCompiledSchemas) {
            const [evictedKey, evicted] = compiled.entries().next().value as [string, { readonly schema: JsonObject; readonly validate: ValidateFunction }];
            compiled.delete(evictedKey);
            ajv.removeSchema(evicted.schema);
          }
          cached = { schema, validate: ajv.compile(schema) };
          compiled.set(cacheKey, cached);
        }
        if (cached.validate(value)) return { ok: true };
        return {
          ok: false,
          errors: (cached.validate.errors ?? []).slice(0, bounds.maxErrors).map((error) => ({
            path: error.instancePath || error.schemaPath || undefined,
            message: error.message ?? "invalid",
          })),
        };
      } catch (error) {
        return { ok: false, errors: [{ message: error instanceof Error ? error.message : String(error) }] };
      }
    },
  };
}

/** JSON Schema `ToolValidator` for `AgentConfig.validator`, `RunOptions.validate`, or `dispatchToolCall`. */
export function createJsonSchemaToolArgumentValidator(options?: JsonSchemaToolValidatorOptions): ToolValidator {
  return createToolParameterValidator(createJsonSchemaArgumentValidator(options), {
    missingSchema: options?.missingSchema,
  });
}

export const packageName = "@arnilo/prism-tool-validator-json-schema";
