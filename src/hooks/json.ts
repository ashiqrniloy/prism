import type { JsonObject, JsonValue } from "../contracts.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural JSON equality: the `tool.call` conflict/no-op rule and the `tool.execute` wrap-only check. */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((entry, index) => jsonEqual(entry, b[index] as JsonValue));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key] as JsonValue, b[key] as JsonValue))
    );
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry);
  return value;
}

/** A deep-frozen copy, so an in-place mutation of a hook payload throws instead of reaching execution. */
export function frozenCopy(value: JsonObject): JsonObject {
  return deepFreeze(structuredClone(value));
}
