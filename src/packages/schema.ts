import type { JsonObject, JsonValue } from "../contracts.js";
import { PackageLoadError } from "./errors.js";

/**
 * The JSON Schema keyword subset package config may use (plan 146 Task 1(c)), derived from the
 * config shapes of the Part B conversions. Anything else is rejected, never silently ignored.
 * `additionalProperties` defaults to `false`, so an undeclared key fails closed.
 */
export interface JsonSchema {
  readonly type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly enum?: readonly JsonValue[];
  readonly const?: JsonValue;
  readonly default?: JsonValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
  readonly description?: string;
  readonly title?: string;
  /** The field holds a credential: only an `env:` or `keyring:` ref is accepted, never a literal. */
  readonly "x-prism-secret"?: boolean;
  /** Documentation only: `contract` is frozen at API level 1, `tuning` may change in a minor version. Ignored by validation. */
  readonly "x-prism-stability"?: "contract" | "tuning";
}

export type SchemaErrorRule =
  | "type"
  | "enum"
  | "const"
  | "range"
  | "length"
  | "pattern"
  | "required"
  | "shape"
  | "unknown_key"
  | "secret"
  | "not_json";

/** One violation. The message names the rule, never the value. */
export interface SchemaError {
  readonly path: string;
  readonly message: string;
  readonly rule: SchemaErrorRule;
}

export interface SchemaResult {
  readonly ok: boolean;
  /** The value with defaults applied. Undefined when `ok` is false. */
  readonly value: JsonValue | undefined;
  readonly errors: readonly SchemaError[];
}

/** Accepted secret refs (roadmap §2.6): `env:NAME` or `keyring:name`. */
export const SECRET_REF = /^(env|keyring):[A-Za-z0-9_.\-/]+$/;

const MAX_PATTERN_LENGTH = 256;
const MAX_PATTERN_INPUT = 4096;
const MAX_SCHEMA_DEPTH = 32;
const MAX_VALUE_DEPTH = 64;
const MAX_ERRORS = 20;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "enum",
  "const",
  "default",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "oneOf",
  "anyOf",
  "description",
  "title",
  "x-prism-secret",
  "x-prism-stability",
]);
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

interface Node {
  readonly schema: JsonSchema;
  readonly properties: ReadonlyMap<string, Node>;
  readonly additional: boolean | Node;
  readonly items: Node | undefined;
  readonly oneOf: readonly Node[] | undefined;
  readonly anyOf: readonly Node[] | undefined;
  readonly regex: RegExp | undefined;
}

