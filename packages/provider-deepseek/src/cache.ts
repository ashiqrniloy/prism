/**
 * Sort JSON Schema object keys (and `required` string arrays) so tool
 * declarations stay a stable implicit-cache prefix.
 */
export function canonicalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalizeJsonSchema);
    if (items.every((item) => typeof item === "string")) {
      return [...(items as string[])].sort((left, right) => left.localeCompare(right));
    }
    return items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, key === "required" && Array.isArray(item) && item.every((entry) => typeof entry === "string")
        ? [...item].sort((left, right) => (left as string).localeCompare(right as string))
        : canonicalizeJsonSchema(item)]),
  );
}

export function canonicalizeDeepSeekTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const record = tool as Record<string, unknown>;
    const fn = record.function;
    if (!fn || typeof fn !== "object") return tool;
    const fnRecord = fn as Record<string, unknown>;
    return {
      ...record,
      function: {
        ...fnRecord,
        ...(fnRecord.parameters !== undefined ? { parameters: canonicalizeJsonSchema(fnRecord.parameters) } : {}),
      },
    };
  });
}
