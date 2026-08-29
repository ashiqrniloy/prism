/**
 * Deterministic JSON Schema clone for tool/function parameters.
 * Sorts object keys and unordered `required` names. Leaves semantic arrays
 * (`prefixItems`, `examples`, `enum`, tuple `items`) in caller order.
 * Does not resolve `$ref`, mutate input, or enforce schema bounds.
 */
export function canonicalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJsonSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareKey(left, right))
      .map(([key, item]) => [key, key === "required" ? canonicalizeRequired(item) : canonicalizeJsonSchema(item)]),
  );
}

function canonicalizeRequired(item: unknown): unknown {
  if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
    return [...item].sort(compareKey);
  }
  return canonicalizeJsonSchema(item);
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