/** Each schema object is checked and compiled at most once. */
const compiled = new WeakMap<object, Node>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function pointer(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

function unsupported(path: string, message: string): never {
  throw new PackageLoadError("config_schema_unsupported", `Config schema ${path || "/"}: ${message}`, { path: path || "/" });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Checks and compiles a schema once. Throws `config_schema_unsupported` outside the supported subset. */
export function assertJsonSchemaSupported(schema: JsonSchema): void {
  compile(schema, "", 0);
}

function compile(schema: unknown, path: string, depth: number): Node {
  if (!isPlainObject(schema)) unsupported(path, "a schema must be an object");
  const cached = compiled.get(schema);
  if (cached) return cached;
  if (depth > MAX_SCHEMA_DEPTH) unsupported(path, "schema is nested too deeply");
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) unsupported(path, `keyword "${keyword}" is not supported`);
  }
  const s = schema as JsonSchema & Record<string, unknown>;
  if (s.type !== undefined && !(typeof s.type === "string" && TYPES.has(s.type))) {
    unsupported(path, '"type" must be one of string, number, integer, boolean, object, array, null');
  }
  for (const keyword of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    if (s[keyword] !== undefined && !isCount(s[keyword])) unsupported(path, `"${keyword}" must be a non-negative integer`);
  }
  for (const keyword of ["minimum", "maximum"] as const) {
    if (s[keyword] !== undefined && !isFiniteNumber(s[keyword])) unsupported(path, `"${keyword}" must be a finite number`);
  }
  for (const keyword of ["description", "title"] as const) {
    if (s[keyword] !== undefined && typeof s[keyword] !== "string") unsupported(path, `"${keyword}" must be a string`);
  }
  if (s.enum !== undefined && !(Array.isArray(s.enum) && s.enum.length > 0)) unsupported(path, '"enum" must be a non-empty array');
  if (s.required !== undefined && !(Array.isArray(s.required) && s.required.every((entry) => typeof entry === "string"))) {
    unsupported(path, '"required" must be an array of strings');
  }
  if ("const" in s && s.const === undefined) unsupported(path, '"const" must be a JSON value');
  const secret = s["x-prism-secret"];
  if (secret !== undefined && typeof secret !== "boolean") unsupported(path, '"x-prism-secret" must be a boolean');
  if (secret === true && s.type !== undefined && s.type !== "string") unsupported(path, 'a secret field must be of type "string"');
  const stability = s["x-prism-stability"];
  if (stability !== undefined && stability !== "contract" && stability !== "tuning") {
    unsupported(path, '"x-prism-stability" must be "contract" or "tuning"');
  }

  let regex: RegExp | undefined;
  if (s.pattern !== undefined) {
    if (typeof s.pattern !== "string" || s.pattern.length > MAX_PATTERN_LENGTH) {
      unsupported(path, `"pattern" must be a string of at most ${MAX_PATTERN_LENGTH} characters`);
    }
    try {
      regex = new RegExp(s.pattern, "u");
    } catch {
      unsupported(path, '"pattern" is not a valid regular expression');
    }
  }

  const properties = new Map<string, Node>();
  if (s.properties !== undefined) {
    if (!isPlainObject(s.properties)) unsupported(path, '"properties" must be an object');
    for (const [key, child] of Object.entries(s.properties)) {
      if (UNSAFE_KEYS.has(key)) unsupported(pointer(path, key), `property name "${key}" is not allowed`);
      properties.set(key, compile(child, pointer(pointer(path, "properties"), key), depth + 1));
    }
  }
  let additional: boolean | Node = false;
  if (s.additionalProperties !== undefined) {
    additional =
      typeof s.additionalProperties === "boolean"
        ? s.additionalProperties
        : compile(s.additionalProperties, pointer(path, "additionalProperties"), depth + 1);
  }
  const items = s.items === undefined ? undefined : compile(s.items, pointer(path, "items"), depth + 1);
  const branches = (keyword: "oneOf" | "anyOf"): readonly Node[] | undefined => {
    const list = s[keyword];
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.length === 0) unsupported(path, `"${keyword}" must be a non-empty array of schemas`);
    return list.map((branch, index) => compile(branch, pointer(pointer(path, keyword), index), depth + 1));
  };
  const node: Node = { schema: s, properties, additional, items, oneOf: branches("oneOf"), anyOf: branches("anyOf"), regex };
  compiled.set(schema, node);

  // A declared default must itself satisfy the schema, or it would reach `setup` unvalidated.
  if ("default" in s) {
    const check = run(node, s.default as JsonValue, path, []);
    if (check.errors.length > 0) unsupported(path, '"default" does not satisfy its own schema');
  }
  return node;
}

function kindOf(value: JsonValue): "null" | "array" | "object" | "string" | "number" | "boolean" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as "object" | "string" | "number" | "boolean";
}

function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((entry, index) => jsonEqual(entry, b[index] as JsonValue));
  if (isRecord(a) && isRecord(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key] as JsonValue, b[key] as JsonValue))
    );
  }
  return false;
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = cloneJson(entry as JsonValue);
    return result;
  }
  return value;
}

/**
 * Returns a normalised JSON copy of `value`, or the first non-JSON finding. A function, symbol,
 * bigint, non-finite number, class instance, cycle, or unsafe key (`__proto__`) is not JSON. An
 * `undefined` object property counts as absent, matching `JSON.stringify`.
 */
export function toJsonValue(value: unknown, path = "", depth = 0): { readonly value: JsonValue } | { readonly error: SchemaError } {
  const bad = (message: string) => ({ error: { path: path || "/", message, rule: "not_json" as const } });
  if (depth > MAX_VALUE_DEPTH) return bad("is nested too deeply or cyclic");
  if (value === null || typeof value === "string" || typeof value === "boolean") return { value };
  if (typeof value === "number") return Number.isFinite(value) ? { value } : bad("is not a finite number");
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const entry = toJsonValue(value[index], pointer(path, index), depth + 1);
      if ("error" in entry) return entry;
      out.push(entry.value);
    }
    return { value: out };
  }
  if (isPlainObject(value)) {
    const out: Record<string, JsonValue> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (UNSAFE_KEYS.has(key)) return { error: { path: pointer(path, key), message: `key "${key}" is not allowed`, rule: "not_json" } };
      if (raw === undefined) continue;
      const entry = toJsonValue(raw, pointer(path, key), depth + 1);
      if ("error" in entry) return entry;
      out[key] = entry.value;
    }
    return { value: out };
  }
  return bad("is not JSON (functions and class instances cannot be config)");
}

interface RunResult {
  readonly value: JsonValue;
  readonly errors: SchemaError[];
}

