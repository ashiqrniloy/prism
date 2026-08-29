import { canonicalizeJsonSchema } from "@arnilo/prism/providers/schema";

export { canonicalizeJsonSchema };

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
