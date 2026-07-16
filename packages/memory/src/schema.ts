import type { JsonObject, JsonValue } from "@arnilo/prism";
import { MemoryValidationError } from "./errors.js";
import { assertSafeJsonKey, isPlainObject } from "./util.js";

/**
 * Minimal JSON Schema subset checker for working-memory shapes.
 * Supports: type, properties, required, additionalProperties, enum, const,
 * minLength, maxLength, minimum, maximum, items, minItems, maxItems.
 */
export function validateAgainstJsonSchema(value: unknown, schema: JsonObject, path = "$"): void {
  assertSafeSchema(schema, "schema");
  validateNode(value, schema, path);
}

function assertSafeSchema(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeSchema(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    assertSafeJsonKey(key);
    if (key === "$ref" && typeof entry === "string" && /^https?:/i.test(entry)) {
      throw new MemoryValidationError(`${path}.$ref remote refs are not allowed`);
    }
    assertSafeSchema(entry, `${path}.${key}`);
  }
}

function validateNode(value: unknown, schema: JsonObject, path: string): void {
  if ("const" in schema && !deepEqual(value, schema.const)) {
    throw new MemoryValidationError(`${path} must equal const`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    throw new MemoryValidationError(`${path} must be one of enum values`);
  }

  const type = schema.type;
  if (typeof type === "string") assertType(value, type, path);
  else if (Array.isArray(type)) {
    if (!type.some((entry) => typeof entry === "string" && matchesType(value, entry))) {
      throw new MemoryValidationError(`${path} must match one of types ${type.join(", ")}`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new MemoryValidationError(`${path} shorter than minLength`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      throw new MemoryValidationError(`${path} longer than maxLength`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new MemoryValidationError(`${path} below minimum`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new MemoryValidationError(`${path} above maximum`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new MemoryValidationError(`${path} below minItems`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      throw new MemoryValidationError(`${path} above maxItems`);
    }
    if (isPlainObject(schema.items)) {
      value.forEach((entry, index) => validateNode(entry, schema.items as JsonObject, `${path}[${index}]`));
    }
  }

  if (isPlainObject(value) && (type === "object" || type === undefined || (Array.isArray(type) && type.includes("object")))) {
    const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
    const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === "string") : [];
    for (const key of required) {
      if (!(key in value)) throw new MemoryValidationError(`${path}.${key} is required`);
    }
    const additional = schema.additionalProperties;
    for (const [key, entry] of Object.entries(value)) {
      assertSafeJsonKey(key);
      if (properties && isPlainObject(properties[key])) {
        validateNode(entry, properties[key] as JsonObject, `${path}.${key}`);
      } else if (additional === false) {
        throw new MemoryValidationError(`${path}.${key} is not allowed`);
      } else if (isPlainObject(additional)) {
        validateNode(entry, additional as JsonObject, `${path}.${key}`);
      }
    }
  }
}

function assertType(value: unknown, type: string, path: string): void {
  if (!matchesType(value, type)) throw new MemoryValidationError(`${path} must be ${type}`);
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      throw new MemoryValidationError(`Unsupported schema type: ${type}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => deepEqual(entry, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(a[key], (b as JsonObject)[key] as JsonValue));
  }
  return false;
}