function run(node: Node, input: JsonValue, path: string, errors: SchemaError[]): RunResult {
  const s = node.schema;
  const failAt = (rule: SchemaErrorRule, at: string, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ path: at || "/", message, rule });
  };
  const fail = (rule: SchemaErrorRule, message: string) => failAt(rule, path, message);
  let value = input;
  const kind = kindOf(value);
  if (s.type !== undefined) {
    const ok = s.type === "integer" ? kind === "number" && Number.isInteger(value) : s.type === kind;
    if (!ok) {
      fail("type", `must be of type ${s.type}`);
      return { value, errors };
    }
  }
  if (s.enum !== undefined && !s.enum.some((option) => jsonEqual(option, value))) fail("enum", "must be one of the allowed values");
  if ("const" in s && !jsonEqual(s.const as JsonValue, value)) fail("const", "must equal the required constant");

  if (typeof value === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) fail("length", `must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && value.length > s.maxLength) fail("length", `must be at most ${s.maxLength} characters`);
    if (node.regex) {
      if (value.length > MAX_PATTERN_INPUT) fail("pattern", `is too long to match a pattern (limit ${MAX_PATTERN_INPUT} characters)`);
      else if (!node.regex.test(value)) fail("pattern", "does not match the required pattern");
    }
    if (s["x-prism-secret"] === true && !SECRET_REF.test(value))
      fail("secret", "must be an env: or keyring: reference, not a literal value");
  } else if (typeof value === "number") {
    if (s.minimum !== undefined && value < s.minimum) fail("range", `must be at least ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) fail("range", `must be at most ${s.maximum}`);
  } else if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) fail("length", `must have at least ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) fail("length", `must have at most ${s.maxItems} items`);
    const itemNode = node.items;
    if (itemNode) value = value.map((entry, index) => run(itemNode, entry, pointer(path, index), errors).value);
  } else if (isRecord(value)) {
    // A node that only composes branches (`oneOf`/`anyOf`) declares no object shape of its own. Its
    // empty property map must not reject every key as unknown before the branches run, so the shape
    // keywords apply only when the node actually constrains an object.
    const constrainsObject =
      s.type === "object" || s.properties !== undefined || s.additionalProperties !== undefined || s.required !== undefined;
    if (constrainsObject) {
      const source = value as Record<string, JsonValue>;
      const out: Record<string, JsonValue> = {};
      for (const key of Object.keys(source)) {
        const entry = source[key] as JsonValue;
        const declared = node.properties.get(key);
        if (declared) out[key] = run(declared, entry, pointer(path, key), errors).value;
        else if (node.additional === true) out[key] = entry;
        else if (node.additional === false) fail("unknown_key", `unknown key "${key}"`);
        else out[key] = run(node.additional, entry, pointer(path, key), errors).value;
      }
      for (const [key, declared] of node.properties) {
        if (Object.hasOwn(source, key)) continue;
        if ("default" in declared.schema) out[key] = cloneJson(declared.schema.default as JsonValue);
        else if (declared.properties.size > 0) {
          // A nested object materialises only when a default exists below it.
          const nested = schemaDefaults(declared.schema);
          if (Object.keys(nested).length > 0) out[key] = nested;
        }
      }
      for (const key of s.required ?? []) if (!Object.hasOwn(out, key)) failAt("required", pointer(path, key), "is required");
      value = out;
    }
  }

  if (node.oneOf) {
    const matches = node.oneOf.map((branch) => run(branch, value, path, [])).filter((result) => result.errors.length === 0);
    if (matches.length === 1) value = (matches[0] as RunResult).value;
    else fail("shape", matches.length === 0 ? "does not match any allowed shape" : "matches more than one allowed shape");
  }
  if (node.anyOf) {
    const match = node.anyOf.map((branch) => run(branch, value, path, [])).find((result) => result.errors.length === 0);
    if (match) value = match.value;
    else fail("shape", "does not match any allowed shape");
  }
  return { value, errors };
}

/**
 * Validates `value` against `schema` and returns it with defaults applied. Errors carry a JSON
 * pointer and the failed rule, never the offending value. A schema outside the supported subset
 * throws `PackageLoadError` `config_schema_unsupported`.
 */
export function validateJsonSchema(schema: JsonSchema, value: unknown): SchemaResult {
  const node = compile(schema, "", 0);
  const json = toJsonValue(value);
  if ("error" in json) return { ok: false, value: undefined, errors: [json.error] };
  const errors: SchemaError[] = [];
  const result = run(node, json.value, "", errors);
  return errors.length === 0 ? { ok: true, value: result.value, errors } : { ok: false, value: undefined, errors };
}

/** The defaults a schema declares, as a config object (`{}` when it declares none). */
export function schemaDefaults(schema: JsonSchema): JsonObject {
  const node = compile(schema, "", 0);
  const out: Record<string, JsonValue> = {};
  for (const [key, declared] of node.properties) {
    if ("default" in declared.schema) out[key] = cloneJson(declared.schema.default as JsonValue);
    else if (declared.properties.size > 0) {
      const nested = schemaDefaults(declared.schema);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}
