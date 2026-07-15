import { Ajv, type ValidateFunction } from "ajv";
import type { JsonObject, ToolArgumentValidationResult, ToolArgumentValidator, ToolValidator } from "@arnilo/prism";
import { createToolParameterValidator } from "@arnilo/prism";

export interface JsonSchemaToolValidatorOptions {
  /** When a tool omits `parameters`. Default `"allow"`. */
  readonly missingSchema?: "allow" | "reject";
  /** Maximum validation errors returned per call. Default `8`. */
  readonly maxErrors?: number;
  /** Maximum nested depth when walking argument values. Default `64`. */
  readonly maxDepth?: number;
  /** Maximum own properties per object when walking argument values. Default `1000`. */
  readonly maxProperties?: number;
  /** Maximum string length when walking argument values. Default `1_000_000`. */
  readonly maxStringLength?: number;
  /** Maximum array length when walking argument values. Default `10_000`. */
  readonly maxArrayLength?: number;
}

interface ResolvedBounds {
  readonly maxErrors: number;
  readonly maxDepth: number;
  readonly maxProperties: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
}

const DEFAULT_BOUNDS: ResolvedBounds = {
  maxErrors: 8,
  maxDepth: 64,
  maxProperties: 1000,
  maxStringLength: 1_000_000,
  maxArrayLength: 10_000,
};

function resolveBounds(options?: JsonSchemaToolValidatorOptions): ResolvedBounds {
  return {
    maxErrors: options?.maxErrors ?? DEFAULT_BOUNDS.maxErrors,
    maxDepth: options?.maxDepth ?? DEFAULT_BOUNDS.maxDepth,
    maxProperties: options?.maxProperties ?? DEFAULT_BOUNDS.maxProperties,
    maxStringLength: options?.maxStringLength ?? DEFAULT_BOUNDS.maxStringLength,
    maxArrayLength: options?.maxArrayLength ?? DEFAULT_BOUNDS.maxArrayLength,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSafeJsonKey(key: string): boolean {
  return key !== "__proto__" && key !== "prototype" && key !== "constructor";
}

function assertSafeSchema(value: unknown, path = "schema"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeSchema(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!isSafeJsonKey(key)) throw new Error(`${path}.${key} uses forbidden JSON key: ${key}`);
    assertSafeSchema(entry, `${path}.${key}`);
  }
}

function findRemoteRef(value: unknown, path = "schema"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findRemoteRef(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  if (typeof value.$ref === "string" && /^https?:/i.test(value.$ref)) return `${path}.$ref`;
  for (const [key, entry] of Object.entries(value)) {
    const found = findRemoteRef(entry, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
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
  const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: true, allowUnionTypes: true });
  const compiled = new Map<string, ValidateFunction>();

  return {
    validate(schema, value): ToolArgumentValidationResult {
      try {
        assertSafeSchema(schema);
        const remoteRef = findRemoteRef(schema);
        if (remoteRef) {
          return { ok: false, errors: [{ path: remoteRef, message: "remote $ref is not allowed" }] };
        }
        const boundViolation = checkInstanceBounds(value, bounds);
        if (boundViolation) return { ok: false, errors: [{ message: boundViolation }] };

        const cacheKey = stableSchemaHash(schema);
        let validateFn = compiled.get(cacheKey);
        if (!validateFn) {
          const compiledFn = ajv.compile(schema);
          compiled.set(cacheKey, compiledFn);
          validateFn = compiledFn;
        }
        if (validateFn(value)) return { ok: true };
        return {
          ok: false,
          errors: (validateFn.errors ?? []).slice(0, bounds.maxErrors).map((error) => ({
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
