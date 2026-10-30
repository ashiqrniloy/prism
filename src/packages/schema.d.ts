import type { JsonObject, JsonValue } from "../contracts.js";
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
export type SchemaErrorRule = "type" | "enum" | "const" | "range" | "length" | "pattern" | "required" | "shape" | "unknown_key" | "secret" | "not_json";
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
export declare const SECRET_REF: RegExp;
/** Checks and compiles a schema once. Throws `config_schema_unsupported` outside the supported subset. */
export declare function assertJsonSchemaSupported(schema: JsonSchema): void;
/**
 * Returns a normalised JSON copy of `value`, or the first non-JSON finding. A function, symbol,
 * bigint, non-finite number, class instance, cycle, or unsafe key (`__proto__`) is not JSON. An
 * `undefined` object property counts as absent, matching `JSON.stringify`.
 */
export declare function toJsonValue(value: unknown, path?: string, depth?: number): {
    readonly value: JsonValue;
} | {
    readonly error: SchemaError;
};
/**
 * Validates `value` against `schema` and returns it with defaults applied. Errors carry a JSON
 * pointer and the failed rule, never the offending value. A schema outside the supported subset
 * throws `PackageLoadError` `config_schema_unsupported`.
 */
export declare function validateJsonSchema(schema: JsonSchema, value: unknown): SchemaResult;
/** The defaults a schema declares, as a config object (`{}` when it declares none). */
export declare function schemaDefaults(schema: JsonSchema): JsonObject;
