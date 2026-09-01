import { PolicyError } from "./errors.js";

/**
 * Minimal RFC 8785 (JCS) canonical JSON for audit export.
 *
 * Deterministic for supported JSON values: object keys sorted by UTF-16 code
 * unit with prefix-shorter-first (default `.sort()`), numbers rendered via the
 * ECMAScript shortest round-trip (`Number#toString`, `-0` collapsed to `0`),
 * strings escaped with lowercase `\uXXXX` for control code points (native
 * `JSON.stringify` output is RFC 8785 conformant here), and no insignificant
 * whitespace.
 *
 * Unsupported values fail closed instead of being coerced: non-finite numbers,
 * BigInt, undefined, functions, symbols, and cyclic graphs.
 */

export class CanonicalJsonError extends PolicyError {
  constructor(message: string) {
    super(message, "ERR_PRISM_POLICY_CANONICAL");
    this.name = "CanonicalJsonError";
  }
}

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) throw new CanonicalJsonError(`non-finite number ${value} is not canonical JSON`);
}

function canonicalValue(value: unknown, active: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      assertFiniteNumber(value);
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (active.has(value as object)) throw new CanonicalJsonError("cyclic value is not canonical JSON");
      if (Array.isArray(value)) {
        active.add(value);
        const parts = (value as unknown[]).map((item) => {
          if (item === undefined) throw new CanonicalJsonError("undefined array element is not canonical JSON");
          return canonicalValue(item, active);
        });
        active.delete(value);
        return `[${parts.join(",")}]`;
      }
      active.add(value);
      const keys = Object.keys(value as Record<string, unknown>).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) throw new CanonicalJsonError(`undefined value for key ${key} is not canonical JSON`);
        parts.push(`${JSON.stringify(key)}:${canonicalValue(item, active)}`);
      }
      active.delete(value);
      return `{${parts.join(",")}}`;
    }
    case "bigint":
      throw new CanonicalJsonError("BigInt values are not canonical JSON");
    case "undefined":
    case "function":
    case "symbol":
      throw new CanonicalJsonError(`${typeof value} values are not canonical JSON`);
    default:
      throw new CanonicalJsonError("unsupported JSON value");
  }
}

/** Canonical JCS text for a supported JSON value; throws on unsupported input. */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

/** UTF-8 bytes of the canonical JCS text. */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}
