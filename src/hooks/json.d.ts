import type { JsonObject, JsonValue } from "../contracts.js";
/** Structural JSON equality: the `tool.call` conflict/no-op rule and the `tool.execute` wrap-only check. */
export declare function jsonEqual(a: JsonValue, b: JsonValue): boolean;
/** A deep-frozen copy, so an in-place mutation of a hook payload throws instead of reaching execution. */
export declare function frozenCopy(value: JsonObject): JsonObject;
